// A tiny in-memory stand-in for the Upstash Redis REST API, for a DEMO instance that runs in production mode.
// The CRM insists on a shared rate-limit store in production (UPSTASH_REDIS_REST_URL / _TOKEN). A demo has one server, so
// counters in memory are exactly right, and nothing leaves the machine.
//   node supervisor/redis-rest-stub.mjs <port>      listens on 127.0.0.1 (REDIS_STUB_BIND changes that); REDIS_STUB_TOKEN (optional) is the bearer token
// Supports what the CRM uses: INCR, EXPIRE [NX], GET, SET [EX seconds], DEL, TTL. Anything else answers an error.
import http from 'node:http';

export function createStub(token = '') {
  const data = new Map(); // key -> { value: string, expires: ms | null }
  const live = (k) => {
    const e = data.get(k);
    if (e && e.expires !== null && e.expires <= Date.now()) { data.delete(k); return null; }
    return e ?? null;
  };
  function run([cmd, ...a]) {
    switch (String(cmd).toUpperCase()) {
      case 'INCR': { const e = live(a[0]); const n = (e ? Number(e.value) : 0) + 1; data.set(a[0], { value: String(n), expires: e?.expires ?? null }); return n; }
      case 'EXPIRE': {
        const e = live(a[0]); if (!e) return 0;
        if (String(a[2] ?? '').toUpperCase() === 'NX' && e.expires !== null) return 0;
        e.expires = Date.now() + Number(a[1]) * 1000; return 1;
      }
      case 'GET': return live(a[0])?.value ?? null;
      case 'SET': {
        const ex = a.findIndex((x) => String(x).toUpperCase() === 'EX');
        data.set(a[0], { value: String(a[1]), expires: ex > 0 ? Date.now() + Number(a[ex + 1]) * 1000 : null }); return 'OK';
      }
      case 'DEL': return a.reduce((n, k) => n + (data.delete(k) ? 1 : 0), 0);
      case 'TTL': { const e = live(a[0]); return !e ? -2 : e.expires === null ? -1 : Math.ceil((e.expires - Date.now()) / 1000); }
      default: throw new Error('unsupported command');
    }
  }
  // keep memory bounded: expired keys are swept every minute
  const sweep = setInterval(() => { for (const k of data.keys()) live(k); }, 60000); sweep.unref();
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); } // health check
    if (req.method !== 'POST' || !/^\/pipeline\/?$/.test(req.url)) { res.writeHead(404); return res.end(); }
    if (token && req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const cmds = JSON.parse(body);
        if (!Array.isArray(cmds) || cmds.length > 20) throw new Error('bad request');
        const out = cmds.map((c) => { try { return { result: run(c) }; } catch (e) { return { error: e.message }; } });
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
      } catch { res.writeHead(400); res.end(); }
    });
  });
  return { server, close: () => { clearInterval(sweep); server.close(); } };
}

if (process.argv[1]?.endsWith('redis-rest-stub.mjs')) {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1) { console.error('Usage: redis-rest-stub.mjs <port>'); process.exit(2); }
  const bind = process.env.REDIS_STUB_BIND || '127.0.0.1'; // 0.0.0.0 only inside a container network, together with REDIS_STUB_TOKEN
  const token = process.env.REDIS_STUB_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!token && !['127.0.0.1', '::1', 'localhost'].includes(bind)) { console.error(`Refusing to listen on ${bind} without REDIS_STUB_TOKEN: only a loopback address may run without one.`); process.exit(2); }
  createStub(process.env.REDIS_STUB_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').server.listen(port, bind, () => console.log(`rate-limit store listening on ${bind}:${port}`));
}
