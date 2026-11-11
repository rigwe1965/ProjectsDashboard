// Admin console core: owner-only. Zero dependencies.
//
// Two ways in:
//  - TOKEN MODE (default, nothing configured): binds 127.0.0.1 only; a random per-launch token printed in the
//    terminal is exchanged for an HttpOnly cookie.
//  - PASSWORD MODE (after `npm run console:auth set-password`): sign in at /login with a password and, if enabled,
//    a 6-digit authenticator code. Sessions live in the database (hashed) and last ADMIN_SESSION_HOURS (12).
//    The launch-token URL is switched off in this mode, so a leaked terminal log cannot bypass the password/2FA.
//    Login attempts are rate limited per IP and overall, and recorded in the audit log.
// Always: Host header allow-list (anti DNS-rebinding), same-origin check on every POST (anti CSRF),
// security headers. It exposes app names, ports and status only: never env values or .env contents.
import http from 'node:http';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGrants, publicGrant, isActive } from '../demo-gateway/grants.mjs';
import { activityView, mergeTopPages } from '../lib/engagement.mjs';
import { demoApps } from '../lib/registry.mjs';
import { dataDir, ports } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { cookieOf as readCookie, safeEq, json, portInUse, clientIp, BASE_SECURITY_HEADERS } from '../lib/http-util.mjs';
import { getStore } from '../lib/store/index.mjs';
import { logger } from '../lib/log.mjs';
import { EVENTS } from '../lib/events.mjs';
import { num, fireAndForget, maskSecrets, cachedFor, MINUTE, HOUR } from '../lib/util.mjs';
import { runSupervisor } from '../lib/run-supervisor.mjs';
import { createStatusCache } from './status-cache.mjs';
import { assertSafeToListen } from './listen-safety.mjs';
import { createLogin } from './login.mjs';
import { runReset, productState, isResetting, lastResetAt } from '../demo-gateway/reset.mjs';
import { listInstances } from '../demo-gateway/instances.mjs';
import { HttpError, toResponse, tooLarge, parseJsonObject } from '../lib/errors.mjs';
import { ADMIN_KEYS, hashSessionId } from '../lib/auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const COOKIE_BASE = 'pd_session';
// Things the owner did (sign-ins, start/stop, creating and revoking customer links), as opposed to what customers did.
const isAdminEvent = (ev) => ev.startsWith('admin-') || ev === EVENTS.grantCreated || ev === EVENTS.grantRevoked;

const defaultSupervisor = runSupervisor;

// Private demo copies of one product, for the console: how many are running, which are stuck (could not be stopped or never came up), and each copy's state.
function copySummary(table) {
  const now = Date.now();
  const copyList = Object.entries(table).map(([slot, e]) => ({ slot: Number(slot), state: e.state, minutes: Math.max(0, Math.round((now - (Number(e.seen) || Number(e.at) || now)) / MINUTE)) }));
  return {
    copies: copyList.filter((c) => c.state === 'ready' || c.state === 'starting').length,
    stuck: copyList.filter((c) => c.state === 'stopping' || c.state === 'failed').length,
    copyList,
  };
}

function tail(file, maxBytes = 12000) {
  if (!existsSync(file)) return '(no log yet)';
  const size = statSync(file).size, start = Math.max(0, size - maxBytes), len = size - start;
  const fd = openSync(file, 'r'), buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, start); closeSync(fd);
  return buf.toString('utf8');
}

export async function createConsole(opts = {}) {
  const o = {
    port: ports.console,
    bindHost: process.env.ADMIN_BIND || '127.0.0.1',
    // ADMIN_APP_CONTROL=off: this console only shows status (the hosted container has no Docker access and its logs are elsewhere), so Start, Stop and
    // Log are hidden and refused.
    appControl: process.env.ADMIN_APP_CONTROL !== 'off',
    allowedHosts: (process.env.ADMIN_ALLOWED_HOSTS || '127.0.0.1,localhost').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    scheme: process.env.ADMIN_SCHEME || 'http',
    allowHttp: process.env.ADMIN_ALLOW_HTTP === '1',
    sessionHours: num(process.env.ADMIN_SESSION_HOURS, 12),
    loginMaxPerIp: 8, loginMaxTotal: 40, // sign-in attempts per 15 minutes
    loginPenaltyMs: 1500, // extra wait before answering a FAILED sign-in once the overall failure cap is passed (slows guessing spread over many addresses)
    trustedProxies: (process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean),
    store: null, // the store to use; null = the process-wide one
    supervisor: defaultSupervisor,
    gatewayPort: ports.gateway,
    statusReuseMs: 2000, // how long one status check answers further requests
    ...opts,
  };
  loadRegistry(); // fail at start-up on an invalid registry; requests read it again (cached by file time), so an edit to apps.json shows without a restart
  const store = o.store ?? await getStore(); // a store can be passed in; the default is the process-wide one
  const { loadGrants, createGrant, revokeGrant } = createGrants(store);
  const trusted = new Set(o.trustedProxies);
  const launchToken = randomBytes(24).toString('hex');
  const busy = new Set();
  const status = createStatusCache({ supervisor: o.supervisor, reuseMs: o.statusReuseMs });
  const statusRows = status.get, dropStatus = status.drop;
  const secure = o.scheme === 'https' ? '; Secure' : '';
  const COOKIE = (o.scheme === 'https' ? '__Host-' : '') + COOKIE_BASE; // __Host-: browsers only accept it if Secure, host-only and Path=/
  const audit = (e) => fireAndForget(() => store.audit.add(e), (err) => logger.warn('audit write failed', { err }));

  const passwordMode = async () => !!(await store.meta.get(ADMIN_KEYS.passwordHash));
  await assertSafeToListen(o, store);

  // Scripts run only if they carry this response's random nonce, so injected markup cannot execute. (Styles stay inline: far lower risk.)
  const csp = (script) => `default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src ${script}; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`;
  const securityHeaders = {
    ...BASE_SECURITY_HEADERS,
    'content-security-policy': csp("'none'"), // JSON and redirects never need a script
  };
  const html = (res, code, body) => {
    const nonce = randomBytes(16).toString('base64');
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...securityHeaders, 'content-security-policy': csp(`'nonce-${nonce}'`) });
    res.end(String(body).replaceAll('<script>', `<script nonce="${nonce}">`));
  };
  const originOk = (req) => req.headers.origin === `${o.scheme}://${req.headers.host}`;
  // True (after answering 403) when the request's Origin is not this console's own address. Every state-changing route starts with it.
  const badOrigin = (req, res) => (originOk(req) ? false : (json(res, 403, { error: 'bad origin' }), true));
  const readBody = async (req, max = 4096) => { let b = ''; for await (const c of req) { b += c; if (b.length > max) throw tooLarge(); } return b; };
  const login = createLogin({ o, store, trusted, audit, badOrigin, readBody, cookie: { name: COOKIE, secure }, securityHeaders });

  async function sessionOk(req) {
    const id = readCookie(req, COOKIE);
    return /^[a-f0-9]{64}$/.test(id) && !!(await store.sessions.get(hashSessionId(id)));
  }

  const ipOf = (req) => clientIp(req, trusted);
  const dbHealthy = cachedFor(5000, () => store.meta.get('health-check')); // public and unauthenticated: the database is asked once per 5 s
  const findApp = (id) => loadRegistry().apps.find((a) => a.id === id);

  // Decides whether this request is the owner's. Returns true to carry on; otherwise the answer (login page, redirect, 401, 403)
  // has already been sent.
  async function authenticate(req, res, url, pw) {
    if (pw) {
      if (url.pathname === '/login' && req.method === 'GET') {
        if (await sessionOk(req)) { res.writeHead(302, { location: '/' }); res.end(); return false; }
        html(res, 200, readFileSync(join(here, 'login.html')));
        return false;
      }
      if (url.pathname === '/login' && req.method === 'POST') { await login(req, res); return false; }
      if (url.pathname === '/logout' && req.method === 'POST') {
        if (badOrigin(req, res)) return false;
        const id = readCookie(req, COOKIE); if (id) await store.sessions.delete(hashSessionId(id));
        audit({ ev: EVENTS.adminLogout, ip: ipOf(req) });
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`, ...securityHeaders });
        res.end('{"ok":true}');
        return false;
      }
      if (!(await sessionOk(req))) {
        if (url.pathname.startsWith('/api/')) json(res, 401, { error: 'sign in required' });
        else { res.writeHead(302, { location: '/login' }); res.end(); }
        return false;
      }
      return true;
    }
    if (url.pathname === '/' && url.searchParams.get('t')) {
      if (!safeEq(url.searchParams.get('t'), launchToken)) { res.writeHead(403); res.end('Invalid token'); return false; }
      res.writeHead(302, { 'set-cookie': `${COOKIE}=${launchToken}; HttpOnly; SameSite=Strict; Path=/${secure}`, location: '/' });
      res.end();
      return false;
    }
    if (!safeEq(readCookie(req, COOKIE), launchToken)) {
      res.writeHead(401, { 'content-type': 'text/plain' }); res.end('Unauthorized. Open the full URL printed in the terminal where the console was started.');
      return false;
    }
    return true;
  }

  // ---- The routes. Each handler gets { req, res, url, m, pw }: `m` is the regex match for a pattern route. ----

  // Read-only activity feed. Only a fixed set of fields leaves the server (never a token, hash or session id), and the
  // page shows them as plain text because address, browser and customer name can come from outside.
  async function apiAudit({ res, url }) {
    const kind = url.searchParams.get('kind') || 'all';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 300);
    const keep = {
      all: () => true,
      admin: (e) => isAdminEvent(e.ev),
      demos: (e) => !isAdminEvent(e.ev),
      problems: (e) => e.ev === EVENTS.adminLoginFailed || e.ev === EVENTS.denied || e.ev === EVENTS.adminActionRefused,
    }[kind];
    if (!keep) return json(res, 400, { error: 'unknown filter' });
    const rows = (await store.audit.list(1000)).filter((e) => keep(e)).slice(0, limit)
      .map((e) => ({ t: e.t, ev: e.ev, app: e.app, grant: e.grant, ip: e.ip, ua: typeof e.ua === 'string' ? e.ua.slice(0, 120) : undefined,
        why: e.why, via: e.via, by: e.by, customer: e.customer }));
    return json(res, 200, { events: rows });
  }

  async function apiApps({ res }) {
    const { rows, statusError } = await statusRows();
    return json(res, 200, loadRegistry().apps.filter((a) => !a.hidden).map((a) => ({
      id: a.id, name: a.name, tagline: a.tagline, stack: a.stack, demo: a.demo, note: a._note, controls: o.appControl,
      processes: a.processes.map((p) => ({ name: p.name, port: p.port, optional: !!p.optional,
        ...(rows.find((r) => r.app === a.id && r.proc === p.name) || { up: false, managed: false, url: null }) })),
    })), statusError ? { 'x-status-error': statusError } : {});
  }

  function appLogs({ res, url, m }) {
    if (!o.appControl) return json(res, 403, { error: 'Logs are not shown in this setup. Use docker compose logs on the server.' });
    const app = findApp(m[1]);
    const proc = app?.processes.find((p) => p.name === url.searchParams.get('proc'));
    if (!proc) return json(res, 404, { error: 'unknown app/process' });
    return json(res, 200, { log: maskSecrets(tail(join(dataDir, 'logs', `${app.id}-${proc.name}.log`))) });
  }

  async function appAction({ req, res, url, m }) {
    const action = m[2];
    if (!originOk(req)) { audit({ ev: EVENTS.adminActionRefused, app: m[1], why: 'bad-origin', ip: ipOf(req) }); return json(res, 403, { error: 'bad origin' }); }
    if (!o.appControl) return json(res, 403, { error: 'This console only shows status here. Start and stop with docker compose on the server.' });
    const app = findApp(m[1]);
    if (!app) return json(res, 404, { error: 'unknown app' });
    const only = url.searchParams.get('proc');
    if (only && !app.processes.some((p) => p.name === only)) return json(res, 400, { error: 'unknown process' });
    if (busy.has(app.id)) { audit({ ev: EVENTS.adminActionRefused, app: app.id, why: 'busy', ip: ipOf(req) }); return json(res, 409, { error: `${app.id} is busy with another action` }); }
    busy.add(app.id);
    audit({ ev: EVENTS.adminApp(action), app: app.id, ip: ipOf(req), ...(only ? { proc: only } : {}) });
    try {
      // start/restart can legitimately wait up to 60 s per process for the app to answer
      const r = await o.supervisor([action, app.id, ...(only ? [`--only=${only}`] : [])], action === 'stop' ? 2 * MINUTE : 5 * MINUTE);
      if (!r.ok) logger.warn('supervisor command failed', { action, app: app.id, timedOut: !!r.timedOut });
      return json(res, r.ok ? 200 : 502, r);
    } finally { busy.delete(app.id); dropStatus(); }
  }

  async function demosList({ res }) {
    const gatewayUp = await portInUse(o.gatewayPort);
    const { rows } = await statusRows();
    const grantList = await loadGrants();
    const products = await Promise.all(Object.entries(demoApps()).map(async ([product, a]) => ({
      product, instance: a.id, name: a.name, up: rows.some((r) => r.app === a.id && r.up), managed: rows.some((r) => r.app === a.id && r.managed),
      canReset: !!a.reset && !a.perLink, resetting: !!a.reset && !a.perLink && await isResetting(store, product), lastReset: a.reset && !a.perLink ? await lastResetAt(store, product) : null,
      perLink: !!a.perLink, seats: a.perLink?.max ?? 0,
      ...(a.perLink ? copySummary(await listInstances(store, product)) : { copies: 0, stuck: 0, copyList: [] }),
      inUse: a.reset && !a.perLink ? productState(grantList, product).busy : 0, // opened links that have not ended
      accounts: (a.demoAccounts || []).map((x) => ({ label: x.label, user: x.user, admin: !!x.admin })),
    })));
    const gatewayManaged = rows.some((r) => r.app === 'gateway' && r.managed);
    // What each link's customer did with it (counted by the gateway): one query for all links.
    const sums = new Map((await store.activity.summary()).map((s) => [s.grantId, s]));
    const links = (await loadGrants()).map((g) => ({ ...publicGrant(g), activity: activityView(g, sums.get(g.id)) })).reverse();
    return json(res, 200, { gatewayUp, gatewayManaged, appControl: o.appControl, gatewayPort: o.gatewayPort, products, grants: links });
  }

  // One link's activity day by day, and its busiest pages (the owner's detail view).
  async function demoActivity({ res, m }) {
    const g = await store.grants.findById(m[1]);
    if (!g) throw new HttpError(404, 'No such demo link');
    const days = await store.activity.forGrant(g.id);
    return json(res, 200, { days: days.map(({ day, requests, firstAt, lastAt, activeSeconds, wsSeconds }) => ({ day, requests, firstAt, lastAt, activeSeconds, wsSeconds })), topPages: mergeTopPages(days) });
  }

  async function demoCreate({ req, res }) {
    if (badOrigin(req, res)) return;
    const b = parseJsonObject(await readBody(req)); // not JSON / not an object -> 400, too large -> 413
    const { grant, link } = await createGrant({ customer: b.customer, app: b.app, hours: b.hours, maxUses: b.maxUses, deviceLock: b.deviceLock }, { ip: ipOf(req), by: 'console' });
    return json(res, 200, { grant: publicGrant(grant), link });
  }

  async function demoReset({ req, res, m }) {
    if (badOrigin(req, res)) return;
    const product = m[1], app = demoApps()[product];
    if (!app?.reset || app.perLink) throw new HttpError(404, 'That demo cannot be reset');
    const b = parseJsonObject(await readBody(req));
    const inUse = productState(await loadGrants(), product).busy;
    if (inUse && !b.force) return json(res, 409, { error: `${inUse} customer link${inUse === 1 ? ' is' : 's are'} still active for this demo. Resetting now wipes what they are working on.`, inUse });
    audit({ ev: EVENTS.demoResetRequested, app: product, forced: !!inUse, ip: ipOf(req) });
    const r = await runReset({ store, product, app, supervisor: o.supervisor, by: 'admin' });
    dropStatus();
    return json(res, r.busy ? 409 : r.ok ? 200 : 502, r.busy ? { error: r.output } : r);
  }

  async function demoRevoke({ req, res, m }) {
    if (badOrigin(req, res)) return;
    await revokeGrant(m[1], { ip: ipOf(req), by: 'console' }); // throws a 404 HttpError when there is no such grant; a database failure is a real 500
    return json(res, 200, { ok: true });
  }

  // Remove every audit event (address, browser) recorded for one customer's link.
  async function demoForget({ req, res, m }) {
    if (badOrigin(req, res)) return;
    const g = await store.grants.findById(m[1]);
    if (!g) throw new HttpError(404, 'No such demo link');
    if (isActive(g)) throw new HttpError(409, 'Revoke the link first; it is still active');
    const removed = await store.audit.deleteForGrant(m[1]);
    await store.grants.anonymize(m[1]); // the name on the grant goes too
    audit({ ev: EVENTS.grantForgotten, ip: ipOf(req), removed }); // deliberately without the grant id
    return json(res, 200, { ok: true, removed });
  }

  // method + path (an exact string or a pattern) -> handler. First match wins.
  const routes = [
    ['GET', '/api/session', ({ res, pw }) => json(res, 200, { passwordMode: pw })],
    ['GET', '/api/audit', apiAudit],
    ['GET', '/', ({ res }) => html(res, 200, readFileSync(join(here, 'index.html')))],
    ['GET', '/api/apps', apiApps],
    ['GET', /^\/api\/apps\/([\w-]+)\/logs$/, appLogs],
    ['POST', /^\/api\/apps\/([\w-]+)\/(start|stop|restart)$/, appAction],
    ['GET', '/api/demos', demosList],
    ['POST', '/api/demos', demoCreate],
    ['GET', /^\/api\/demos\/([a-f0-9]{8,16})\/activity$/, demoActivity],
    ['POST', /^\/api\/demos\/([\w-]+)\/reset$/, demoReset],
    ['POST', /^\/api\/demos\/([a-f0-9]{8,16})\/revoke$/, demoRevoke],
    ['POST', /^\/api\/demos\/([a-f0-9]{8,16})\/forget$/, demoForget],
  ];
  const matchRoute = (method, pathname) => {
    for (const [verb, path, handler] of routes) {
      if (verb !== method) continue;
      const m = typeof path === 'string' ? (pathname === path ? [] : null) : pathname.match(path);
      if (m) return { handler, m };
    }
    return null;
  };

  async function handle(req, res) {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    if (!o.allowedHosts.includes(host)) { res.writeHead(403); return res.end('Forbidden'); }
    const url = new URL(req.url, `${o.scheme}://${req.headers.host}`);
    // Health check for the container / load balancer: no data, no login needed.
    if (req.method === 'GET' && url.pathname === '/_pd/healthz') {
      try { await dbHealthy(); return json(res, 200, { ok: true }); } catch (e) { logger.error('health check failed', { err: e }); return json(res, 503, { ok: false }); }
    }
    const pw = await passwordMode();
    if (!(await authenticate(req, res, url, pw))) return;

    const hit = matchRoute(req.method, url.pathname);
    if (hit) return hit.handler({ req, res, url, m: hit.m, pw });

    const known = url.pathname === '/' || /^\/api\/(session|audit|apps|demos)(\/|$)/.test(url.pathname) || url.pathname === '/login' || url.pathname === '/logout';
    if (known && req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); return res.end('Method not allowed'); }
    res.writeHead(404); res.end('Not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const { status, body } = toResponse(e);
      if (status >= 500) logger.error('console error', { err: e, method: req.method, path: String(req.url).split('?')[0] });
      if (res.headersSent) return res.destroy();
      json(res, status, body);
    });
  });
  const pruneTimer = setInterval(() => { Promise.resolve(store.sessions.prune()).catch((err) => logger.warn('session prune failed', { err })); }, HOUR);
  pruneTimer.unref();

  return {
    server, launchToken, passwordMode,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject); // e.g. EADDRINUSE
      server.listen(o.port, o.bindHost, () => { server.off('error', reject); resolve(server.address().port); });
    }),
    close: () => new Promise((r) => { clearInterval(pruneTimer); server.close(r); server.closeAllConnections?.(); }),
  };
}
