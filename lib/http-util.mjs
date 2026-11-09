// Small HTTP/network helpers shared by the supervisor, admin console and demo gateway.
import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { unmapV4 } from './util.mjs';

// Value of one cookie from a request ('' when absent). Keeps '=' characters inside the value.
export function cookieOf(req, name) {
  const pair = (req.headers.cookie || '').split(/;\s*/).map((c) => c.split(/=(.*)/s)).find(([k]) => k === name);
  return pair?.[1] || '';
}

// Constant-time string comparison.
export function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// The real client address. X-Forwarded-For is believed ONLY when the connection comes from a trusted proxy
// (an address in `trusted`); otherwise anyone could spoof their IP, and so dodge the rate limit.
// Walks the chain from the right and returns the first address that is not itself a trusted proxy.
export function clientIp(req, trusted = new Set()) {
  const norm = unmapV4;
  const remote = norm(req.socket?.remoteAddress);
  if (!trusted.has(remote)) return remote;
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => norm(s.trim())).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) if (!trusted.has(chain[i])) return chain[i];
  return remote;
}

// The key a client is rate-limited under. An IPv4 address is its own key; an IPv6 client usually controls a whole /64 (2^64 addresses),
// so every address in the same /64 shares one key. Anything that is not a plain address is returned unchanged.
export function limitKey(ip) {
  ip = String(ip);
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (groups.length !== 8) return ip;
  const first = groups.slice(0, 4).map((x) => parseInt(x || '0', 16));
  return first.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? ip : first.map((n) => n.toString(16)).join(':') + '::/64';
}

// The response headers every page and API answer of the console and the gateway carries. Each adds its own content-security-policy.
export const BASE_SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
});

export function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

// True when something accepts TCP connections on 127.0.0.1:port.
export function portInUse(port, timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(timeout, () => { s.destroy(); resolve(false); });
  });
}

// Any HTTP response counts as "up". Uses node:http (not fetch): undici can throw an uncaught assertion when a
// dev server (e.g. Flask) closes the socket in an unusual way, which would crash the caller.
export function httpUp(port, path, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path, timeout: 2500 }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
