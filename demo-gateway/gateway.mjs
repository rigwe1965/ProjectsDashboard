// Demo gateway core: host-based reverse proxy. <product>.<base host> -> that product's demo instance.
// A customer's link carries a token bound to ONE product; the cookie is re-validated on every request,
// so expiry and revocation take effect immediately. Another product's host with the same cookie is
// refused. It knows nothing about production instances: it only ever proxies to registry entries with
// demoOf + demoReady:true.
//
// WebSockets (needed by Streamlit apps) are proxied too. They are checked once when they open, and then
// re-checked every `wsRecheckMs`, so revoking a grant also cuts off sockets that are already open.
import http from 'node:http';
import net from 'node:net';
import { pipeline } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { findGrant, isActive, demoApps } from './grants.mjs';
import { getStore } from '../lib/store/index.mjs';
import { cookieOf as readCookie, clientIp, safeEq } from '../lib/http-util.mjs';
import { logger } from '../lib/log.mjs';
import { createMetrics } from '../lib/metrics.mjs';
import { sha256, newSessionId, hashSessionId } from '../lib/auth.mjs';

const COOKIE = 'pd_demo';
// The link token (48 hex) is only ever presented at /d/<token>. The browser's cookie holds a DIFFERENT random value
// (64 hex) minted at redemption, so the link cannot double as a cookie and skip the use limit / device lock.
const SESSION_RE = /^[a-f0-9]{64}$/;
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']);
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

const HTTPS = (process.env.DEMO_SCHEME || 'http') === 'https';
const OWN_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", ...(HTTPS ? { 'strict-transport-security': 'max-age=31536000' } : {}) };
const page = (res, code, title, msg, headers = {}) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...OWN_HEADERS, ...headers });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:17px system-ui;max-width:32rem;margin:15vh auto;padding:0 20px;color:#222"><h1 style="font-size:22px">${title}</h1><p>${msg}</p>`);
};

// Options (all have environment-variable defaults, see demo-gateway/README.md)
export async function createGateway(opts = {}) {
  const o = {
    port: num(process.env.GATEWAY_PORT, 4300),
    baseHost: process.env.DEMO_BASE_HOST,
    scheme: process.env.DEMO_SCHEME || 'http',
    upstreamTimeoutMs: num(process.env.GATEWAY_UPSTREAM_TIMEOUT_MS, 60000), // an upstream silent this long gets a 504
    maxBodyBytes: num(process.env.GATEWAY_MAX_BODY_MB, 50) * 1048576,
    wsRecheckMs: num(process.env.GATEWAY_WS_RECHECK_MS, 5000),
    maxWsPerGrant: num(process.env.GATEWAY_MAX_WS_PER_GRANT, 20),
    metricsToken: process.env.METRICS_TOKEN || '', // /_pd/metrics needs this bearer token (without one: loopback only)
    redeemPerMinute: num(process.env.GATEWAY_REDEEM_PER_MINUTE, 20), // link opens per IP per minute
    redeemFailLimit: num(process.env.GATEWAY_REDEEM_FAIL_LIMIT, 10), // bad links per IP per 10 minutes before it is refused
    trustedProxies: (process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean),
    ...opts,
  };
  const baseHost = o.baseHost || `localhost:${o.port}`;
  const baseName = baseHost.split(':')[0];
  const trusted = new Set(o.trustedProxies);
  const store = await getStore();
  // An audit failure must never break a customer's request.
  const audit = (e) => { Promise.resolve().then(() => store.audit.add(e)).catch((err) => logger.warn('audit write failed', { err })); };
  // Rate limits live in the database (pruned there, survive restarts).
  const limited = async (ip) => (await store.rateLimit.hit('redeem:' + ip, 60000)) > o.redeemPerMinute;
  // A browser whose link was just revoked keeps retrying (Streamlit reconnects in a loop). Record the first few
  // denials per grant and place, not every retry, so the audit log stays readable.
  const auditDenied = async (key, e) => { if ((await store.rateLimit.hit('audit-denied:' + key, 60000)) <= 3) audit(e); };
  const uaOf = (req) => String(req.headers['user-agent'] || '').slice(0, 200);
  try { await store.grantSessions.prune(); } catch (err) { logger.warn('session prune failed at startup', { err }); }
  const pruneTimer = setInterval(() => { Promise.resolve(store.grantSessions.prune()).catch((err) => logger.warn('session prune failed', { err })); }, 3600000);
  pruneTimer.unref();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
  const wsCounts = new Map(); // grant id -> open sockets
  const wsClosers = new Set();

  // Metrics (Prometheus text at /_pd/metrics) and health (/_pd/healthz). Both are answered before host routing and
  // before any grant check, so a load balancer or monitor needs no demo link. Metrics have no per-customer labels.
  const metrics = createMetrics();
  const startedAt = Date.now();
  metrics.describe('pd_gateway_requests_total', 'HTTP responses sent by the gateway, by status class');
  metrics.describe('pd_gateway_redeem_total', 'Demo link opens by result (ok, denied, limited)');
  metrics.describe('pd_gateway_upstream_errors_total', 'Demo instance failures by kind (timeout, unreachable)');
  metrics.describe('pd_gateway_websockets_total', 'WebSocket connections opened');
  metrics.describe('pd_gateway_websockets_open', 'WebSocket connections currently open');
  metrics.describe('pd_gateway_uptime_seconds', 'Seconds since the gateway started');
  metrics.describe('pd_gateway_handler_errors_total', 'Unexpected errors inside a request handler (answered with a 500)');
  metrics.gauge('pd_gateway_websockets_open', () => [...wsCounts.values()].reduce((a, b) => a + b, 0));
  metrics.gauge('pd_gateway_uptime_seconds', () => Math.round((Date.now() - startedAt) / 1000));
  const jsonRes = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  async function health(res) {
    try { await store.meta.get('health-check'); jsonRes(res, 200, { ok: true }); } catch (e) { logger.error('health check failed', { err: e }); jsonRes(res, 503, { ok: false }); }
  }
  // Caddy's on-demand TLS asks this before obtaining a certificate for a host name, so certificates are issued only for
  // real demo addresses (<product>.<base host>), never for arbitrary names someone points at the server.
  // Only answers direct calls: a request that came through the proxy carries X-Forwarded-For and gets a 404.
  function tlsAsk(req, res) {
    const domain = String(new URL(req.url, 'http://x').searchParams.get('domain') || '').toLowerCase();
    const slug = domain.endsWith('.' + baseName) ? domain.slice(0, -(baseName.length + 1)) : null;
    const ok = !req.headers['x-forwarded-for'] && slug && !slug.includes('.') && demoApps()[slug];
    res.writeHead(ok ? 200 : 404, { 'cache-control': 'no-store' }); res.end();
  }
  function metricsAllowed(req) {
    if (o.metricsToken) return safeEq(String(req.headers.authorization || '').replace(/^Bearer /, ''), o.metricsToken);
    const peer = String(req.socket.remoteAddress).replace(/^::ffff:/, '');
    return (peer === '127.0.0.1' || peer === '::1') && !req.headers['x-forwarded-for']; // not something a proxy forwarded
  }

  // The grant behind the request's session cookie (null when there is no valid session). The grant's own state
  // (revoked / expired / product) is checked by the caller on every request, so revocation stays immediate.
  async function grantFor(req) {
    const sid = readCookie(req, COOKIE);
    if (!SESSION_RE.test(sid)) return null;
    const s = await store.grantSessions.get(hashSessionId(sid));
    return s ? (await store.grants.findById(s.grantId)) : null;
  }

  function resolveRequest(req) {
    const hostHdr = (req.headers.host || '').toLowerCase();
    const [hostName] = hostHdr.split(':');
    const slug = hostName.endsWith('.' + baseName) ? hostName.slice(0, -(baseName.length + 1)) : null;
    const target = slug && !slug.includes('.') ? demoApps()[slug] : null;
    return { hostHdr, slug, target };
  }
  // A demo instance may have several processes (e.g. customer site + admin portal); registry demoRoutes maps path prefixes to them.
  // Returns { host, port }: the demo instance is on this machine by default, or on another host (a container) when the
  // registry process has a "host".
  function upstreamPort(target, pathname) {
    const route = (target.demoRoutes || []).find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
    const p = route ? target.processes.find((q) => q.name === route.process) : target.processes[0];
    return { host: p.host || '127.0.0.1', port: p.port };
  }
  const cookiesForUpstream = (req) => (req.headers.cookie || '').split(/;\s*/).filter((c) => c && !c.startsWith(COOKIE + '=')).join('; ');
  // What the demo instance sees in X-Forwarded-For: a trusted proxy's chain plus that proxy; otherwise just the peer.
  // A client-supplied header from an untrusted peer is dropped, never passed on.
  const forwardedFor = (req) => {
    const peer = String(req.socket.remoteAddress).replace(/^::ffff:/, '');
    const prior = req.headers['x-forwarded-for'];
    return trusted.has(peer) && prior ? `${prior}, ${peer}` : peer;
  };

  async function handle(req, res) {
    const { hostHdr, slug, target } = resolveRequest(req);
    if (!target) return page(res, 404, 'Not found', 'This demo address does not exist.');
    const ip = clientIp(req, trusted);
    const url = new URL(req.url, `${o.scheme}://${hostHdr}`);

    // 1. Link redemption
    const m = url.pathname.match(/^\/d\/([a-f0-9]{48})$/);
    if (m) {
      const ua = uaOf(req);
      if (await limited(ip) || (await store.rateLimit.hit('redeem-link:' + m[1].slice(0, 12), 60000)) > 30) { metrics.inc('pd_gateway_redeem_total', { result: 'limited' }); return page(res, 429, 'Too many attempts', 'Please wait a minute and try again.', { 'retry-after': '60' }); }
      const g = await findGrant(m[1]);
      if (!isActive(g) || g.app !== slug) {
        audit({ ev: 'denied', app: slug, ip, ua, why: !g ? 'unknown' : g.revoked ? 'revoked' : g.app !== slug ? 'wrong-app' : 'expired' });
        metrics.inc('pd_gateway_redeem_total', { result: 'denied' });
        // repeated bad links from one address (guessing, or a stale bookmark in a loop): stop answering for a while
        if ((await store.rateLimit.hit('redeem-fail:' + ip, 600000)) > o.redeemFailLimit) return page(res, 429, 'Too many attempts', 'Please wait a few minutes and try again.', { 'retry-after': '600' });
        return page(res, 403, 'Link not valid', 'This demo link has expired or is no longer active. Please contact us for a new one.');
      }
      // counts this use and enforces the link's limits (maximum opens, pinned browser) in one atomic step
      const use = await store.grants.redeem(g.id, sha256(ua));
      if (!use.ok) {
        metrics.inc('pd_gateway_redeem_total', { result: 'denied' });
        audit({ ev: 'denied', grant: g.id, app: slug, ip, ua, why: use.why });
        return page(res, 403, 'Link not available', use.why === 'device-locked'
          ? 'This link is tied to the browser it was first opened in. Please contact us if you need a new one.'
          : 'This link has already been used the maximum number of times. Please contact us for a new one.');
      }
      metrics.inc('pd_gateway_redeem_total', { result: 'ok' });
      audit({ ev: 'enter', grant: g.id, app: slug, ip, ua });
      const maxAge = Math.max(1, Math.floor((Date.parse(g.expiresAt) - Date.now()) / 1000));
      const sid = newSessionId(); // only its hash is stored
      await store.grantSessions.create(hashSessionId(sid), g.id, g.expiresAt);
      res.writeHead(302, { 'set-cookie': `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${o.scheme === 'https' ? '; Secure' : ''}`, location: '/', 'cache-control': 'no-store' });
      return res.end();
    }

    // 2. Every other request needs a live grant for THIS product
    const g = await grantFor(req);
    if (!g) return page(res, 401, 'Demo access needed', 'Please open the personal demo link you were sent.');
    if (!isActive(g) || g.app !== slug) {
      await auditDenied(g.id + ':' + ip, { ev: 'denied', grant: g.id, app: slug, ip, ua: uaOf(req) });
      return page(res, 403, 'Demo ended', 'This demo has ended or is not available for your account.');
    }

    // 3. Proxy to the demo instance (never forward the gateway cookie)
    if (Number(req.headers['content-length']) > o.maxBodyBytes) return page(res, 413, 'Upload too large', 'That file is bigger than this demo allows.');
    const { host: upHost, port } = upstreamPort(target, url.pathname);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== 'cookie' && k !== 'host' && !k.startsWith('x-forwarded-')) headers[k] = v;
    const rest = cookiesForUpstream(req);
    if (rest) headers.cookie = rest;
    headers.host = `${upHost}:${port}`;
    headers['x-forwarded-host'] = hostHdr; headers['x-forwarded-proto'] = o.scheme; headers['x-forwarded-for'] = forwardedFor(req);
    const up = http.request({ host: upHost, port, method: req.method, path: req.url, headers, agent }, (ur) => {
      const out = {};
      for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k)) out[k] = v;
      out['x-content-type-options'] ??= 'nosniff';
      out['referrer-policy'] ??= 'strict-origin-when-cross-origin';
      out['x-frame-options'] ??= 'SAMEORIGIN'; // demo pages cannot be framed by another site (clickjacking)
      if (HTTPS) out['strict-transport-security'] ??= 'max-age=31536000';
      if (out.location) out.location = String(out.location).replace(new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|${upHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}):${port}`), `${o.scheme}://${hostHdr}`);
      res.writeHead(ur.statusCode, out);
      // pipeline() keeps pipe()'s backpressure (a slow browser slows the upstream) and also ends the browser's response
      // when the upstream dies mid-body, instead of leaving it hanging
      pipeline(ur, res, (err) => { if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') logger.debug('proxy stream ended early', { err }); });
    });
    // An upstream that accepts the connection but never answers must not hold the customer's request open forever.
    up.setTimeout(o.upstreamTimeoutMs, () => up.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEOUT' })));
    up.on('error', (e) => {
      if (res.headersSent) return res.destroy();
      metrics.inc('pd_gateway_upstream_errors_total', { kind: e.code === 'ETIMEOUT' ? 'timeout' : 'unreachable' });
      if (e.code === 'ETIMEOUT') page(res, 504, 'Demo is taking too long', 'The demo did not answer in time. Please try again.');
      else page(res, 503, 'Demo unavailable', 'The demo is not running right now. Please try again shortly.');
    });
    // If the browser goes away mid-request, stop working for it.
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    req.on('error', () => up.destroy()); // the browser dropped mid-upload
    let seen = 0;
    req.on('data', (c) => {
      seen += c.length;
      if (seen > o.maxBodyBytes) { // no content-length, or it lied
        req.unpipe(up); up.destroy();
        if (!res.headersSent) page(res, 413, 'Upload too large', 'That file is bigger than this demo allows.');
        res.once('finish', () => req.destroy());
      }
    });
    req.pipe(up);
  }

  const rejectUpgrade = (socket, code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };

  async function upgrade(req, socket, head) {
    socket.on('error', () => {});
    const { hostHdr, slug, target } = resolveRequest(req);
    if (!target) return rejectUpgrade(socket, 404, 'Not Found');
    const ip = clientIp(req, trusted);
    const g = await grantFor(req);
    if (!g) return rejectUpgrade(socket, 401, 'Unauthorized');
    if (!isActive(g) || g.app !== slug) { await auditDenied(g.id + ':' + ip, { ev: 'denied', grant: g.id, app: slug, ip, ua: uaOf(req), via: 'websocket' }); return rejectUpgrade(socket, 403, 'Forbidden'); }
    if ((wsCounts.get(g.id) || 0) >= o.maxWsPerGrant) return rejectUpgrade(socket, 429, 'Too Many Requests');
    wsCounts.set(g.id, (wsCounts.get(g.id) || 0) + 1);

    const url = new URL(req.url, `${o.scheme}://${hostHdr}`);
    const { host: upHost, port } = upstreamPort(target, url.pathname);
    const upstream = net.connect({ host: upHost, port });
    let connected = false, closed = false;
    const close = (why) => {
      if (closed) return; closed = true;
      clearInterval(timer); wsClosers.delete(close);
      const left = (wsCounts.get(g.id) || 1) - 1; if (left > 0) wsCounts.set(g.id, left); else wsCounts.delete(g.id);
      socket.destroy(); upstream.destroy();
      if (why) audit({ ev: 'ws-closed', grant: g.id, app: slug, ip, why });
    };
    wsClosers.add(close);
    // Revocation and expiry apply to sockets that are already open: look the grant up again every few seconds.
    // If the database cannot be asked, the grant cannot be confirmed: after three failed checks in a row, fail closed.
    let fails = 0;
    const timer = setInterval(async () => {
      try {
        const cur = await grantFor(req); fails = 0;
        if (!isActive(cur) || cur.app !== slug) close('grant-ended');
      } catch (err) {
        logger.warn('ws grant re-check failed', { grant: g.id, fails: fails + 1, err });
        if (++fails >= 3) close('recheck-failed');
      }
    }, o.wsRecheckMs);
    timer.unref?.();

    upstream.setTimeout(10000, () => { if (!connected) { rejectUpgrade(socket, 504, 'Gateway Timeout'); close('connect-timeout'); } });
    upstream.on('error', () => { if (!connected) rejectUpgrade(socket, 503, 'Service Unavailable'); close(connected ? 'upstream-error' : 'upstream-unreachable'); });
    upstream.on('close', () => close());
    socket.on('close', () => close());
    upstream.on('connect', () => {
      connected = true; upstream.setTimeout(0); socket.setTimeout(0); socket.setNoDelay(true); upstream.setNoDelay(true);
      // Re-send the upgrade request as received, minus the gateway cookie, with Host/Origin pointed at the upstream
      // (Streamlit and similar servers refuse a WebSocket whose Origin does not match its Host).
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i], lk = k.toLowerCase();
        if (lk === 'host' || lk === 'cookie' || lk === 'origin' || lk.startsWith('x-forwarded-')) continue;
        lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: ${upHost}:${port}`);
      const rest = cookiesForUpstream(req);
      if (rest) lines.push(`Cookie: ${rest}`);
      if (req.headers.origin) lines.push(`Origin: http://${upHost}:${port}`);
      lines.push(`X-Forwarded-Host: ${hostHdr}`, `X-Forwarded-Proto: ${o.scheme}`, `X-Forwarded-For: ${forwardedFor(req)}`);
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
      metrics.inc('pd_gateway_websockets_total');
      audit({ ev: 'ws-open', grant: g.id, app: slug, ip });
    });
  }

  const server = http.createServer({ maxHeaderSize: 16384, headersTimeout: 20000 }, (req, res) => {
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && path === '/_pd/healthz') return void health(res);
    if (req.method === 'GET' && path === '/_pd/tls-ask') return void tlsAsk(req, res);
    if (req.method === 'GET' && path === '/_pd/metrics') {
      if (!metricsAllowed(req)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' }); return res.end(metrics.render());
    }
    res.on('finish', () => metrics.inc('pd_gateway_requests_total', { code: `${Math.floor(res.statusCode / 100)}xx` }));
    handle(req, res).catch((e) => {
      const id = randomBytes(4).toString('hex'); // shown to the customer, so a report can be matched to the log line
      logger.error('gateway error', { err: e, id, method: req.method, host: req.headers.host, path: req.url.split('?')[0].replace(/\/d\/[a-f0-9]{48}/, '/d/...') });
      metrics.inc('pd_gateway_handler_errors_total');
      if (!res.headersSent) page(res, 500, 'Something went wrong', `Please try again shortly. Reference: ${id}`); else res.destroy();
    });
  });
  server.on('upgrade', (req, socket, head) => {
    upgrade(req, socket, head).catch((e) => { logger.error('gateway upgrade error', { err: e }); socket.destroy(); });
  });

  return {
    server, baseHost, store, metrics,
    listen: (host = '127.0.0.1') => new Promise((resolve, reject) => {
      server.once('error', reject); // e.g. EADDRINUSE
      server.listen(o.port, host, () => { server.off('error', reject); resolve(server.address().port); });
    }),
    close: async () => {
      clearInterval(pruneTimer);
      for (const c of [...wsClosers]) c();
      agent.destroy();
      await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    },
  };
}
