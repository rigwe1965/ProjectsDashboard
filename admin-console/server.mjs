// Admin console: owner-only, localhost-only. Zero dependencies.
// Security: binds 127.0.0.1; Host header must be localhost (anti DNS-rebinding);
// a random per-launch token (printed in the terminal) is exchanged for an HttpOnly
// SameSite=Strict cookie; POSTs also require a same-origin Origin header (anti CSRF).
// It exposes app names, ports and status only: never env values or .env contents.
import http from 'node:http';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadGrants, createGrant, revokeGrant, publicGrant, demoApps } from '../demo-gateway/grants.mjs';
import { root, dataDir, ports } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { cookieOf as readCookie, safeEq, json, portInUse } from '../lib/http-util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = ports.console;
const registry = loadRegistry();
const token = randomBytes(24).toString('hex');
const cookieName = 'pd_session';
const busy = new Set();

const authed = (req) => safeEq(readCookie(req, cookieName), token);

function supervisor(args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(root, 'supervisor', 'index.mjs'), ...args], { env: process.env, timeout, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, output: (stdout + stderr).trim() }));
  });
}

function tail(file, maxBytes = 12000) {
  if (!existsSync(file)) return '(no log yet)';
  const size = statSync(file).size, start = Math.max(0, size - maxBytes), len = size - start;
  const fd = openSync(file, 'r'), buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, start); closeSync(fd);
  return buf.toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403); return res.end('Forbidden'); }
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/' && url.searchParams.get('t')) {
    if (!safeEq(url.searchParams.get('t'), token)) { res.writeHead(403); return res.end('Invalid token'); }
    res.writeHead(302, { 'set-cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`, location: '/' });
    return res.end();
  }
  if (!authed(req)) { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('Unauthorized. Open the full URL printed in the terminal where the console was started.'); }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'", 'x-frame-options': 'DENY' });
    return res.end(readFileSync(join(here, 'index.html')));
  }

  if (req.method === 'GET' && url.pathname === '/api/apps') {
    const { output } = await supervisor(['status', '--json'], 30000);
    let rows = []; try { rows = JSON.parse(output); } catch { /* leave empty */ }
    return json(res, 200, registry.apps.filter((a) => !a.hidden).map((a) => ({
      id: a.id, name: a.name, tagline: a.tagline, stack: a.stack, demo: a.demo, note: a._note,
      processes: a.processes.map((p) => ({ name: p.name, port: p.port, optional: !!p.optional,
        ...(rows.find((r) => r.app === a.id && r.proc === p.name) || { up: false, managed: false, url: null }) })),
    })));
  }

  let m;
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/apps\/([\w-]+)\/logs$/))) {
    const app = registry.apps.find((a) => a.id === m[1]);
    const proc = app?.processes.find((p) => p.name === url.searchParams.get('proc'));
    if (!proc) return json(res, 404, { error: 'unknown app/process' });
    return json(res, 200, { log: tail(join(dataDir, 'logs', `${app.id}-${proc.name}.log`)) });
  }

  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/apps\/([\w-]+)\/(start|stop|restart)$/))) {
    if (req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'bad origin' });
    const app = registry.apps.find((a) => a.id === m[1]);
    if (!app) return json(res, 404, { error: 'unknown app' });
    const only = url.searchParams.get('proc');
    if (only && !app.processes.some((p) => p.name === only)) return json(res, 400, { error: 'unknown process' });
    if (busy.has(app.id)) return json(res, 409, { error: `${app.id} is busy with another action` });
    busy.add(app.id);
    try { return json(res, 200, await supervisor([m[2], app.id, ...(only ? [`--only=${only}`] : [])])); }
    finally { busy.delete(app.id); }
  }


  if (req.method === 'GET' && url.pathname === '/api/demos') {
    const gwPort = ports.gateway;
    const gatewayUp = await portInUse(gwPort);
    const { output } = await supervisor(['status', '--json'], 30000);
    let rows = []; try { rows = JSON.parse(output); } catch { /* leave empty */ }
    const products = Object.entries(demoApps()).map(([product, a]) => ({ product, instance: a.id, name: a.name, up: rows.some((r) => r.app === a.id && r.up), managed: rows.some((r) => r.app === a.id && r.managed) }));
    const gatewayManaged = rows.some((r) => r.app === 'gateway' && r.managed);
    return json(res, 200, { gatewayUp, gatewayManaged, gatewayPort: gwPort, products, grants: (await loadGrants()).map(publicGrant).reverse() });
  }
  if (req.method === 'POST' && url.pathname === '/api/demos') {
    if (req.headers.origin !== 'http://' + req.headers.host) return json(res, 403, { error: 'bad origin' });
    let body = ''; for await (const c of req) { body += c; if (body.length > 4096) return json(res, 413, { error: 'too large' }); }
    try { const b = JSON.parse(body || '{}'); const { grant, link } = await createGrant({ customer: b.customer, app: b.app, hours: b.hours }); return json(res, 200, { grant: publicGrant(grant), link }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/demos\/([a-f0-9]{8})\/revoke$/))) {
    if (req.headers.origin !== 'http://' + req.headers.host) return json(res, 403, { error: 'bad origin' });
    try { await revokeGrant(m[1]); return json(res, 200, { ok: true }); } catch (e) { return json(res, 404, { error: e.message }); }
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Admin console running. Open this URL (token changes on every launch):\n  http://127.0.0.1:${PORT}/?t=${token}`);
});
