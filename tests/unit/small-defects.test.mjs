// The smaller defects of the whole-project audit (F-18), one test each where a test is possible.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { testEnv, freePort } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-small-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (p) => fileURLToPath(new URL('../../' + p, import.meta.url));
const node = (script, args = [], env = {}, opts = {}) => spawnSync(process.execPath, [file(script), ...args], { encoding: 'utf8', timeout: 60000, env: testEnv({ DASHBOARD_DATA: join(dir, 'data'), ...env }), ...opts });

test('#1 the console keeps a "Port 5200 is already in use" message up for 10 seconds (the pattern had lost its backslash)', () => {
  const html = readFileSync(file('admin-console/index.html'), 'utf8');
  assert.ok(html.includes(String.raw`Port \d+/.test(msg)`), 'the pattern has its backslash');
  assert.ok(/Port \d+/.test('Port 5200 is already in use'));
});

test('#2 an unknown supervisor command exits 2; no command at all just prints the usage', () => {
  const bad = node('supervisor/index.mjs', ['bogus']);
  assert.equal(bad.status, 2); assert.match(bad.stdout, /Usage/);
  const none = node('supervisor/index.mjs', []);
  assert.equal(none.status, 0); assert.match(none.stdout, /Usage/);
});

test('#3 AUDIT_RETENTION_DAYS=0 does not delete the audit log at gateway start-up', async () => {
  const data = join(dir, 'ret'); const db = join(data, 'dashboard.db');
  const { openSqlite } = await import('../../lib/store/sqlite.mjs');
  const { mkdirSync } = await import('node:fs'); mkdirSync(data, { recursive: true });
  const s = openSqlite(db); s.audit.add({ t: new Date(Date.now() - 10 * 864e5).toISOString(), ev: 'enter', app: 'crm' }); s.close();
  const port = await freePort();
  const child = spawn(process.execPath, [file('demo-gateway/server.mjs')], { env: testEnv({ DASHBOARD_DATA: data, GATEWAY_PORT: String(port), AUDIT_RETENTION_DAYS: '0', DASHBOARD_SKIP_AUTOIMPORT: '1' }), stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { up = await fetch(`http://127.0.0.1:${port}/_pd/healthz`).then((r) => r.ok, () => false); if (!up) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(up, 'the gateway started');
    await new Promise((r) => setTimeout(r, 300)); // the start-up prune has run by now
    const raw = new DatabaseSync(db); const n = raw.prepare('SELECT COUNT(*) AS n FROM audit').get().n; raw.close();
    assert.ok(n >= 1, 'a ten-day-old event is kept: 0 days is ignored and the 90-day default applies');
  } finally { child.kill(); await new Promise((r) => setTimeout(r, 200)); }
});

test('#4 link ids are 64 bits, and the link is still returned when its audit record cannot be written', async () => {
  const { createGrants } = await import('../../demo-gateway/grants.mjs');
  const { demoApps } = await import('../../lib/registry.mjs');
  const product = Object.keys(demoApps())[0];
  const inserted = [];
  const store = { grants: { insert: async (g) => { inserted.push(g); } }, audit: { add: async () => { throw new Error('disk full'); } } };
  const out = [], write = process.stderr.write.bind(process.stderr); process.stderr.write = (s) => { out.push(String(s)); return true; };
  let r; try { r = await createGrants(store).createGrant({ customer: 'Acme', app: product, hours: 1 }); } finally { process.stderr.write = write; }
  assert.match(r.grant.id, /^[a-f0-9]{16}$/);
  assert.match(r.link, /\/d\/[a-f0-9]{48}$/, 'the owner still gets the link');
  assert.equal(inserted.length, 1);
  assert.match(out.join(''), /audit record could not be written/);
});

test('#5 create-demo-users sends the key as a bearer token too, like the reset script', () => {
  const src = readFileSync(file('supervisor/create-demo-users.mjs'), 'utf8');
  assert.match(src, /authorization: 'Bearer ' \+ env\.SUPABASE_SERVICE_ROLE_KEY/);
});

test('#8 the console reads the registry per request, so an edit to apps.json shows without a restart', () => {
  const src = readFileSync(file('admin-console/console.mjs'), 'utf8');
  assert.doesNotMatch(src, /const registry = loadRegistry\(\)/);
  assert.match(src, /findApp = \(id\) => loadRegistry\(\)\.apps/);
});

test('#9 the redis stub will not listen on a non-loopback address without a token', () => {
  const r = node('supervisor/redis-rest-stub.mjs', ['19999'], { REDIS_STUB_BIND: '0.0.0.0' });
  assert.equal(r.status, 2); assert.match(r.stderr, /without REDIS_STUB_TOKEN/);
});

test('#10 run-with-env: the command gets the env file but not the owner\'s other variables, and arguments keep their spaces', () => {
  const envFile = join(dir, 'x.env'); writeFileSync(envFile, 'FROM_FILE=yes\n');
  const r = spawnSync(process.execPath, [file('supervisor/run-with-env.mjs'), envFile, dir, '--', process.execPath, '-e', 'console.log(JSON.stringify([process.env.FROM_FILE, process.env.OWNER_SECRET ?? null, process.argv[1]]))', 'two words'],
    { encoding: 'utf8', env: testEnv({ OWNER_SECRET: 'hunter2' }) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').at(-1)), ['yes', null, 'two words']);
});

test('#12 the audit event names that were built from text are in EVENTS', async () => {
  const { EVENTS } = await import('../../lib/events.mjs');
  assert.equal(EVENTS.instanceReady, 'instance-ready'); assert.equal(EVENTS.instanceFailed, 'instance-failed');
  assert.equal(EVENTS.adminApp('start'), 'admin-app-start');
});
