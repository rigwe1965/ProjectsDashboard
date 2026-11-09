// One private demo copy per customer link: seats, routing, clean-up. A fake supervisor starts and stops tiny HTTP servers on the
// copy's own ports, so the gateway's real routing is exercised. Everything is temporary: own registry, database and ports.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pd-inst-'));
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const portBase = 30000 + Math.floor(Math.random() * 20000);

const reg = { apps: [
  { id: 'pl', name: 'PL', path: '.', processes: [{ name: 'app', cmd: 'x', port: 19960 }] },
  { id: 'pl-demo', name: 'PL demo', path: '.', demoOf: 'pl', demoReady: true,
    perLink: { max: 2, portBase, idleMinutes: 5, prepare: [] },
    processes: [{ name: 'app', cmd: 'x', port: 19961 }] },
] };
writeFileSync(join(dir, 'registry.json'), JSON.stringify(reg));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');

const { createGateway } = await import('../../demo-gateway/gateway.mjs');
const grants = await import('../../demo-gateway/grants.mjs');
const { loadRegistry, validate } = await import('../../lib/registry.mjs');
const { closeStore } = await import('../../lib/store/index.mjs');

// fake supervisor: instance-start opens a server on the copy's port that names itself; instance-stop closes it
const running = new Map(); // slot -> server
const calls = [];
let failNextStart = false;
let startGate = null; // a promise the next instance-start waits for, to hold a copy in the "starting" state
async function supervisor(args) {
  calls.push(args.join(' '));
  const [cmd, , slotArg] = args, slot = Number(slotArg);
  if (cmd === 'instance-start') {
    if (startGate) await startGate;
    if (failNextStart) { failNextStart = false; return { ok: false, output: 'boom' }; }
    const srv = http.createServer((req, res) => { if (req.url === '/hang') return; res.end(`copy ${slot}: ${req.url}`); });
    await new Promise((r) => srv.listen(portBase + slot * 10, '127.0.0.1', r));
    running.set(slot, srv);
    return { ok: true, output: '' };
  }
  if (cmd === 'instance-stop') {
    const srv = running.get(slot); running.delete(slot);
    if (srv) await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
    return { ok: true, output: '' };
  }
  return { ok: false, output: 'unexpected' };
}
const gw = await createGateway({ port: 0, baseHost: 'localhost', redeemPerMinute: 1000, supervisor });
const gwPort = await gw.listen();
after(async () => { await gw.close(); for (const s of running.values()) { s.close(); s.closeAllConnections?.(); } await closeStore(); rmSync(dir, { recursive: true, force: true }); });

function request({ path = '/', method = 'GET', headers = {} }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: gwPort, path, method, headers: { host: `pl.localhost:${gwPort}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); r.end();
  });
}
async function open(customer) {
  const { grant, link } = await grants.createGrant({ customer, app: 'pl', hours: 1 });
  const token = link.split('/d/')[1];
  const r = await request({ path: '/d/' + token, method: 'POST' });
  return { id: grant.id, token, status: r.status, cookie: (r.headers['set-cookie']?.[0] || '').split(';')[0] };
}
// wait until this customer's copy answers
async function ready(g) {
  for (let i = 0; i < 100; i++) { const r = await request({ headers: { cookie: g.cookie } }); if (r.status === 200) return r; await new Promise((x) => setTimeout(x, 20)); }
  throw new Error('copy never became ready');
}

test('registry: perLink is validated (seats, ports, steps)', () => {
  assert.ok(loadRegistry());
  const base = () => JSON.parse(JSON.stringify(reg));
  const bad = (mut) => { const r = base(); mut(r.apps[1]); return validate(r).join('\n'); };
  assert.match(bad((a) => { a.perLink.max = 0; }), /perLink.max/);
  assert.match(bad((a) => { a.perLink.max = 10; }), /perLink.max/);
  assert.match(bad((a) => { a.perLink.portBase = 80; }), /portBase/);
  assert.match(bad((a) => { delete a.perLink.prepare; }), /prepare/);
  assert.match(bad((a) => { a.perLink.prepare = [{ cmd: '' }]; }), /needs a cmd/);
  assert.match(bad((a) => { a.perLink.portBase = 19961; }), /reserved or used/);
  assert.match(bad((a) => { delete a.demoOf; }), /only for demo instances/);
  assert.equal(validate(base()).length, 0);
});

test('every link gets its own copy, on its own port, and sees only that copy', async () => {
  const a = await open('A'), b = await open('B');
  assert.equal(a.status, 302); assert.equal(b.status, 302);
  const ra = await ready(a), rb = await ready(b);
  assert.notEqual(ra.body.split(':')[0], rb.body.split(':')[0], 'two customers must not share a copy');
  assert.match(ra.body, /^copy \d: \//);
  // the same customer keeps the same copy
  assert.equal((await request({ headers: { cookie: a.cookie } })).body.split(':')[0], ra.body.split(':')[0]);
});

test('a third link finds every seat taken, and is told so before its use is counted', async () => {
  const { grant, link } = await grants.createGrant({ customer: 'C', app: 'pl', hours: 1, maxUses: 1 });
  const token = link.split('/d/')[1];
  const r = await request({ path: '/d/' + token, method: 'POST' });
  assert.equal(r.status, 503);
  assert.match(r.body, /seats are taken/i);
  assert.equal((await grants.findGrant(token)).uses, 0, 'the use must not be spent');
  assert.ok(grant);
});

test('a copy that is still starting shows a self-refreshing page; a failed start can be retried', async () => {
  // free a seat first: revoke everyone and sweep
  for (const g of await grants.loadGrants()) await grants.revokeGrant(g.id).catch(() => {});
  await gw.instanceSweep();
  assert.equal(running.size, 0, 'revoked links lose their copies');
  failNextStart = true;
  const d = await open('D');
  assert.equal(d.status, 302);
  let r;
  for (let i = 0; i < 100; i++) { r = await request({ headers: { cookie: d.cookie } }); if (/could not start/i.test(r.body)) break; await new Promise((x) => setTimeout(x, 20)); }
  assert.equal(r.status, 503); assert.match(r.body, /could not start/i);
  // after the retry pause the next request starts it again
  const t0 = Date.now(); const realNow = Date.now; Date.now = () => t0 + 60000;
  try { await request({ headers: { cookie: d.cookie } }); } finally { Date.now = realNow; }
  const ok = await ready(d);
  assert.match(ok.body, /^copy \d/);
});

test('the sweep stops a copy when its link ends and when it sits unused, and frees the seat', async () => {
  for (const g of await grants.loadGrants()) await grants.revokeGrant(g.id).catch(() => {});
  await gw.instanceSweep();
  assert.equal(running.size, 0);
  assert.deepEqual(await gw.instances.list('pl'), {});
  const e = await open('E');
  await ready(e);
  assert.equal(running.size, 1);
  // idle: pretend a long time passed with no use
  const realNow = Date.now; Date.now = () => realNow() + 10 * 60000;
  let done; try { done = await gw.instanceSweep(); } finally { Date.now = realNow; }
  assert.deepEqual(done.map((x) => x.why), ['idle']);
  assert.equal(running.size, 0);
  assert.ok(calls.some((c) => c.startsWith('instance-stop pl-demo')));
  // the customer's next request gets a fresh copy
  const again = await ready(e);
  assert.match(again.body, /^copy \d/);
});

test('private copies are not reset (there is no shared data), and the notice says the demo is private', async () => {
  const { grant, link } = await grants.createGrant({ customer: 'F', app: 'pl', hours: 1 });
  const token = link.split('/d/')[1];
  const page = await request({ path: '/d/' + token });
  assert.match(page.body, /private copy/i);
  assert.ok(grant);
  assert.deepEqual(await gw.resetSweep(), []);
});

test('instance ports and data folders stay inside the copy', async () => {
  const { instanceApp, instanceDir } = await import('../../lib/instance-app.mjs');
  const app = loadRegistry().apps.find((x) => x.id === 'pl-demo');
  const i1 = instanceApp(app, 1);
  assert.equal(i1.id, 'pl-demo.i1');
  assert.equal(i1.processes[0].port, portBase + 10);
  assert.equal(i1.inst, instanceDir('pl-demo', 1));
  assert.throws(() => instanceApp(app, 2), /no instance/);
  assert.throws(() => instanceApp(app, -1), /no instance/);
  assert.ok(freePort);
});

test('a browser that cancels a request does not make the gateway think the copy is down (that would restart it and wipe the data)', async () => {
  for (const g of await grants.loadGrants()) await grants.revokeGrant(g.id).catch(() => {});
  await gw.instanceSweep();
  const h = await open('H');
  await ready(h);
  const starts = () => calls.filter((c) => c.startsWith('instance-start')).length;
  const before = starts();
  await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: gwPort, path: '/hang', headers: { host: `pl.localhost:${gwPort}`, cookie: h.cookie } });
    r.on('error', () => {}); r.end();
    setTimeout(() => { r.destroy(); setTimeout(resolve, 150); }, 100);
  });
  const after = await request({ headers: { cookie: h.cookie } });
  assert.equal(after.status, 200);
  assert.equal(starts(), before, 'the copy must not have been restarted');
  assert.equal((await gw.instances.lookup('pl', h.id)).state, 'ready');
});

test('a copy whose process has really died (connection refused) is started again on the next request', async () => {
  const j = await open('J');
  await ready(j);
  const entry = await gw.instances.lookup('pl', j.id);
  const srv = running.get(entry.slot); running.delete(entry.slot);
  await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  const starts = () => calls.filter((c) => c.startsWith('instance-start')).length;
  const before = starts();
  const dead = await request({ headers: { cookie: j.cookie } });
  assert.equal(dead.status, 503);
  const realNow = Date.now; Date.now = () => realNow() + 60000;
  try { await request({ headers: { cookie: j.cookie } }); } finally { Date.now = realNow; }
  await ready(j);
  assert.equal(starts(), before + 1, 'exactly one new start');
});

test('while a copy is starting, the customer gets a self-refreshing 503 page with the usual security headers', async () => {
  for (const g of await grants.loadGrants()) await grants.revokeGrant(g.id).catch(() => {});
  await gw.instanceSweep();
  let release; startGate = new Promise((r) => { release = r; });
  try {
    const e = await open('E');
    const r = await request({ headers: { cookie: e.cookie } });
    assert.equal(r.status, 503);
    assert.equal(r.headers['retry-after'], '3');
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    assert.match(r.body, /<meta http-equiv=refresh content=3><title>Preparing your demo<\/title>/);
    assert.match(r.body, /Your private copy is being set up/);
    release(); startGate = null;
    await ready(e);
  } finally { release?.(); startGate = null; }
});
