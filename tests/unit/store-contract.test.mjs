// The same behaviour checks for every store implementation, so SQLite (local) and Postgres (hosted) cannot drift apart.
// SQLite always runs. Postgres runs when TEST_DATABASE_URL is set, in a throwaway schema that is dropped afterwards:
//   TEST_DATABASE_URL=postgres://postgres:testpw@127.0.0.1:54329/pdtest npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openSqlite } from '../../lib/store/sqlite.mjs';
import { openPostgres } from '../../lib/store/postgres.mjs';

const DEFAULTS = { uses: 0, maxUses: null, deviceLock: false, lastUsedAt: null, displayName: null, welcome: null };
const grant = (o = {}) => ({ id: 'g1', tokenHash: 'h1', customer: 'Acme', app: 'crm', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z', revoked: false, ...o });
const future = () => new Date(Date.now() + 60000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

const factories = [{ name: 'sqlite', open: async () => { const dir = mkdtempSync(join(tmpdir(), 'pd-c-')); const s = openSqlite(join(dir, 'db.sqlite')); return { s, cleanup: async () => { s.close(); rmSync(dir, { recursive: true, force: true }); } }; } }];
if (process.env.TEST_DATABASE_URL) {
  factories.push({ name: 'postgres', open: async () => {
    const schema = 'pd_test_' + randomBytes(5).toString('hex');
    const s = await openPostgres({ url: process.env.TEST_DATABASE_URL, schema });
    return { s, cleanup: async () => {
      await s.close();
      const { default: pg } = await import('pg'); const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
    } };
  } });
} else {
  test('postgres contract tests (skipped: set TEST_DATABASE_URL to run them)', { skip: true }, () => {});
}

for (const f of factories) {
  describe(`${f.name} store`, () => {
    let s, cleanup;
    before(async () => { ({ s, cleanup } = await f.open()); });
    after(async () => { await cleanup(); });

    test('grants: insert, find by hash and id, list order, revoke, unique token hash', async () => {
      await s.grants.insert(grant());
      await s.grants.insert(grant({ id: 'g2', tokenHash: 'h2', createdAt: '2026-01-03T00:00:00.000Z' }));
      assert.deepEqual(await s.grants.findByHash('h1'), { ...grant(), ...DEFAULTS });
      assert.equal((await s.grants.findById('g2')).tokenHash, 'h2');
      assert.equal(await s.grants.findByHash('nope'), null);
      assert.equal(await s.grants.findById('nope'), null);
      assert.deepEqual((await s.grants.list()).map((g) => g.id), ['g1', 'g2']);
      assert.equal((await s.grants.revoke('g1')).revoked, true);
      assert.equal(await s.grants.revoke('missing'), null);
      await assert.rejects(async () => s.grants.insert(grant({ id: 'g3', tokenHash: 'h1' })), 'a duplicate token hash must be refused'); // async wrapper: SQLite throws, Postgres rejects
    });

    test('redeem: use limit, device lock, refused attempts are not counted', async () => {
      await s.grants.insert(grant({ id: 'u1', tokenHash: 'u1h', maxUses: 2 }));
      assert.equal((await s.grants.redeem('u1', 'A')).ok, true);
      assert.equal((await s.grants.redeem('u1', 'B')).ok, true);
      assert.deepEqual(await s.grants.redeem('u1', 'A'), { ok: false, why: 'max-uses' });
      assert.equal((await s.grants.findByHash('u1h')).uses, 2);
      await s.grants.insert(grant({ id: 'd1', tokenHash: 'd1h', deviceLock: true }));
      assert.equal((await s.grants.redeem('d1', 'A')).ok, true);
      assert.equal((await s.grants.redeem('d1', 'A')).ok, true);
      assert.deepEqual(await s.grants.redeem('d1', 'B'), { ok: false, why: 'device-locked' });
      const d = await s.grants.findByHash('d1h'); assert.equal(d.uses, 2); assert.ok(d.lastUsedAt);
      assert.deepEqual(await s.grants.redeem('nope', 'x'), { ok: false, why: 'unknown' });
    });

    test('redeem is atomic: 8 simultaneous opens of a one-use link let exactly one through', async () => {
      await s.grants.insert(grant({ id: 'race', tokenHash: 'raceh', maxUses: 1 }));
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => s.grants.redeem('race', 'dev' + i)));
      assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => r.ok || r.why)));
      assert.equal((await s.grants.findByHash('raceh')).uses, 1);
    });

    test('grantSessions and admin sessions: create, get, expiry, delete, prune, clear', async () => {
      await s.grantSessions.create('gs1', 'g1', future()); await s.grantSessions.create('gs2', 'g1', past());
      assert.equal((await s.grantSessions.get('gs1')).grantId, 'g1');
      assert.equal(await s.grantSessions.get('gs2'), null);
      assert.equal(await s.grantSessions.get('missing'), null);
      assert.equal(await s.grantSessions.prune(), 1);
      await s.sessions.create('s1', future()); await s.sessions.create('s2', past());
      assert.ok(await s.sessions.get('s1')); assert.equal(await s.sessions.get('s2'), null);
      assert.equal(await s.sessions.prune(), 1);
      await s.sessions.delete('s1'); assert.equal(await s.sessions.get('s1'), null);
      await s.sessions.create('s3', future()); await s.sessions.clear(); assert.equal(await s.sessions.get('s3'), null);
    });

    test('audit: add, addMany, newest first, extra fields, count, prune', async () => {
      await s.audit.add({ t: '2020-01-01T00:00:00.000Z', ev: 'old', app: 'crm' });
      await s.audit.addMany([{ ev: 'a1' }, { ev: 'a2', grant: 'g1', app: 'crm', ip: '1.2.3.4', why: 'because' }]);
      const list = await s.audit.list(10);
      assert.deepEqual(list.map((e) => e.ev), ['a2', 'a1', 'old']);
      assert.equal(list[0].why, 'because'); assert.equal(list[0].grant, 'g1'); assert.equal(list[0].ip, '1.2.3.4');
      assert.equal(await s.audit.count(), 3);
      assert.equal(await s.audit.prune(30), 1);
      assert.equal(await s.audit.count(), 2);
    });

    test('audit: admin events get their own retention, and one grant can be forgotten', async () => {
      await s.audit.addMany([
        { t: '2020-01-01T00:00:00.000Z', ev: 'enter', grant: 'g9', ip: '1.1.1.1' },
        { t: '2020-01-01T00:00:00.000Z', ev: 'admin-login', ip: '2.2.2.2' },
        { ev: 'enter', grant: 'g9', ip: '1.1.1.1' }, { ev: 'enter', grant: 'g8', ip: '3.3.3.3' },
      ]);
      const before = await s.audit.count();
      assert.equal(await s.audit.prune(30, 100000), 1, 'old customer event goes, old admin event stays');
      assert.equal(await s.audit.deleteForGrant('g9'), 1);
      assert.equal(await s.audit.count(), before - 2);
      assert.equal(await s.audit.prune(30, 30), 1, 'now the admin event goes too');
    });

    test('processState: per-process rows, upsert, remove', async () => {
      await s.processState.set('crm', 'app', { pid: 1 }); await s.processState.set('af', 'app', { pid: 2 }); await s.processState.set('crm', 'app', { pid: 3 });
      assert.deepEqual(await s.processState.all(), { crm: { app: { pid: 3 } }, af: { app: { pid: 2 } } });
      await s.processState.remove('crm', 'app');
      assert.deepEqual(await s.processState.all(), { af: { app: { pid: 2 } } });
    });

    test('rateLimit counts per key inside the window; meta overwrites', async () => {
      assert.equal(await s.rateLimit.hit('a', 60000), 1); assert.equal(await s.rateLimit.hit('a', 60000), 2); assert.equal(await s.rateLimit.hit('b', 60000), 1);
      // with a limit: once the window holds max hits, more are not recorded (the table stays small) but still read as over the limit
      for (let i = 1; i <= 3; i++) assert.equal(await s.rateLimit.hit('cap', 60000, 3), i);
      for (let i = 0; i < 5; i++) assert.equal(await s.rateLimit.hit('cap', 60000, 3), 4);
      assert.equal(await s.rateLimit.count('cap', 60000), 3);
      assert.equal(await s.meta.get('k'), null);
      await s.meta.set('k', 'one'); await s.meta.set('k', 'two'); await s.meta.set('n', 5);
      assert.equal(await s.meta.get('k'), 'two'); assert.equal(await s.meta.get('n'), '5');
    });

    test('meta.claim takes a key only when it is absent, empty or older than the cutoff, and only one of several claims wins (audit F-14)', async () => {
      const t = (n) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
      assert.equal(await s.meta.claim('c1', t(10), t(0)), true, 'absent: taken');
      assert.equal(await s.meta.get('c1'), t(10));
      assert.equal(await s.meta.claim('c1', t(11), t(0)), false, 'held and not stale: refused');
      assert.equal(await s.meta.get('c1'), t(10), 'and the holder is unchanged');
      assert.equal(await s.meta.claim('c1', t(12), t(10) + 'x'), true, 'older than the cutoff: taken over');
      await s.meta.set('c1', '');
      assert.equal(await s.meta.claim('c1', t(13), t(0)), true, 'empty (released): taken');
      const results = await Promise.all([1, 2, 3, 4, 5].map((i) => s.meta.claim('c2', t(20 + i), t(0))));
      assert.equal(results.filter(Boolean).length, 1, 'of several simultaneous claims exactly one wins');
    });

    test('activity: batches add up per link and day, first/last times widen, only the 10 busiest pages are kept', async () => {
      const t = (m) => `2026-03-05T10:${String(m).padStart(2, '0')}:00.000Z`;
      assert.deepEqual(await s.activity.forGrant('ax'), []);
      await s.activity.add('ax', '2026-03-05', { requests: 3, firstAt: t(5), lastAt: t(9), activeSeconds: 240, paths: { '/crm': 2, '/crm/contacts': 1 } });
      await s.activity.add('ax', '2026-03-05', { requests: 2, firstAt: t(1), lastAt: t(20), activeSeconds: 60, wsSeconds: 30, paths: { '/crm': 1, '/crm/deals': 1 } });
      await s.activity.add('ax', '2026-03-06', { requests: 1, firstAt: '2026-03-06T08:00:00.000Z', lastAt: '2026-03-06T08:00:00.000Z' });
      const rows = await s.activity.forGrant('ax');
      assert.equal(rows.length, 2);
      assert.deepEqual(rows[0], { grantId: 'ax', day: '2026-03-05', requests: 5, firstAt: t(1), lastAt: t(20), activeSeconds: 300, wsSeconds: 30,
        topPaths: [{ path: '/crm', count: 3 }, { path: '/crm/contacts', count: 1 }, { path: '/crm/deals', count: 1 }] });
      assert.deepEqual(rows[1].topPaths, []);
      // twelve different pages: only the ten busiest survive
      const paths = {}; for (let i = 1; i <= 12; i++) paths['/p' + String(i).padStart(2, '0')] = i;
      await s.activity.add('ay', '2026-03-05', { requests: 78, paths });
      const top = (await s.activity.forGrant('ay'))[0].topPaths;
      assert.equal(top.length, 10); assert.equal(top[0].path, '/p12'); assert.equal(top.at(-1).path, '/p03');
    });

    test('activity: bad numbers count as zero, a bad day is refused, simultaneous batches are not lost', async () => {
      await s.activity.add('az', '2026-03-05', { requests: -4, activeSeconds: 'x', wsSeconds: NaN, paths: { '/a': -1 } });
      const r = (await s.activity.forGrant('az'))[0];
      assert.deepEqual([r.requests, r.activeSeconds, r.wsSeconds, r.topPaths.length], [0, 0, 0, 0]);
      await assert.rejects(async () => s.activity.add('az', 'yesterday', { requests: 1 }), /YYYY-MM-DD/);
      await Promise.all([1, 2, 3, 4, 5, 6].map((i) => s.activity.add('race', '2026-03-05', { requests: i, paths: { '/x': 1 } })));
      const q = (await s.activity.forGrant('race'))[0];
      assert.equal(q.requests, 21); assert.equal(q.topPaths[0].count, 6);
    });

    test('activity: summary per link from a day on, prune by age, deleteForGrant', async () => {
      await s.activity.add('s1', '2026-03-01', { requests: 2, activeSeconds: 10, firstAt: '2026-03-01T01:00:00.000Z', lastAt: '2026-03-01T02:00:00.000Z' });
      await s.activity.add('s1', '2026-03-09', { requests: 4, activeSeconds: 20, wsSeconds: 5, firstAt: '2026-03-09T01:00:00.000Z', lastAt: '2026-03-09T03:00:00.000Z' });
      await s.activity.add('s2', '2026-03-09', { requests: 1 });
      const all = Object.fromEntries((await s.activity.summary()).map((x) => [x.grantId, x]));
      assert.deepEqual(all.s1, { grantId: 's1', days: 2, requests: 6, activeSeconds: 30, wsSeconds: 5, firstAt: '2026-03-01T01:00:00.000Z', lastAt: '2026-03-09T03:00:00.000Z' });
      const recent = Object.fromEntries((await s.activity.summary('2026-03-07')).map((x) => [x.grantId, x]));
      assert.equal(recent.s1.requests, 4); assert.equal(recent.s1.days, 1); assert.equal(recent.ax, undefined);
      assert.equal(await s.activity.deleteForGrant('s2'), 1);
      assert.deepEqual(await s.activity.forGrant('s2'), []);
      assert.ok(await s.activity.prune(1) >= 1, 'rows older than a day (all of these test rows) are pruned');
      assert.deepEqual(await s.activity.summary(), []);
    });

    test('grants: the name and welcome note shown to the customer are stored, and forgetting the customer removes them', async () => {
      await s.grants.insert(grant({ id: 'b1', tokenHash: 'b1h', displayName: 'Acme Ltd', welcome: 'Hello Dana,\nhere is your demo.' }));
      const g = await s.grants.findById('b1');
      assert.equal(g.displayName, 'Acme Ltd'); assert.equal(g.welcome, 'Hello Dana,\nhere is your demo.');
      assert.equal((await s.grants.findById('g2')).displayName, null, 'a link made without them has none');
      await s.grants.anonymize('b1');
      const gone = await s.grants.findById('b1');
      assert.deepEqual([gone.customer, gone.displayName, gone.welcome], ['(removed)', null, null]);
    });
  });
}

test('postgres: refuses to open without a URL or with a bad schema name, and hides the password', async () => {
  await assert.rejects(openPostgres({ url: '' }), /needs DATABASE_URL/);
  await assert.rejects(openPostgres({ url: 'postgres://u:p@h/db', schema: 'x"; DROP TABLE grants; --' }), /plain identifier/);
});
