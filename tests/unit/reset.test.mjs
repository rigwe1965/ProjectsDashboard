// Automatic and manual reset of shared demos (SEC-03). Own registry, own database, fake supervisor: nothing real is touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pd-reset-'));
const up = http.createServer((req, res) => res.end('ok'));
const upPort = await new Promise((r) => up.listen(0, '127.0.0.1', () => r(up.address().port)));
const proc = (name, port) => ({ name, cmd: 'x', port });
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'rst', name: 'Rst', path: '.', processes: [proc('app', 19101)] },
  { id: 'rst-demo', name: 'Rst demo', path: '.', demoOf: 'rst', demoReady: true, processes: [proc('app', upPort)], reset: { steps: [{ cmd: 'x' }] } },
  { id: 'plain', name: 'Plain', path: '.', processes: [proc('app', 19102)] },
  { id: 'plain-demo', name: 'Plain demo', path: '.', demoOf: 'plain', demoReady: true, processes: [proc('app', 19103)] },
] }));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');

const grants = await import('../../demo-gateway/grants.mjs');
const { createGateway } = await import('../../demo-gateway/gateway.mjs');
const { resetSweep, runReset, productState, isResetting, lastResetAt } = await import('../../demo-gateway/reset.mjs');
const { getStore, closeStore } = await import('../../lib/store/index.mjs');
const store = await getStore();
after(async () => { up.close(); await closeStore(); rmSync(dir, { recursive: true, force: true }); });

const calls = [];
let outcome = { ok: true, output: 'done' };
const supervisor = async (args) => { calls.push(args.join(' ')); return outcome; };
const sweep = () => resetSweep({ store, apps: grants.demoApps(), supervisor });
// a customer opens a link (this is what the gateway does when the Open button is pressed)
async function open(app = 'rst') {
  const { grant } = await grants.createGrant({ customer: 'C', app, hours: 1 });
  assert.equal((await store.grants.redeem(grant.id, 'dev')).ok, true);
  return grant;
}

test('registry: reset and demoAccounts are validated', async () => {
  const { validate } = await import('../../lib/registry.mjs');
  const base = { id: 'a', name: 'A', path: '.', processes: [proc('app', 5000)] };
  assert.deepEqual(validate({ apps: [{ ...base }, { ...base, id: 'a-demo', demoOf: 'a', processes: [proc('app', 5002)], reset: { steps: [{ cmd: 'x', timeoutSec: 60 }] }, demoAccounts: [{ label: 'Sales', user: 's@x' }] }] }), []);
  const bad = (extra) => validate({ apps: [{ ...base }, { ...base, id: 'a-demo', demoOf: 'a', processes: [proc('app', 5001)], ...extra }] }).join();
  assert.match(bad({ reset: { steps: [] } }), /non-empty/);
  assert.match(bad({ reset: { steps: [{}] } }), /needs a cmd/);
  assert.match(bad({ reset: { steps: [{ cmd: 'x', timeoutSec: 0 }] } }), /timeoutSec/);
  assert.match(bad({ reset: { steps: [{ cmd: 'x {port:nope}' }] } }), /does not exist/);
  assert.match(bad({ demoAccounts: [{ user: 'x' }] }), /label and a user/);
  assert.match(validate({ apps: [{ ...base, processes: [proc('app', 5003)], reset: { steps: [{ cmd: 'x' }] } }] }).join(), /only for demo instances/);
});

test('a demo nobody opened is not reset; one with an open link waits; it resets once the link ends, and only once', async () => {
  calls.length = 0;
  await grants.createGrant({ customer: 'never opened', app: 'rst', hours: 1 });
  assert.deepEqual(await sweep(), []);
  const g = await open();
  assert.deepEqual(productState(await store.grants.list(), 'rst').busy, 1);
  assert.deepEqual(await sweep(), [], 'a customer may still be in the demo');
  await grants.revokeGrant(g.id);
  assert.deepEqual(await sweep(), [{ product: 'rst', ok: true }]);
  assert.deepEqual(calls, ['reset rst-demo']);
  assert.ok(await lastResetAt(store, 'rst'));
  assert.deepEqual(await sweep(), [], 'nothing new since the reset');
  assert.ok((await store.audit.list(50)).some((e) => e.ev === 'demo-reset' && e.app === 'rst' && e.ok === true && e.by === 'auto'));
});

test('a product with no reset block is never touched', async () => {
  calls.length = 0;
  const g = await open(), p = await open('plain');
  await grants.revokeGrant(g.id); await grants.revokeGrant(p.id);
  const done = await sweep();
  assert.deepEqual(done.map((d) => d.product), ['rst']);
  assert.deepEqual(calls, ['reset rst-demo'], 'plain-demo has no reset and is left alone');
});

test('a failed reset is retried only after a pause, and is audited', async () => {
  calls.length = 0;
  await new Promise((r) => setTimeout(r, 20)); // the link must be opened after the previous reset began
  const g = await open(); await grants.revokeGrant(g.id);
  outcome = { ok: false, output: 'boom' };
  assert.deepEqual(await sweep(), [{ product: 'rst', ok: false }]);
  assert.deepEqual(await sweep(), [], 'not retried straight away');
  assert.equal(calls.length, 1);
  assert.ok((await store.audit.list(50)).some((e) => e.ev === 'demo-reset' && e.ok === false));
  outcome = { ok: true, output: 'done' };
});

test('while a reset runs the gateway will not open links for that demo (and does not spend a use)', async () => {
  const gw = await createGateway({ port: 0, baseHost: 'localhost', redeemPerMinute: 1000, supervisor });
  const port = await gw.listen();
  const get = (path, method = 'GET') => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: 'rst.localhost:' + port } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', reject); r.end();
  });
  try {
    const { link, grant } = await grants.createGrant({ customer: 'Next', app: 'rst', hours: 1 });
    const path = '/d/' + link.split('/d/')[1];
    let release; const slow = new Promise((r) => { release = r; });
    const blocked = runReset({ store, product: 'rst', app: grants.demoApps().rst, supervisor: async () => { await slow; return { ok: true, output: '' }; }, by: 'admin' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(await isResetting(store, 'rst'), true);
    const r = await get(path, 'POST');
    assert.equal(r.status, 503); assert.match(r.body, /being reset/); assert.equal(r.headers['retry-after'], '60');
    assert.equal((await store.grants.findById(grant.id)).uses, 0);
    assert.equal((await runReset({ store, product: 'rst', app: grants.demoApps().rst, supervisor }) ).busy, true, 'a second reset does not start');
    release(); await blocked;
    assert.equal(await isResetting(store, 'rst'), false);
    assert.equal((await get(path, 'POST')).status, 302, 'and links open again afterwards');
  } finally { await gw.close(); }
});
