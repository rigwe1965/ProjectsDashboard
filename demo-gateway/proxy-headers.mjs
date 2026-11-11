// What the gateway sends to a demo app and what it lets back. Pure functions: no state, no I/O.
import { instanceApp } from '../lib/instance-app.mjs';
import { unmapV4 } from '../lib/util.mjs';

// Cookies the gateway owns, with or without the __Host- prefix. A demo app must not be able to overwrite or clear them.
export const OURS = /^\s*(__Host-)?pd_(demo|dev)=/i;
// Headers that frameworks read as "the client's address". A customer must not be able to present a false one to the demo app's
// own logging or rate limiting, so they are dropped; the gateway's own X-Forwarded-For is the one source.
export const SPOOFABLE = new Set(['forwarded', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'x-client-ip', 'x-cluster-client-ip', 'fastly-client-ip', 'x-original-forwarded-for']);
export const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']);

// The path of a request target, decoded and with dot segments resolved, or null when the target is not one the gateway will forward (audit F-12).
// It must be origin-form: exactly one leading "/". A target like "//__nextjs_x" reads as a host name to the URL parser (so a path check passes)
// while the demo app receives the raw string; a backslash is read as "/" by the parser and not by the app. The block lists and the demoRoutes
// choice work on this decoded path, so "/%5F_nextjs_x" and "/a/../__nextjs_x" are treated as the pages they are.
export function requestPath(rawUrl) {
  const raw = String(rawUrl ?? '');
  if (!/^\/(?![/\\])/.test(raw) || raw.includes('\\')) return null;
  try { return decodeURIComponent(new URL(raw, 'http://x').pathname); } catch { return null; }
}

// A demo instance may have several processes (e.g. customer site + admin portal); registry demoRoutes maps path prefixes to them.
// Returns { host, port }: the demo instance is on this machine by default, or on another host (a container) when the
// registry process has a "host".
export function upstreamPort(target, pathname, slot = null) {
  if (slot !== null) target = instanceApp(target, slot); // this customer's private copy: its own ports
  const route = (target.demoRoutes || []).find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  const p = route ? target.processes.find((q) => q.name === route.process) : target.processes[0];
  return { host: p.host || '127.0.0.1', port: p.port };
}

export const cookiesForUpstream = (req) => (req.headers.cookie || '').split(/;\s*/).filter((c) => c && !OURS.test(c)).join('; ');

// What the demo instance sees in X-Forwarded-For: a trusted proxy's chain plus that proxy; otherwise just the peer.
// A client-supplied header from an untrusted peer is dropped, never passed on.
export function forwardedFor(req, trusted) {
  const peer = unmapV4(req.socket.remoteAddress);
  const prior = req.headers['x-forwarded-for'];
  return trusted.has(peer) && prior ? `${prior}, ${peer}` : peer;
}

// The request headers for the demo app: the customer's, minus hop-by-hop, our cookies, spoofable address headers and any x-forwarded-*,
// plus the gateway's own Host / X-Forwarded-* values.
export function requestHeaders(req, { upHost, port, hostHdr, scheme, trusted }) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== 'cookie' && k !== 'host' && !k.startsWith('x-forwarded-') && !SPOOFABLE.has(k)) headers[k] = v;
  const rest = cookiesForUpstream(req);
  if (rest) headers.cookie = rest;
  headers.host = `${upHost}:${port}`;
  headers['x-forwarded-host'] = hostHdr; headers['x-forwarded-proto'] = scheme; headers['x-forwarded-for'] = forwardedFor(req, trusted);
  return headers;
}

// The app's answer to a WebSocket upgrade, as raw header text (status line first, no blank line), for the customer's browser: the same
// cookie rules as responseHeaders (not ours, no Domain=). Other lines pass as they are (Sec-WebSocket-Accept, subprotocol, ...).
export function upgradeResponseHead(headText) {
  const [status, ...lines] = headText.split('\r\n');
  const kept = lines.filter((l) => !(/^set-cookie:/i.test(l) && OURS.test(l.slice(l.indexOf(':') + 1))))
    .map((l) => (/^set-cookie:/i.test(l) ? l.replace(/;\s*domain=[^;]*/gi, '') : l));
  return [status, ...kept].join('\r\n');
}

// The demo app's response headers for the customer's browser.
export function responseHeaders(upstreamHeaders, { upHost, port, hostHdr, scheme, https, hsts }) {
  const out = {};
  for (const [k, v] of Object.entries(upstreamHeaders)) if (!HOP.has(k)) out[k] = v;
  out['x-content-type-options'] ??= 'nosniff';
  out['referrer-policy'] ??= 'strict-origin-when-cross-origin';
  out['x-frame-options'] ??= 'SAMEORIGIN'; // demo pages cannot be framed by another site (clickjacking)
  if (out['set-cookie']) {
    // A demo app may set its own cookies, but not ours, and not for the whole parent domain (Domain=.demo.example.com
    // would reach every other product's demo host).
    const kept = [].concat(out['set-cookie']).filter((c) => !OURS.test(c)).map((c) => c.replace(/;\s*domain=[^;]*/gi, ''));
    if (kept.length) out['set-cookie'] = kept; else delete out['set-cookie'];
  }
  if (https) out['strict-transport-security'] ??= hsts;
  if (out.location) out.location = String(out.location).replace(new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|${upHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}):${port}`), `${scheme}://${hostHdr}`);
  return out;
}
