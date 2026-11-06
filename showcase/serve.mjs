// Local preview server for showcase/dist (static files only). Localhost, port 4200.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.SHOWCASE_PORT || 4200);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(dist, p));
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`Showcase preview: http://127.0.0.1:${PORT}/`));
