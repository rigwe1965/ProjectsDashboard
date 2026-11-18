// Gateway throughput benchmark (not part of `npm test`). Everything is temporary: own data folder, own registry, fake upstream, random ports.
//   node tests/bench/gateway-bench.mjs [--grants=50] [--requests=20000] [--concurrency=64]
// Prints requests per second and latency percentiles for authenticated requests going through the gateway to a fake demo app.
// Run it before and after a change to the gateway or the store to see the effect.
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, d) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || d);
const GRANTS = arg('grants', 50), REQUESTS = arg('requests', 20000), CONCURRENCY = arg('concurrency', 64);

const dir = mkdtempSync(join(tmpdir(), 'pd-bench-'));
const upstream = http.createServer((req, res) => { res.setHeader('content-type', 'text/plain'); res.end('ok'); });
const upPort = await new Promise((r) => upstream.listen(0, '127.0.0.1', () => r(upstream.address().port)));
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [{ name: 'app', cmd: 'x', port: 19001 }] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, processes: [{ name: 'app', cmd: 'x', port: upPort }] },
] }));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');
delete process.env.DEMO_BOOKING_URL; delete process.env.DEMO_BRAND_NAME;

const { createGateway } = await import('../../demo-gateway/gateway.mjs');
const grants = await import('../../demo-gateway/grants.mjs');
const { closeStore } = await import('../../lib/store/index.mjs');

const gw = await createGateway({ port: 0, baseHost: 'localhost', redeemPerMinute: 1e9, requestsPerMinute: 0, noSessionPerMinute: 1e9 });
const port = await gw.listen();
const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });
const call = (path, method = 'GET', cookie) => new Promise((resolve, reject) => {
  const t0 = performance.now();
  const r = http.request({ host: '127.0.0.1', port, path, method, agent, headers: { host: `toy.localhost:${port}`, ...(cookie ? { cookie } : {}) } }, (res) => {
    res.resume(); res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - t0, cookie: (res.headers['set-cookie']?.[0] || '').split(';')[0] }));
  });
  r.on('error', reject); r.end();
});

const cookies = [];
for (let i = 0; i < GRANTS; i++) {
  const { link } = await grants.createGrant({ customer: 'bench' + i, app: 'toy', hours: 1 });
  const r = await call('/d/' + link.split('/d/')[1], 'POST');
  if (r.status !== 302 || !r.cookie) throw new Error('could not open a link: HTTP ' + r.status);
  cookies.push(r.cookie);
}

let next = 0, bad = 0;
const times = [];
const t0 = performance.now();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < REQUESTS) {
    const i = next++;
    const r = await call('/asset/' + (i % 100) + '.js', 'GET', cookies[i % cookies.length]);
    if (r.status !== 200) bad++;
    times.push(r.ms);
  }
}));
const secs = (performance.now() - t0) / 1000;
times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
console.log(JSON.stringify({ store: gw.store.kind, grants: GRANTS, requests: REQUESTS, concurrency: CONCURRENCY, failed: bad,
  requestsPerSecond: Math.round(REQUESTS / secs), p50ms: Number(pct(0.5)), p95ms: Number(pct(0.95)), p99ms: Number(pct(0.99)) }));

agent.destroy();
await gw.close();
upstream.closeAllConnections?.(); await new Promise((r) => upstream.close(r));
await closeStore();
rmSync(dir, { recursive: true, force: true });
