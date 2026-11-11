// Old audit events and link activity are removed together, and one failing part does not stop the other (analytics plan step 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite } from '../../lib/store/sqlite.mjs';
import { pruneOld } from '../../demo-gateway/retention.mjs';

const daysAgo = (n) => new Date(Date.now() - n * 864e5);

test('activity older than the retention is removed with the audit events; recent rows and the owner\'s events stay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-ret-'));
  const s = openSqlite(join(dir, 'db.sqlite'));
  try {
    await s.audit.add({ t: daysAgo(100).toISOString(), ev: 'enter', grant: 'g1' });
    await s.audit.add({ t: daysAgo(100).toISOString(), ev: 'admin-login' }); // the owner's events have their own, longer limit
    await s.audit.add({ t: daysAgo(1).toISOString(), ev: 'enter', grant: 'g1' });
    await s.activity.add('g1', daysAgo(100).toISOString().slice(0, 10), { requests: 5 });
    await s.activity.add('g1', daysAgo(2).toISOString().slice(0, 10), { requests: 7 });
    await s.guideUsage.add('g1', daysAgo(100).toISOString().slice(0, 10), { messages: 4 });
    await s.guideUsage.add('g1', daysAgo(2).toISOString().slice(0, 10), { messages: 6 });
    const r = await pruneOld(s, 90, 365);
    assert.deepEqual(r, { audit: 1, activity: 1, guide: 1 });
    assert.deepEqual((await s.guideUsage.forGrant('g1')).map((x) => x.messages), [6]);
    assert.deepEqual((await s.activity.forGrant('g1')).map((x) => x.requests), [7]);
    assert.equal(await s.audit.count(), 2);
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a failure in one part is logged and never thrown, and the other part still runs', async () => {
  let activityPruned = 0, auditPruned = 0;
  const boom = { audit: { prune: async () => { throw new Error('audit down'); } }, activity: { prune: async () => { activityPruned++; return 3; } }, guideUsage: { prune: async () => 0 } };
  assert.deepEqual(await pruneOld(boom, 90, 365), { audit: 0, activity: 3, guide: 0 });
  assert.equal(activityPruned, 1);
  const boom2 = { audit: { prune: async () => { auditPruned++; return 2; } }, activity: { prune: async () => { throw new Error('activity down'); } }, guideUsage: { prune: async () => 5 } };
  assert.deepEqual(await pruneOld(boom2, 90, 365), { audit: 2, activity: 0, guide: 5 });
  assert.equal(auditPruned, 1);
});
