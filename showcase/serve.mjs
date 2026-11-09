// Local preview server for showcase/dist (static files only). Localhost, port 4200.
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { ports } from '../lib/config.mjs';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = ports.showcase;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

function serve(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(dist, p));
  let body;
  try {
    if (!file.startsWith(dist + sep) || !statSync(file).isFile()) throw new Error('not a file');
    body = readFileSync(file);
  } catch { res.writeHead(404); return res.end('Not found'); }
  // The built site is plain HTML and CSS with no scripts, so a strict policy costs nothing. When the site is
  // hosted elsewhere, set the same headers at the web server (see deploy/ in Stage 4).
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' });
  res.end(body);
}

http.createServer((req, res) => {
  try { serve(req, res); } catch (e) {
    console.error('showcase error:', e);
    if (!res.headersSent) res.writeHead(500);
    res.end('Error');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Showcase preview: http://127.0.0.1:${PORT}/`));
