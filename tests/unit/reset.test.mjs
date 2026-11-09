// Automatic and manual reset of shared demos (SEC-03). Own registry, own database, fake supervisor: nothing real is touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testProc } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-reset-'));
const up = http.createServer((req, res) => res.end('ok'));
const upPort = await new Promise((r) => up.listen(0, '127.0.0.1', () => r(up.address().port)));
const proc = testProc;
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
// It waits first: a link counts as "opened since the last reset" only if its timestamp is later than the reset's start (millisecond
// resolution, strictly later), so a link opened in the same millisecond as the previous test's reset would wrongly look clean.
async function open(app = 'rst') {
  await new Promise((r) => setTimeout(r, 20));
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

test('host-side reset bookkeeping (container deployments): due / begin / end', async () => {
  const { beginReset, endReset, resetDue } = await import('../../demo-gateway/reset.mjs');
  for (const x of await store.grants.list()) if (x.app === 'rst' && !x.revoked) await grants.revokeGrant(x.id); // links left open by earlier tests
  await endReset(store, 'rst', { ok: true, startedAt: new Date().toISOString(), by: 'host' }); // a clean baseline
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await resetDue(store, 'rst'), 'clean', 'nothing opened since the last reset');
  const g = await open();
  assert.equal(await resetDue(store, 'rst'), 'busy', 'an opened link is still active');
  await grants.revokeGrant(g.id);
  assert.equal(await resetDue(store, 'rst'), 'due');
  const t = await beginReset(store, 'rst');
  assert.ok(t);
  assert.equal(await beginReset(store, 'rst'), null, 'a second reset cannot start while one runs');
  assert.equal(await resetDue(store, 'rst'), 'resetting');
  await endReset(store, 'rst', { ok: false, startedAt: t, by: 'host' });
  assert.equal(await resetDue(store, 'rst'), 'backoff', 'a failed reset is not retried at once');
  await store.meta.set('demo_reset_failed:rst', '');
  const t2 = await beginReset(store, 'rst');
  await endReset(store, 'rst', { ok: true, startedAt: t2, by: 'host' });
  assert.equal(await resetDue(store, 'rst'), 'clean');
  assert.ok((await store.audit.list(50)).some((e) => e.ev === 'demo-reset' && e.by === 'host' && e.ok === true));
});

test('supervisor/demo-reset-state.mjs: exit codes the host script relies on', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('../../supervisor/demo-reset-state.mjs', import.meta.url));
  const run = (...a) => spawnSync(process.execPath, [cli, ...a], { env: { ...process.env, DASHBOARD_DATA: dir, DASHBOARD_REGISTRY: join(dir, 'registry.json') }, encoding: 'utf8' });
  await store.meta.set('demo_resetting:cli', ''); // (the CLI shares this test's database)
  const due = run('due', 'cli');
  assert.equal(due.status, 1); assert.equal(due.stdout.trim(), 'clean');
  const begun = run('begin', 'cli');
  assert.equal(begun.status, 0); assert.match(begun.stdout.trim(), /^\d{4}-\d\d-\d\dT/);
  assert.equal(run('begin', 'cli').status, 3, 'already running');
  assert.equal(run('end', 'cli', 'ok', begun.stdout.trim()).status, 0);
  assert.equal(run('end', 'cli', 'maybe').status, 2);
  assert.equal(run('due', '../etc').status, 2, 'a product name is validated');
});
