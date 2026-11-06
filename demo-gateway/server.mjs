// Demo gateway: host-based reverse proxy. <product>.<base host> -> that product's demo instance.
// A customer's link carries a token bound to ONE product; the cookie is re-validated on every
// request, so expiry and revocation take effect immediately. Another product's host with the
// same cookie is refused. It knows nothing about production instances: it only ever proxies to
// registry entries with demoOf + demoReady:true.
// Not supported yet: WebSocket upgrades (needed by Streamlit-based apps, none are demo-ready).
import http from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findGrant, isActive, demoApps, dataDir } from './grants.mjs';

const PORT = Number(process.env.GATEWAY_PORT || 4300);
const BASE = process.env.DEMO_BASE_HOST || `localhost:${PORT}`;
const SCHEME = process.env.DEMO_SCHEME || 'http';
const baseName = BASE.split(':')[0];
const COOKIE = 'pd_demo';
mkdirSync(dataDir, { recursive: true });
const logFile = join(dataDir, 'demo-access.log');
const audit = (o) => appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');

const hits = new Map(); // crude per-IP limiter for the token endpoint
function limited(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter((t) => now - t < 60000);
  h.push(now); hits.set(ip, h); return h.length > 20;
}

const page = (res, code, title, msg) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:17px system-ui;max-width:32rem;margin:15vh auto;padding:0 20px;color:#222"><h1 style="font-size:22px">${title}</h1><p>${msg}</p>`);
};
const cookieOf = (req) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split(/=(.*)/s)).find(([k]) => k === COOKIE)?.[1] || '';
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']);

http.createServer((req, res) => {
  const hostHdr = (req.headers.host || '').toLowerCase();
  const [hostName] = hostHdr.split(':');
  const slug = hostName.endsWith('.' + baseName) ? hostName.slice(0, -(baseName.length + 1)) : null;
  const target = slug && !slug.includes('.') ? demoApps()[slug] : null;
  if (!target) return page(res, 404, 'Not found', 'This demo address does not exist.');
  const ip = req.socket.remoteAddress;
  const url = new URL(req.url, `${SCHEME}://${hostHdr}`);

  // 1. Link redemption
  const m = url.pathname.match(/^\/d\/([a-f0-9]{48})$/);
  if (m) {
    if (limited(ip)) return page(res, 429, 'Too many attempts', 'Please wait a minute and try again.');
    const g = findGrant(m[1]);
    if (!isActive(g) || g.app !== slug) { audit({ ev: 'denied', app: slug, ip, why: !g ? 'unknown' : g.revoked ? 'revoked' : g.app !== slug ? 'wrong-app' : 'expired' });
      return page(res, 403, 'Link not valid', 'This demo link has expired or is no longer active. Please contact us for a new one.'); }
    audit({ ev: 'enter', grant: g.id, app: slug, ip });
    const maxAge = Math.max(1, Math.floor((Date.parse(g.expiresAt) - Date.now()) / 1000));
    res.writeHead(302, { 'set-cookie': `${COOKIE}=${m[1]}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SCHEME === 'https' ? '; Secure' : ''}`, location: '/', 'cache-control': 'no-store' });
    return res.end();
  }

  // 2. Every other request needs a live grant for THIS product
  const tok = cookieOf(req);
  const g = /^[a-f0-9]{48}$/.test(tok) ? findGrant(tok) : null;
  if (!g) return page(res, 401, 'Demo access needed', 'Please open the personal demo link you were sent.');
  if (!isActive(g) || g.app !== slug) { audit({ ev: 'denied', grant: g.id, app: slug, ip });
    return page(res, 403, 'Demo ended', 'This demo has ended or is not available for your account.'); }

  // 3. Proxy to the demo instance (never forward the gateway cookie)
  // A demo instance may have several processes (e.g. customer site + admin portal); registry demoRoutes maps path prefixes to them.
  const route = (target.demoRoutes || []).find((r) => url.pathname === r.prefix || url.pathname.startsWith(r.prefix + '/'));
  const port = (route ? target.processes.find((p) => p.name === route.process) : target.processes[0]).port;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== 'cookie' && k !== 'host') headers[k] = v;
  const rest = (req.headers.cookie || '').split(/;\s*/).filter((c) => !c.startsWith(COOKIE + '=')).join('; ');
  if (rest) headers.cookie = rest;
  headers.host = `127.0.0.1:${port}`;
  headers['x-forwarded-host'] = hostHdr; headers['x-forwarded-proto'] = SCHEME;
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (ur) => {
    const out = {};
    for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k)) out[k] = v;
    if (out.location) out.location = String(out.location).replace(new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}`), `${SCHEME}://${hostHdr}`);
    res.writeHead(ur.statusCode, out); ur.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) page(res, 503, 'Demo unavailable', 'The demo is not running right now. Please try again shortly.'); else res.destroy(); });
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => console.log(`Demo gateway on ${SCHEME}://*.${BASE} (listening 127.0.0.1:${PORT}). Products: ${Object.keys(demoApps()).join(', ') || 'none ready'}`));
