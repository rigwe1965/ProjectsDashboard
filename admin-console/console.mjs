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
import { createGrants, publicGrant, demoApps } from '../demo-gateway/grants.mjs';
import { dataDir, ports } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { cookieOf as readCookie, safeEq, json, portInUse, clientIp, BASE_SECURITY_HEADERS } from '../lib/http-util.mjs';
import { getStore } from '../lib/store/index.mjs';
import { logger } from '../lib/log.mjs';
import { num, createSerialLock, fireAndForget } from '../lib/util.mjs';
import { runSupervisor } from '../lib/run-supervisor.mjs';
import { runReset, productState, isResetting, lastResetAt } from '../demo-gateway/reset.mjs';
import { listInstances } from '../demo-gateway/instances.mjs';
import { HttpError, toResponse, tooLarge } from '../lib/errors.mjs';
import { ADMIN_KEYS, verifyPassword, needsRehash, hashPassword, verifyTotp, unseal, newSessionId, hashSessionId } from '../lib/auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const COOKIE_BASE = 'pd_session';
const isPlainObject = (b) => !!b && typeof b === 'object' && !Array.isArray(b);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const defaultSupervisor = runSupervisor;

// Private demo copies of one product, for the console: how many are running, which are stuck (could not be stopped or never came up), and each copy's state.
function copySummary(table) {
  const now = Date.now();
  const copyList = Object.entries(table).map(([slot, e]) => ({ slot: Number(slot), state: e.state, minutes: Math.max(0, Math.round((now - (Number(e.seen) || Number(e.at) || now)) / 60000)) }));
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
  const registry = loadRegistry();
  const store = o.store ?? await getStore(); // a store can be passed in; the default is the process-wide one
  const { loadGrants, createGrant, revokeGrant } = createGrants(store);
  const trusted = new Set(o.trustedProxies);
  const launchToken = randomBytes(24).toString('hex');
  const busy = new Set();
  const withTotpLock = createSerialLock(); // serialises the TOTP check-and-record (one console process)
  const secure = o.scheme === 'https' ? '; Secure' : '';
  const COOKIE = (o.scheme === 'https' ? '__Host-' : '') + COOKIE_BASE; // __Host-: browsers only accept it if Secure, host-only and Path=/
  const audit = (e) => fireAndForget(() => store.audit.add(e), (err) => logger.warn('audit write failed', { err }));

  const passwordMode = async () => !!(await store.meta.get(ADMIN_KEYS.passwordHash));
  if (!LOOPBACK.has(o.bindHost) && !(await passwordMode())) {
    throw new Error(`Refusing to listen on ${o.bindHost} without a password. Run "npm run console:auth set-password" first.`);
  }
  // The hosted setup sets ADMIN_REQUIRE_TOTP=1: a password alone is not enough for a console on the internet.
  if (!LOOPBACK.has(o.bindHost) && process.env.ADMIN_REQUIRE_TOTP === '1' && !(await store.meta.get(ADMIN_KEYS.totpSecret))) {
    throw new Error(`Refusing to listen on ${o.bindHost} without 2-step codes. Run "npm run console:auth enable-totp" first (or unset ADMIN_REQUIRE_TOTP for a test).`);
  }
  // Beyond this machine the password and session cookie would cross the network: require HTTPS (a proxy in front terminates
  // it), unless the operator explicitly accepts plain HTTP for a test on one machine.
  if (!LOOPBACK.has(o.bindHost) && o.scheme !== 'https' && !o.allowHttp) {
    throw new Error(`Refusing to serve the console over plain HTTP on ${o.bindHost}. Put it behind HTTPS (ADMIN_SCHEME=https), or set ADMIN_ALLOW_HTTP=1 for a test on one machine.`);
  }

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

  async function sessionOk(req) {
    const id = readCookie(req, COOKIE);
    return /^[a-f0-9]{64}$/.test(id) && !!(await store.sessions.get(hashSessionId(id)));
  }

  async function login(req, res) {
    if (badOrigin(req, res)) return;
    const ip = clientIp(req, trusted), ua = String(req.headers['user-agent'] || '').slice(0, 200);
    // 8 tries per IP per 15 minutes (hard limit). Failed tries overall are also counted: past the cap, wrong guesses are
    // refused with 429 but a correct password + code still signs in, so a flood of bad guesses from many addresses
    // cannot lock the real owner out.
    const overall = (await store.rateLimit.count('login-fail:all', 900000)) >= o.loginMaxTotal;
    if ((await store.rateLimit.hit('login:' + ip, 900000, o.loginMaxPerIp)) > o.loginMaxPerIp) {
      return json(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' }, { 'retry-after': '900' });
    }
    let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, e.status === 413 ? 413 : 400, { error: 'bad request' }); }
    if (!isPlainObject(b)) return json(res, 400, { error: 'bad request' });
    const hash = await store.meta.get(ADMIN_KEYS.passwordHash);
    const totpStored = await store.meta.get(ADMIN_KEYS.totpSecret);
    const totpSecret = totpStored || '';
    let totpPlain = null; // the usable secret; stays null when it is encrypted and the key is missing or wrong (sign-in then fails closed)
    if (totpStored) { try { totpPlain = unseal(totpStored); } catch (err) { logger.error('cannot read the 2-step secret; sign-in is refused', { err }); } }
    // both checks always run, so timing does not reveal which of the two was wrong
    const pwOk = !!hash && await verifyPassword(String(b.password ?? ''), hash);
    // Read the last used step, check the code and record the new step as ONE unit (one login at a time), so two
    // simultaneous logins with the same code cannot both pass. Only the password-correct case burns the code.
    const step = await withTotpLock(async () => {
      const lastStep = Number((await store.meta.get(ADMIN_KEYS.totpLastStep)) ?? -1);
      const s = totpSecret ? (totpPlain ? verifyTotp(totpPlain, b.code, Date.now(), lastStep) : null) : 0;
      if (totpSecret && s !== null && pwOk) await store.meta.set(ADMIN_KEYS.totpLastStep, s);
      return s;
    });
    if (!pwOk || step === null) {
      audit({ ev: 'admin-login-failed', ip, ua });
      await store.rateLimit.hit('login-fail:all', 900000);
      if (overall) {
        // The cap does not lock the owner out (a correct password still signs in), so slow the guessers instead: each wrong
        // guess now takes longer to answer, which limits how many a distributed attacker can have in flight.
        if (o.loginPenaltyMs > 0) await new Promise((r) => setTimeout(r, o.loginPenaltyMs));
        return json(res, 429, { error: 'Too many failed attempts. Wait a few minutes and try again.' }, { 'retry-after': '300' });
      }
      return json(res, 401, { error: 'Wrong password or code.' }); // the same words whether or not 2-step is on, so that is not revealed
    }
    const id = newSessionId(), maxAge = Math.round(o.sessionHours * 3600);
    await store.sessions.create(hashSessionId(id), new Date(Date.now() + maxAge * 1000).toISOString());
    audit({ ev: 'admin-login', ip, ua });
    // the password was right: if its hash was made with an older, cheaper setting, replace it with a current one
    if (needsRehash(hash)) { try { await store.meta.set(ADMIN_KEYS.passwordHash, await hashPassword(String(b.password))); } catch (err) { logger.warn('could not upgrade the password hash', { err }); } }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`, ...securityHeaders });
    res.end(JSON.stringify({ ok: true }));
  }

  async function handle(req, res) {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    if (!o.allowedHosts.includes(host)) { res.writeHead(403); return res.end('Forbidden'); }
    const url = new URL(req.url, `${o.scheme}://${req.headers.host}`);
    // Health check for the container / load balancer: no data, no login needed.
    if (req.method === 'GET' && url.pathname === '/_pd/healthz') {
      try { await store.meta.get('health-check'); return json(res, 200, { ok: true }); } catch (e) { logger.error('health check failed', { err: e }); return json(res, 503, { ok: false }); }
    }
    const pw = await passwordMode();

    if (pw) {
      if (url.pathname === '/login' && req.method === 'GET') {
        if (await sessionOk(req)) { res.writeHead(302, { location: '/' }); return res.end(); }
        return html(res, 200, readFileSync(join(here, 'login.html')));
      }
      if (url.pathname === '/login' && req.method === 'POST') return login(req, res);
      if (url.pathname === '/logout' && req.method === 'POST') {
        if (badOrigin(req, res)) return;
        const id = readCookie(req, COOKIE); if (id) await store.sessions.delete(hashSessionId(id));
        audit({ ev: 'admin-logout', ip: clientIp(req, trusted) });
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`, ...securityHeaders });
        return res.end('{"ok":true}');
      }
      if (!(await sessionOk(req))) {
        if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'sign in required' });
        res.writeHead(302, { location: '/login' }); return res.end();
      }
    } else {
      if (url.pathname === '/' && url.searchParams.get('t')) {
        if (!safeEq(url.searchParams.get('t'), launchToken)) { res.writeHead(403); return res.end('Invalid token'); }
        res.writeHead(302, { 'set-cookie': `${COOKIE}=${launchToken}; HttpOnly; SameSite=Strict; Path=/${secure}`, location: '/' });
        return res.end();
      }
      if (!safeEq(readCookie(req, COOKIE), launchToken)) { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('Unauthorized. Open the full URL printed in the terminal where the console was started.'); }
    }

    if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { passwordMode: pw });
    // Read-only activity feed. Only a fixed set of fields leaves the server (never a token, hash or session id), and the
    // page shows them as plain text because address, browser and customer name can come from outside.
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const kind = url.searchParams.get('kind') || 'all';
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 300);
      const keep = {
        all: () => true,
        admin: (e) => e.ev.startsWith('admin-'),
        demos: (e) => !e.ev.startsWith('admin-'),
        problems: (e) => e.ev === 'admin-login-failed' || e.ev === 'denied' || e.ev === 'admin-action-refused',
      }[kind];
      if (!keep) return json(res, 400, { error: 'unknown filter' });
      const rows = (await store.audit.list(1000)).filter((e) => keep(e)).slice(0, limit)
        .map((e) => ({ t: e.t, ev: e.ev, app: e.app, grant: e.grant, ip: e.ip, ua: typeof e.ua === 'string' ? e.ua.slice(0, 120) : undefined,
          why: e.why, via: e.via, by: e.by, customer: e.customer }));
      return json(res, 200, { events: rows });
    }
    if (req.method === 'GET' && url.pathname === '/') return html(res, 200, readFileSync(join(here, 'index.html')));

    if (req.method === 'GET' && url.pathname === '/api/apps') {
      const { rows, statusError } = await statusRows();
      return json(res, 200, registry.apps.filter((a) => !a.hidden).map((a) => ({
        id: a.id, name: a.name, tagline: a.tagline, stack: a.stack, demo: a.demo, note: a._note,
        processes: a.processes.map((p) => ({ name: p.name, port: p.port, optional: !!p.optional,
          ...(rows.find((r) => r.app === a.id && r.proc === p.name) || { up: false, managed: false, url: null }) })),
      })), statusError ? { 'x-status-error': statusError } : {});
    }

    let m;
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/apps\/([\w-]+)\/logs$/))) {
      const app = registry.apps.find((a) => a.id === m[1]);
      const proc = app?.processes.find((p) => p.name === url.searchParams.get('proc'));
      if (!proc) return json(res, 404, { error: 'unknown app/process' });
      return json(res, 200, { log: tail(join(dataDir, 'logs', `${app.id}-${proc.name}.log`)) });
    }

    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/apps\/([\w-]+)\/(start|stop|restart)$/))) {
      if (!originOk(req)) { audit({ ev: 'admin-action-refused', app: m[1], why: 'bad-origin', ip: clientIp(req, trusted) }); return json(res, 403, { error: 'bad origin' }); }
      const app = registry.apps.find((a) => a.id === m[1]);
      if (!app) return json(res, 404, { error: 'unknown app' });
      const only = url.searchParams.get('proc');
      if (only && !app.processes.some((p) => p.name === only)) return json(res, 400, { error: 'unknown process' });
      if (busy.has(app.id)) { audit({ ev: 'admin-action-refused', app: app.id, why: 'busy', ip: clientIp(req, trusted) }); return json(res, 409, { error: `${app.id} is busy with another action` }); }
      busy.add(app.id);
      audit({ ev: 'admin-app-' + m[2], app: app.id, ip: clientIp(req, trusted), ...(only ? { proc: only } : {}) });
      try {
        // start/restart can legitimately wait up to 60 s per process for the app to answer
        const r = await o.supervisor([m[2], app.id, ...(only ? [`--only=${only}`] : [])], m[2] === 'stop' ? 120000 : 300000);
        if (!r.ok) logger.warn('supervisor command failed', { action: m[2], app: app.id, timedOut: !!r.timedOut });
        return json(res, r.ok ? 200 : 502, r);
      } finally { busy.delete(app.id); dropStatus(); }
    }

    if (req.method === 'GET' && url.pathname === '/api/demos') {
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
      return json(res, 200, { gatewayUp, gatewayManaged, gatewayPort: o.gatewayPort, products, grants: (await loadGrants()).map(publicGrant).reverse() });
    }
    if (req.method === 'POST' && url.pathname === '/api/demos') {
      if (badOrigin(req, res)) return;
      const b = JSON.parse((await readBody(req)) || '{}'); // SyntaxError -> 400, too large -> 413 (see toResponse)
      if (!isPlainObject(b)) throw new HttpError(400, 'Expected a JSON object');
      const { grant, link } = await createGrant({ customer: b.customer, app: b.app, hours: b.hours, maxUses: b.maxUses, deviceLock: b.deviceLock });
      return json(res, 200, { grant: publicGrant(grant), link });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/demos\/([\w-]+)\/reset$/))) {
      if (badOrigin(req, res)) return;
      const product = m[1], app = demoApps()[product];
      if (!app?.reset || app.perLink) throw new HttpError(404, 'That demo cannot be reset');
      const b = JSON.parse((await readBody(req)) || '{}');
      const inUse = productState(await loadGrants(), product).busy;
      if (inUse && !b.force) return json(res, 409, { error: `${inUse} customer link${inUse === 1 ? ' is' : 's are'} still active for this demo. Resetting now wipes what they are working on.`, inUse });
      audit({ ev: 'demo-reset-requested', app: product, forced: !!inUse, ip: clientIp(req, trusted) });
      const r = await runReset({ store, product, app, supervisor: o.supervisor, by: 'admin' });
      dropStatus();
      return json(res, r.busy ? 409 : r.ok ? 200 : 502, r.busy ? { error: r.output } : r);
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/demos\/([a-f0-9]{8})\/revoke$/))) {
      if (badOrigin(req, res)) return;
      await revokeGrant(m[1]); // throws a 404 HttpError when there is no such grant; a database failure is a real 500
      return json(res, 200, { ok: true });
    }

    const known = url.pathname === '/' || /^\/api\/(session|audit|apps|demos)(\/|$)/.test(url.pathname) || url.pathname === '/login' || url.pathname === '/logout';
    if (known && req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); return res.end('Method not allowed'); }
    res.writeHead(404); res.end('Not found');
  }

  // Process status as rows. A failed or unreadable status check is reported, never silently shown as "everything stopped".
  // Each status check starts a supervisor process and probes every app, so concurrent requests (the page asks for apps and demos at
  // the same time, from every open tab) share ONE check, and its answer is reused for a couple of seconds. An action that changes
  // what is running (start, stop, restart, reset) drops the saved answer, so the next request sees the new state.
  let statusSaved = null, statusRun = null, statusGen = 0;
  const dropStatus = () => { statusGen++; statusSaved = null; };
  function statusRows() {
    if (statusSaved && Date.now() - statusSaved.t < o.statusReuseMs) return Promise.resolve(statusSaved.v);
    if (!statusRun) {
      const gen = statusGen;
      statusRun = (async () => {
        const { ok, output } = await o.supervisor(['status', '--json'], 30000);
        let v;
        try { v = { rows: JSON.parse(output), statusError: null }; } catch {
          logger.warn('supervisor status unreadable', { ok, output: String(output).slice(0, 300) });
          v = { rows: [], statusError: ok ? 'unreadable' : 'failed' };
        }
        if (gen === statusGen && !v.statusError) statusSaved = { t: Date.now(), v };
        return v;
      })().finally(() => { statusRun = null; });
    }
    return statusRun;
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const { status, body } = toResponse(e);
      if (status >= 500) logger.error('console error', { err: e, method: req.method, path: String(req.url).split('?')[0] });
      if (res.headersSent) return res.destroy();
      json(res, status, body);
    });
  });
  const pruneTimer = setInterval(() => { Promise.resolve(store.sessions.prune()).catch((err) => logger.warn('session prune failed', { err })); }, 3600000);
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
