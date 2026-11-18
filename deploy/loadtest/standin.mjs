// Stand-in demo app for the staging load test (deploy/docker-compose.loadtest.yml). Not used anywhere else.
// It answers instantly with small fixed bodies so that only the gateway and its database are measured.
//   GET  /            a small page          GET /asset/<n>.js  a 2 KB body
//   POST /<any>       echoes the byte count of the body it received
//   GET  /slow        answers after ?ms=<n> (default 2000)
import http from 'node:http';

const asset = 'x'.repeat(2048);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    let n = 0;
    req.on('data', (c) => { n += c.length; });
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ bytes: n })); });
    return;
  }
  res.setHeader('content-type', 'text/plain');
  if (url.pathname === '/slow') return void setTimeout(() => res.end('slow'), Number(url.searchParams.get('ms')) || 2000);
  res.end(url.pathname.startsWith('/asset/') ? asset : 'standin');
}).listen(Number(process.env.PORT) || 9000, '0.0.0.0');
