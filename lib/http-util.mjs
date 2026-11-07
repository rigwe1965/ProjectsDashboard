// Small HTTP/network helpers shared by the supervisor, admin console and demo gateway.
import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';

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

export function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
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
export function httpUp(port, path) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 2500 }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
