// Load generator for the STAGING load test (docs/PLAN-staging-load-test.md). Not part of `npm test`. Zero dependencies.
//   node tests/bench/gateway-load.mjs --target=10.0.0.5:8080 --links=links.txt --scenario=get --connections=64 --duration=300
// Scenarios: get    GET /asset/N over the first 50 links
//            mixed  90% GET, 10% POST of 20 KB
//            spread GET, round robin over ALL links in the file
//            burst  open links: POST /d/<token> at --rate per second
//            ramp   get, one step per value of --steps (default 16,32,64,128,256,512), --duration seconds each
// Prints one JSON line per run: requests per second, p50/p95/p99, status counts, errors by type.
// Refuses any target containing "facyke": this tool is for the staging server only.
import http from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const target = arg('target', ''), domain = arg('domain', 'demo.test:8080'), product = arg('product', 'toy');
const scenario = arg('scenario', 'get'), connections = Number(arg('connections', 64)), duration = Number(arg('duration', 60));
const warmup = Number(arg('warmup', 0)), useLinks = Number(arg('use', 0)), rate = Number(arg('rate', 200));
const steps = arg('steps', '16,32,64,128,256,512').split(',').map(Number), out = arg('out', '');
if (!target || /facyke/i.test(target) || /facyke/i.test(domain)) {
  console.error('Refusing: give --target=<staging ip:port> (an address containing "facyke" is never allowed).');
  process.exit(2);
}
const [host, port] = target.split(':');
const tokens = readFileSync(arg('links', 'links.txt'), 'utf8').split(/\r?\n/).map((l) => (l.match(/\/d\/([\w-]+)/) || [])[1]).filter(Boolean);
if (!tokens.length) { console.error('No links in the links file.'); process.exit(2); }
const links = useLinks ? tokens.slice(0, useLinks) : tokens;

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const call = (path, method = 'GET', cookie, body) => new Promise((resolve) => {
  const t0 = performance.now();
  const headers = { host: `${product}.${domain}`, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/octet-stream', 'content-length': body.length } : {}) };
  const r = http.request({ host, port, path, method, agent, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - t0, cookie: (res.headers['set-cookie']?.[0] || '').split(';')[0] }));
  });
  r.setTimeout(30000, () => r.destroy(new Error('timeout')));
  r.on('error', (e) => resolve({ status: 0, ms: performance.now() - t0, err: e.code || e.message }));
  r.end(body);
});

// Open every link once, like a customer does, to get its session cookie.
const cookies = [];
for (let i = 0; i < links.length; i += 50) {
  await Promise.all(links.slice(i, i + 50).map(async (t, k) => {
    const r = await call('/d/' + t, 'POST');
    if (r.status !== 302 || !r.cookie) { console.error(`Could not open link ${i + k}: HTTP ${r.status} ${r.err || ''}`); process.exit(1); }
    cookies[i + k] = r.cookie;
  }));
}

const body20k = Buffer.alloc(20 * 1024, 'a');
const refusals = new Map(); // link index -> epoch ms of its first non-200 answer (used to time a revoke)

const run = async (conns, secs, kind) => {
  const stats = { n: 0, times: [], status: {}, errors: {} };
  const t0 = performance.now(), warmEnd = t0 + warmup * 1000, end = warmEnd + secs * 1000;
  let seq = 0, measuring = false, mStart = 0;
  const record = (r) => {
    if (!measuring) return;
    stats.n++; stats.times.push(r.ms);
    stats.status[r.status] = (stats.status[r.status] || 0) + 1;
    if (r.err) stats.errors[r.err] = (stats.errors[r.err] || 0) + 1;
  };
  const startMeasuring = (now) => { if (!measuring && now >= warmEnd) { measuring = true; mStart = now; } };
  if (kind === 'burst') {
    await new Promise((resolve) => {
      const tick = setInterval(() => {
        const now = performance.now();
        startMeasuring(now);
        if (now >= end) { clearInterval(tick); setTimeout(resolve, 500); return; }
        for (let j = 0; j < rate / 10; j++) call('/d/' + links[seq++ % links.length], 'POST').then(record);
      }, 100);
    });
  } else {
    await Promise.all(Array.from({ length: conns }, async () => {
      while (performance.now() < end) {
        startMeasuring(performance.now());
        const i = seq++, k = kind === 'spread' ? i % cookies.length : i % Math.min(cookies.length, 50);
        const r = kind === 'mixed' && i % 10 === 0 ? await call('/post', 'POST', cookies[k], body20k) : await call('/asset/' + (i % 100) + '.js', 'GET', cookies[k]);
        if (r.status !== 200 && r.status !== 0 && !refusals.has(k)) refusals.set(k, Date.now());
        record(r);
      }
    }));
  }
  const elapsed = (performance.now() - (mStart || t0)) / 1000;
  const t = stats.times.sort((a, b) => a - b);
  const pct = (p) => (t.length ? Number(t[Math.min(t.length - 1, Math.floor(t.length * p))].toFixed(2)) : null);
  const cpu = process.cpuUsage();
  return { scenario: kind, connections: conns, links: cookies.length, seconds: Number(elapsed.toFixed(1)), requests: stats.n, requestsPerSecond: Math.round(stats.n / elapsed),
    p50ms: pct(0.5), p95ms: pct(0.95), p99ms: pct(0.99), status: stats.status, errors: stats.errors, generatorCpuSeconds: Number(((cpu.user + cpu.system) / 1e6).toFixed(1)) };
};

const results = [];
if (scenario === 'ramp') for (const c of steps) results.push(await run(c, duration, 'get'));
else results.push(await run(connections, duration, scenario));
for (const r of results) {
  const line = JSON.stringify({ at: new Date().toISOString(), target: host, ...r });
  console.log(line);
  if (out) appendFileSync(out, line + '\n');
}
if (refusals.size) console.log(JSON.stringify({ firstRefusals: [...refusals].slice(0, 50).map(([link, atMs]) => ({ link, atMs })) }));
agent.destroy();
