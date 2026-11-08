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
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadGrants, createGrant, revokeGrant, publicGrant, demoApps } from '../demo-gateway/grants.mjs';
import { root, dataDir } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { cookieOf as readCookie, safeEq, json, portInUse, clientIp } from '../lib/http-util.mjs';
import { getStore } from '../lib/store/index.mjs';
import { logger } from '../lib/log.mjs';
import { HttpError, toResponse, tooLarge } from '../lib/errors.mjs';
import { verifyPassword, verifyTotp, newSessionId, hashSessionId } from '../lib/auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const COOKIE = 'pd_session';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

function defaultSupervisor(args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(root, 'supervisor', 'index.mjs'), ...args], { env: process.env, timeout, windowsHide: true },
      (err, stdout, stderr) => resolve({
        ok: !err,
        timedOut: !!err?.killed,
        output: ((stdout + stderr).trim() || err?.message || '') + (err?.killed ? '\n(timed out: check the status before trying again)' : ''),
      }));
  });
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
    port: num(process.env.CONSOLE_PORT, 4100),
    bindHost: process.env.ADMIN_BIND || '127.0.0.1',
    allowedHosts: (process.env.ADMIN_ALLOWED_HOSTS || '127.0.0.1,localhost').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    scheme: process.env.ADMIN_SCHEME || 'http',
    sessionHours: num(process.env.ADMIN_SESSION_HOURS, 12),
    loginMaxPerIp: 8, loginMaxTotal: 40, // sign-in attempts per 15 minutes
    trustedProxies: (process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean),
    supervisor: defaultSupervisor,
    gatewayPort: num(process.env.GATEWAY_PORT, 4300),
    ...opts,
  };
  const registry = loadRegistry();
  const store = await getStore();
  const trusted = new Set(o.trustedProxies);
  const launchToken = randomBytes(24).toString('hex');
  const busy = new Set();
  let totpChain = Promise.resolve(); // serialises the TOTP check-and-record (one console process)
  const withTotpLock = (fn) => { const run = totpChain.then(fn); totpChain = run.catch(() => {}); return run; };
  const secure = o.scheme === 'https' ? '; Secure' : '';
  const audit = (e) => { Promise.resolve().then(() => store.audit.add(e)).catch((err) => logger.warn('audit write failed', { err })); };

  const passwordMode = async () => !!(await store.meta.get('admin_password_hash'));
  if (!LOOPBACK.has(o.bindHost) && !(await passwordMode())) {
    throw new Error(`Refusing to listen on ${o.bindHost} without a password. Run "npm run console:auth set-password" first.`);
  }

  const securityHeaders = {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  };
  const html = (res, code, body) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...securityHeaders }); res.end(body); };
  const originOk = (req) => req.headers.origin === `${o.scheme}://${req.headers.host}`;
  const readBody = async (req, max = 4096) => { let b = ''; for await (const c of req) { b += c; if (b.length > max) throw tooLarge(); } return b; };

  async function sessionOk(req) {
    const id = readCookie(req, COOKIE);
    return /^[a-f0-9]{64}$/.test(id) && !!(await store.sessions.get(hashSessionId(id)));
  }

  async function login(req, res) {
    if (!originOk(req)) return json(res, 403, { error: 'bad origin' });
    const ip = clientIp(req, trusted), ua = String(req.headers['user-agent'] || '').slice(0, 200);
    // 8 tries per IP per 15 minutes (hard limit). Failed tries overall are also counted: past the cap, wrong guesses are
    // refused with 429 but a correct password + code still signs in, so a flood of bad guesses from many addresses
    // cannot lock the real owner out.
    const overall = (await store.rateLimit.count('login-fail:all', 900000)) >= o.loginMaxTotal;
    if ((await store.rateLimit.hit('login:' + ip, 900000)) > o.loginMaxPerIp) {
      return json(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' }, { 'retry-after': '900' });
    }
    let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, e.status === 413 ? 413 : 400, { error: 'bad request' }); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'bad request' });
    const hash = await store.meta.get('admin_password_hash');
    const totpSecret = await store.meta.get('admin_totp_secret');
    // both checks always run, so timing does not reveal which of the two was wrong
    const pwOk = !!hash && verifyPassword(String(b.password ?? ''), hash);
    // Read the last used step, check the code and record the new step as ONE unit (one login at a time), so two
    // simultaneous logins with the same code cannot both pass. Only the password-correct case burns the code.
    const step = await withTotpLock(async () => {
      const lastStep = Number((await store.meta.get('admin_totp_last_step')) ?? -1);
      const s = totpSecret ? verifyTotp(totpSecret, b.code, Date.now(), lastStep) : 0;
      if (totpSecret && s !== null && pwOk) await store.meta.set('admin_totp_last_step', s);
      return s;
    });
    if (!pwOk || step === null) {
      audit({ ev: 'admin-login-failed', ip, ua });
      await store.rateLimit.hit('login-fail:all', 900000);
      if (overall) return json(res, 429, { error: 'Too many failed attempts. Wait a few minutes and try again.' }, { 'retry-after': '300' });
      return json(res, 401, { error: totpSecret ? 'Wrong password or code.' : 'Wrong password.' });
    }
    const id = newSessionId(), maxAge = Math.round(o.sessionHours * 3600);
    await store.sessions.create(hashSessionId(id), new Date(Date.now() + maxAge * 1000).toISOString());
    audit({ ev: 'admin-login', ip, ua });
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
        if (!originOk(req)) return json(res, 403, { error: 'bad origin' });
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
        problems: (e) => e.ev === 'admin-login-failed' || e.ev === 'denied',
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
      if (!originOk(req)) return json(res, 403, { error: 'bad origin' });
      const app = registry.apps.find((a) => a.id === m[1]);
      if (!app) return json(res, 404, { error: 'unknown app' });
      const only = url.searchParams.get('proc');
      if (only && !app.processes.some((p) => p.name === only)) return json(res, 400, { error: 'unknown process' });
      if (busy.has(app.id)) return json(res, 409, { error: `${app.id} is busy with another action` });
      busy.add(app.id);
      audit({ ev: 'admin-app-' + m[2], app: app.id, ip: clientIp(req, trusted), ...(only ? { proc: only } : {}) });
      try {
        // start/restart can legitimately wait up to 60 s per process for the app to answer
        const r = await o.supervisor([m[2], app.id, ...(only ? [`--only=${only}`] : [])], m[2] === 'stop' ? 120000 : 300000);
        if (!r.ok) logger.warn('supervisor command failed', { action: m[2], app: app.id, timedOut: !!r.timedOut });
        return json(res, r.ok ? 200 : 502, r);
      } finally { busy.delete(app.id); }
    }

    if (req.method === 'GET' && url.pathname === '/api/demos') {
      const gatewayUp = await portInUse(o.gatewayPort);
      const { rows } = await statusRows();
      const products = Object.entries(demoApps()).map(([product, a]) => ({ product, instance: a.id, name: a.name, up: rows.some((r) => r.app === a.id && r.up), managed: rows.some((r) => r.app === a.id && r.managed) }));
      const gatewayManaged = rows.some((r) => r.app === 'gateway' && r.managed);
      return json(res, 200, { gatewayUp, gatewayManaged, gatewayPort: o.gatewayPort, products, grants: (await loadGrants()).map(publicGrant).reverse() });
    }
    if (req.method === 'POST' && url.pathname === '/api/demos') {
      if (!originOk(req)) return json(res, 403, { error: 'bad origin' });
      const b = JSON.parse((await readBody(req)) || '{}'); // SyntaxError -> 400, too large -> 413 (see toResponse)
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Expected a JSON object');
      const { grant, link } = await createGrant({ customer: b.customer, app: b.app, hours: b.hours, maxUses: b.maxUses, deviceLock: b.deviceLock });
      return json(res, 200, { grant: publicGrant(grant), link });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/demos\/([a-f0-9]{8})\/revoke$/))) {
      if (!originOk(req)) return json(res, 403, { error: 'bad origin' });
      await revokeGrant(m[1]); // throws a 404 HttpError when there is no such grant; a database failure is a real 500
      return json(res, 200, { ok: true });
    }

    const known = url.pathname === '/' || /^\/api\/(session|audit|apps|demos)(\/|$)/.test(url.pathname) || url.pathname === '/login' || url.pathname === '/logout';
    if (known && req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); return res.end('Method not allowed'); }
    res.writeHead(404); res.end('Not found');
  }

  // Process status as rows. A failed or unreadable status check is reported, never silently shown as "everything stopped".
  async function statusRows() {
    const { ok, output } = await o.supervisor(['status', '--json'], 30000);
    try { return { rows: JSON.parse(output), statusError: null }; } catch {
      logger.warn('supervisor status unreadable', { ok, output: String(output).slice(0, 300) });
      return { rows: [], statusError: ok ? 'unreadable' : 'failed' };
    }
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
