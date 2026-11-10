import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSqlite, addMissingColumns, retryWhileLocked } from '../../lib/store/sqlite.mjs';
import { importLegacy } from '../../lib/store/legacy-import.mjs';

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-store-'));
  const store = openSqlite(join(dir, 'db.sqlite'));
  return { dir, store, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
};
const DEFAULTS = { uses: 0, maxUses: null, deviceLock: false, lastUsedAt: null };
const grant = (o = {}) => ({ id: 'aaaa1111', tokenHash: 'h1', customer: 'Acme', app: 'crm', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z', revoked: false, ...o });

test('grants: insert, find by hash, list order, revoke', () => {
  const { store, done } = fresh();
  store.grants.insert(grant());
  store.grants.insert(grant({ id: 'bbbb2222', tokenHash: 'h2', createdAt: '2026-01-03T00:00:00.000Z' }));
  assert.deepEqual(store.grants.findByHash('h1'), { ...grant(), ...DEFAULTS });
  assert.equal(store.grants.findByHash('nope'), null);
  assert.deepEqual(store.grants.list().map((g) => g.id), ['aaaa1111', 'bbbb2222']);
  assert.equal(store.grants.revoke('aaaa1111').revoked, true);
  assert.equal(store.grants.revoke('missing'), null);
  assert.throws(() => store.grants.insert(grant({ id: 'cccc3333' })), /UNIQUE/, 'duplicate token hash must be refused');
  done();
});

test('audit: add, list newest first, extra fields kept, prune by age', () => {
  const { store, done } = fresh();
  store.audit.add({ t: '2020-01-01T00:00:00.000Z', ev: 'old', app: 'crm' });
  store.audit.add({ ev: 'enter', grant: 'g1', app: 'crm', ip: '1.2.3.4', why: 'because' });
  const [newest] = store.audit.list(10);
  assert.equal(newest.ev, 'enter');
  assert.equal(newest.why, 'because');
  assert.equal(newest.grant, 'g1');
  assert.equal(store.audit.count(), 2);
  assert.equal(store.audit.prune(30), 1);
  assert.equal(store.audit.count(), 1);
  done();
});

test('processState: per-process rows, no overwriting between apps', () => {
  const { store, done } = fresh();
  store.processState.set('crm', 'app', { pid: 1 });
  store.processState.set('airfinder', 'app', { pid: 2 });
  store.processState.set('crm', 'app', { pid: 3 });
  assert.deepEqual(store.processState.all(), { crm: { app: { pid: 3 } }, airfinder: { app: { pid: 2 } } });
  store.processState.remove('crm', 'app');
  assert.deepEqual(store.processState.all(), { airfinder: { app: { pid: 2 } } });
  done();
});

test('rateLimit: counts hits per key inside the window', () => {
  const { store, done } = fresh();
  assert.equal(store.rateLimit.hit('a', 60000), 1);
  assert.equal(store.rateLimit.hit('a', 60000), 2);
  assert.equal(store.rateLimit.hit('b', 60000), 1);
  done();
});

test('importLegacy: imports old JSON files once, keeps them, and is repeatable', async () => {
  const { dir, store, done } = fresh();
  const demos = [{ id: 'dead0001', tokenHash: 'hash-1', customer: 'Old Co', app: 'imageapp', createdAt: '2026-05-01T00:00:00.000Z', expiresAt: '2026-05-03T00:00:00.000Z', revoked: true }];
  writeFileSync(join(dir, 'demos.json'), JSON.stringify(demos));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ crm: { app: { pid: 7, port: 3101 } } }));
  writeFileSync(join(dir, 'demo-access.log'), '{"t":"2026-05-01T00:00:00.000Z","ev":"enter","grant":"dead0001","app":"imageapp","ip":"::1"}\nnot json\n');
  const before = readFileSync(join(dir, 'demos.json'), 'utf8');

  assert.deepEqual(await importLegacy(store, dir, { dryRun: true }), { grants: 1, processes: 1, audit: 1, skippedAudit: false });
  assert.equal(store.grants.list().length, 0, 'dry run must not write');

  assert.deepEqual(await importLegacy(store, dir), { grants: 1, processes: 1, audit: 1, skippedAudit: false });
  assert.deepEqual(store.grants.findByHash('hash-1'), { ...demos[0], ...DEFAULTS }, 'token hash and revoked flag preserved exactly');
  assert.deepEqual(store.processState.all(), { crm: { app: { pid: 7, port: 3101 } } });
  assert.equal(store.audit.list(5)[0].ev, 'enter');

  assert.deepEqual(await importLegacy(store, dir), { grants: 0, processes: 0, audit: 0, skippedAudit: true });
  assert.equal(store.grants.list().length, 1, 'second run adds nothing');
  assert.equal(readFileSync(join(dir, 'demos.json'), 'utf8'), before, 'original file untouched');
  done();
});

test('grants.redeem: counts uses, enforces maxUses and pins a device-locked link to the first browser', () => {
  const { store, done } = fresh();
  store.grants.insert(grant({ id: 'u1', tokenHash: 'u1h', maxUses: 2 }));
  assert.equal(store.grants.redeem('u1', 'devA').ok, true);
  assert.equal(store.grants.redeem('u1', 'devB').ok, true, 'without deviceLock any browser may use it');
  assert.deepEqual(store.grants.redeem('u1', 'devA'), { ok: false, why: 'max-uses' });
  assert.equal(store.grants.findByHash('u1h').uses, 2);

  store.grants.insert(grant({ id: 'd1', tokenHash: 'd1h', deviceLock: true }));
  assert.equal(store.grants.redeem('d1', 'devA').ok, true, 'first browser pins the link');
  assert.equal(store.grants.redeem('d1', 'devA').ok, true, 'same browser can come back');
  assert.deepEqual(store.grants.redeem('d1', 'devB'), { ok: false, why: 'device-locked' });
  assert.equal(store.grants.findByHash('d1h').uses, 2, 'a refused attempt is not counted');
  assert.deepEqual(store.grants.redeem('nope', 'x'), { ok: false, why: 'unknown' });
  done();
});

test('sessions: create, get, expire, delete, prune', () => {
  const { store, done } = fresh();
  store.sessions.create('s1', new Date(Date.now() + 60000).toISOString());
  store.sessions.create('s2', new Date(Date.now() - 1000).toISOString());
  assert.ok(store.sessions.get('s1'));
  assert.equal(store.sessions.get('s2'), null, 'expired sessions are not returned');
  assert.equal(store.sessions.prune(), 1);
  store.sessions.delete('s1');
  assert.equal(store.sessions.get('s1'), null);
  done();
});

test('an existing database from before these columns is upgraded in place', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'pd-old-'));
  const file = join(dir, 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE grants (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, customer TEXT NOT NULL, app TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);");
  old.exec("INSERT INTO grants VALUES ('old1','oh','Old','crm','2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',0)");
  old.close();
  const store = openSqlite(file);
  assert.deepEqual(store.grants.findByHash('oh'), { id: 'old1', tokenHash: 'oh', customer: 'Old', app: 'crm', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z', revoked: false, ...DEFAULTS });
  store.close(); rmSync(dir, { recursive: true, force: true });
});

test('grantSessions: a session points at its grant, expires, and is pruned; findById works', () => {
  const { store, done } = fresh();
  store.grants.insert(grant());
  assert.equal(store.grants.findById('aaaa1111').customer, 'Acme');
  assert.equal(store.grants.findById('nope'), null);
  store.grantSessions.create('gs1', 'aaaa1111', new Date(Date.now() + 60000).toISOString());
  store.grantSessions.create('gs2', 'aaaa1111', new Date(Date.now() - 1000).toISOString());
  assert.equal(store.grantSessions.get('gs1').grantId, 'aaaa1111');
  assert.equal(store.grantSessions.get('gs2'), null, 'expired');
  assert.equal(store.grantSessions.get('missing'), null);
  assert.equal(store.grantSessions.prune(), 1);
  done();
});

test('adding columns: one another process added first is not an error; a real error still is', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER)');
  addMissingColumns(db, 't', [['a', 'INTEGER NOT NULL DEFAULT 0']]);
  // the race: this process read the column list before the other one added "a", so it thinks "a" is missing and tries to add it
  const stale = { prepare: () => ({ all: () => [{ name: 'id' }] }), exec: (sql) => db.exec(sql) };
  assert.doesNotThrow(() => addMissingColumns(stale, 't', [['a', 'INTEGER NOT NULL DEFAULT 0'], ['b', 'TEXT']]));
  assert.deepEqual(db.prepare('PRAGMA table_info(t)').all().map((c) => c.name), ['id', 'a', 'b'], 'the other column was still added');
  assert.throws(() => addMissingColumns(db, 'nope', [['x', 'TEXT']]), /no such table/);
  db.close();
});

test('retryWhileLocked: retries a locked database, passes other errors straight through, and gives up after the limit', () => {
  const noWait = { sleep: () => {} };
  let n = 0;
  assert.equal(retryWhileLocked(() => { if (++n < 3) throw new Error('database is locked'); return 'ok'; }, noWait), 'ok');
  assert.equal(n, 3);
  n = 0;
  assert.throws(() => retryWhileLocked(() => { n++; throw new Error('no such table: x'); }, noWait), /no such table/);
  assert.equal(n, 1, 'another error is not retried');
  n = 0;
  assert.throws(() => retryWhileLocked(() => { n++; throw new Error('database is locked'); }, { ...noWait, tries: 4 }), /locked/);
  assert.equal(n, 4);
});
