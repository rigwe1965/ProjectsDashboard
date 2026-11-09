// Demo gateway core: host-based reverse proxy. <product>.<base host> -> that product's demo instance.
// A customer's link carries a token bound to ONE product; the cookie is re-validated on every request,
// so expiry and revocation take effect immediately. Another product's host with the same cookie is
// refused. It knows nothing about production instances: it only ever proxies to registry entries with
// demoOf + demoReady:true.
//
// WebSockets (needed by Streamlit apps) are proxied too. They are checked once when they open, and then
// re-checked every `wsRecheckMs`, so revoking a grant also cuts off sockets that are already open.
//
// The parts: pages.mjs (own pages), redeem.mjs (opening a link), proxy-headers.mjs (what goes to the demo app and what comes back),
// websocket.mjs (upgrades), instances.mjs (private copies), reset.mjs (shared demos). This file wires them to the server.
import http from 'node:http';
import { pipeline } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { createGrants, isActive } from './grants.mjs';
import { demoApps } from '../lib/registry.mjs';
import { getStore } from '../lib/store/index.mjs';
import { ports } from '../lib/config.mjs';
import { cookieOf as readCookie, clientIp, limitKey, safeEq, json } from '../lib/http-util.mjs';
import { num, fireAndForget, unmapV4 } from '../lib/util.mjs';
import { logger } from '../lib/log.mjs';
import { runSupervisor } from '../lib/run-supervisor.mjs';
import { resetSweep } from './reset.mjs';
import { createInstances } from './instances.mjs';
import { makePages, deniedRecord, HSTS } from './pages.mjs';
import { createRedeemHandler } from './redeem.mjs';
import { createUpgradeHandler } from './websocket.mjs';
import { upstreamPort, requestHeaders, responseHeaders } from './proxy-headers.mjs';
import { createMetrics } from '../lib/metrics.mjs';
import { hashSessionId } from '../lib/auth.mjs';

const COOKIE_BASE = 'pd_demo';
// Device lock: a random id kept in this cookie (only its hash is stored with the grant). A User-Agent string is shared by
// everyone with the same browser, so it could not pin a link to one browser.
const DEV_BASE = 'pd_dev';
// Next.js dev servers expose helper routes that return source-code excerpts and open an editor on the host. A customer has no use
// for them, so the gateway answers them itself instead of forwarding.
const DEV_ONLY_PATH = /^\/__nextjs_[\w-]*/;
// The link token (48 hex) is only ever presented at /d/<token>. The browser's cookie holds a DIFFERENT random value
// (64 hex) minted at redemption, so the link cannot double as a cookie and skip the use limit / device lock.
const SESSION_RE = /^[a-f0-9]{64}$/;

// Options (all have environment-variable defaults, see demo-gateway/README.md)
export async function createGateway(opts = {}) {
  const o = {
    port: ports.gateway,
    baseHost: process.env.DEMO_BASE_HOST,
    scheme: process.env.DEMO_SCHEME || 'http',
    upstreamTimeoutMs: num(process.env.GATEWAY_UPSTREAM_TIMEOUT_MS, 60000), // an upstream silent this long gets a 504
    maxBodyBytes: num(process.env.GATEWAY_MAX_BODY_MB, 50) * 1048576,
    wsRecheckMs: num(process.env.GATEWAY_WS_RECHECK_MS, 5000),
    maxWsPerGrant: num(process.env.GATEWAY_MAX_WS_PER_GRANT, 20),
    metricsToken: process.env.METRICS_TOKEN || '', // /_pd/metrics needs this bearer token (without one: loopback only)
    redeemPerMinute: num(process.env.GATEWAY_REDEEM_PER_MINUTE, 20), // link opens per IP per minute
    redeemFailLimit: num(process.env.GATEWAY_REDEEM_FAIL_LIMIT, 10), // bad links per IP per 10 minutes before it is refused
    noSessionPerMinute: num(process.env.GATEWAY_NO_SESSION_PER_MINUTE, 120), // requests per IP per minute without a valid session before a 429
    trustedProxies: (process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean),
    store: null, // the store to use; null = the process-wide one (lib/store/index.mjs)
    supervisor: runSupervisor, // how a demo instance is reset (see reset.mjs)
    ...opts,
  };
  // Over HTTPS the __Host- prefix makes browsers refuse these cookies unless they are Secure, host-only and Path=/, so no
  // other site or sibling host can plant them. (Over plain HTTP the prefix is not allowed, so the plain names are used.)
  const https = o.scheme === 'https';
  const cookiePrefix = https ? '__Host-' : '';
  const COOKIE = cookiePrefix + COOKIE_BASE, DEV_COOKIE = cookiePrefix + DEV_BASE;
  const baseHost = o.baseHost || `localhost:${o.port}`;
  const baseName = baseHost.split(':')[0];
  const { page, tooMany } = makePages(https);
  const trusted = new Set(o.trustedProxies);
  const store = o.store ?? await getStore(); // a store can be passed in (tests, or a second gateway); the default is the process-wide one
  const { findGrant } = createGrants(store);
  const instances = createInstances({ store, supervisor: o.supervisor }); // private copies, one per link (registry perLink)
  // An audit failure must never break a customer's request.
  const audit = (e) => fireAndForget(() => store.audit.add(e), (err) => logger.warn('audit write failed', { err }));
  // Rate limits live in the database (pruned there, survive restarts).
  const limited = async (ip) => (await store.rateLimit.hit('redeem:' + limitKey(ip), 60000, o.redeemPerMinute)) > o.redeemPerMinute;
  // A browser whose link was just revoked keeps retrying (Streamlit reconnects in a loop). Record the first few
  // denials per grant and place, not every retry, so the audit log stays readable.
  const auditDenied = async (key, e) => { if ((await store.rateLimit.hit('audit-denied:' + key, 60000, 3)) <= 3) audit(e); };
  const uaOf = (req) => String(req.headers['user-agent'] || '').slice(0, 200);
  try { await store.grantSessions.prune(); } catch (err) { logger.warn('session prune failed at startup', { err }); }
  const pruneTimer = setInterval(() => { Promise.resolve(store.grantSessions.prune()).catch((err) => logger.warn('session prune failed', { err })); }, 3600000);
  pruneTimer.unref();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
  // A request with no valid session still costs a database read. Count those per address in memory (no database writes) and
  // answer 429 past a limit, so a flood of cookie-less or bogus-cookie requests cannot be used to hammer the database.
  const misses = new Map(); // limitKey(ip) -> { n, t }
  const tooManyMisses = (ip) => {
    const now = Date.now(), key = limitKey(ip), b = misses.get(key); // an IPv6 client counts as its whole /64
    if (!b || now - b.t > 60000) { misses.set(key, { n: 1, t: now }); return false; }
    return ++b.n > o.noSessionPerMinute;
  };
  const missTimer = setInterval(() => { const cut = Date.now() - 60000; for (const [k, v] of misses) if (v.t < cut) misses.delete(k); }, 60000);
  missTimer.unref();
  const wsCounts = new Map(); // grant id -> open sockets
  const wsClosers = new Set();
  const releaseWs = (id) => { const left = (wsCounts.get(id) || 1) - 1; if (left > 0) wsCounts.set(id, left); else wsCounts.delete(id); };

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
  async function health(res) {
    try { await store.meta.get('health-check'); json(res, 200, { ok: true }); } catch (e) { logger.error('health check failed', { err: e }); json(res, 503, { ok: false }); }
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
    const peer = unmapV4(req.socket.remoteAddress);
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
  const redeem = createRedeemHandler({ o, store, instances, findGrant, limited, audit, metrics, page, tooMany, uaOf, COOKIE, DEV_COOKIE, https });
  const upgrade = createUpgradeHandler({ o, trusted, resolveRequest, grantFor, tooManyMisses, auditDenied, uaOf, instances, wsCounts, wsClosers, releaseWs, audit, metrics });

  async function handle(req, res) {
    const { hostHdr, slug, target } = resolveRequest(req);
    if (!target) return page(res, 404, 'Not found', 'This demo address does not exist.');
    const ip = clientIp(req, trusted);
    const url = new URL(req.url, `${o.scheme}://${hostHdr}`);

    // 1. Link redemption
    const m = url.pathname.match(/^\/d\/([a-f0-9]{48})$/);
    if (m) return redeem(req, res, { m, slug, target, ip });

    // 2. Every other request needs a live grant for THIS product
    const g = await grantFor(req);
    if (!g) return tooManyMisses(ip) ? tooMany(res, 60) : page(res, 401, 'Demo access needed', 'Please open the personal demo link you were sent.');
    if (!isActive(g) || g.app !== slug) {
      await auditDenied(g.id + ':' + ip, deniedRecord(g.id, slug, ip, uaOf(req)));
      return page(res, 403, 'Demo ended', 'This demo has ended or is not available for your account.');
    }

    // 3. Proxy to the demo instance (never forward the gateway cookie)
    if (DEV_ONLY_PATH.test(url.pathname)) return page(res, 404, 'Not found', 'That page does not exist.');
    if (Number(req.headers['content-length']) > o.maxBodyBytes) return page(res, 413, 'Upload too large', 'That file is bigger than this demo allows.');
    let slot = null;
    if (target.perLink) {
      let inst = await instances.lookup(slug, g.id);
      if (inst?.state !== 'ready') inst = await instances.ensure(slug, target, g.id).then((r) => ({ ...r, state: r.status }));
      if (inst.state !== 'ready') {
        if (inst.state === 'full') return page(res, 503, 'All demo seats are taken', 'Every private demo seat is in use right now. Please try again in a few minutes.', { 'retry-after': '60' });
        if (inst.state === 'failed') return page(res, 503, 'Demo could not start', 'Your private demo did not start. Please wait a moment and refresh this page to try again.', { 'retry-after': '20' });
        // starting: a page that checks again by itself
        return page(res, 503, 'Preparing your demo', 'Your private copy is being set up. This page refreshes by itself and takes up to a minute.', { 'retry-after': '3' }, '<meta http-equiv=refresh content=3>');
      }
      slot = inst.slot; instances.touch(slug, slot);
    }
    const { host: upHost, port } = upstreamPort(target, url.pathname, slot);
    const headers = requestHeaders(req, { upHost, port, hostHdr, scheme: o.scheme, trusted });
    const up = http.request({ host: upHost, port, method: req.method, path: req.url, headers, agent }, (ur) => {
      const out = responseHeaders(ur.headers, { upHost, port, hostHdr, scheme: o.scheme, https, hsts: HSTS });
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
      // Only a refused connection means the copy's process is gone. A browser that cancels a request also ends here (a reset or
      // hang-up), and treating that as a crash would restart the copy and throw away the customer's data.
      if (slot !== null && e.code === 'ECONNREFUSED') instances.markDown(slug, slot, g.id).catch(() => {});
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
    // One pass of the automatic reset: demos nobody can still be using go back to their seeded state (server.mjs runs it on a timer).
    resetSweep: () => resetSweep({ store, apps: demoApps(), supervisor: o.supervisor }),
    // Private copies (one per link): stop those whose link ended or that sit unused; remove leftovers after a restart (server.mjs runs these).
    instanceSweep: () => instances.sweep(demoApps()),
    instanceReconcile: () => instances.reconcile(demoApps()),
    instances,
    listen: (host = '127.0.0.1') => new Promise((resolve, reject) => {
      server.once('error', reject); // e.g. EADDRINUSE
      server.listen(o.port, host, () => { server.off('error', reject); resolve(server.address().port); });
    }),
    close: async () => {
      clearInterval(pruneTimer); clearInterval(missTimer);
      for (const c of [...wsClosers]) c();
      agent.destroy();
      await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    },
  };
}
