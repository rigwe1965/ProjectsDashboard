// Per-link activity collector (analytics plan step 2): memory-only counting, batching, visits, privacy of what is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivity, pageKey } from '../../demo-gateway/activity.mjs';

// A fake store that records what was written, and a clock the test moves by hand.
function setup({ failFirst = 0, gapMs } = {}) {
  const writes = []; let fails = failFirst;
  const store = { activity: { add: async (grantId, day, delta) => { if (fails-- > 0) throw new Error('db down'); writes.push({ grantId, day, ...delta }); } } };
  let t = Date.parse('2026-03-05T10:00:00.000Z');
  const a = createActivity({ store, now: () => t, gapMs });
  return { a, writes, advance: (ms) => { t += ms; }, at: () => t };
}

test('pageKey keeps two path segments, hides ids, drops the query, and ignores asset files', () => {
  assert.equal(pageKey('/crm/contacts/42/edit?x=1'), '/crm/contacts');
  assert.equal(pageKey('/contacts/42'), '/contacts/:id');
  assert.equal(pageKey('/orders/3f2b8c1e-aaaa-bbbb-cccc-0123456789ab'), '/orders/:id');
  assert.equal(pageKey('/'), '/');
  assert.equal(pageKey('/dashboard?token=secret'), '/dashboard');
  for (const asset of ['/static/app.js', '/_next/static/chunks/main.css', '/logo.PNG', '/fonts/a.woff2', '/robots.txt']) assert.equal(pageKey(asset), null, asset);
  assert.ok(pageKey('/' + 'a'.repeat(500)).length <= 42, 'a long segment is cut short');
});

test('record() only counts in memory: the store is not touched until flush, and 1,000 requests are one write', async () => {
  const { a, writes, advance } = setup();
  for (let i = 0; i < 1000; i++) { assert.equal(a.record('g1', '/crm/contacts'), undefined); advance(10); }
  assert.equal(writes.length, 0, 'nothing written yet');
  await a.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].requests, 1000); assert.equal(writes[0].grantId, 'g1'); assert.equal(writes[0].day, '2026-03-05');
  assert.deepEqual(writes[0].paths, { '/crm/contacts': 1000 });
  await a.flush();
  assert.equal(writes.length, 1, 'a second flush with nothing new writes nothing');
});

test('time between requests counts while the gap is at most 5 minutes; a longer gap starts a new visit and is not counted', async () => {
  const { a, writes, advance } = setup();
  a.record('g1', '/a'); advance(60e3);
  a.record('g1', '/a'); advance(120e3); // 60 s + 120 s = 180 s of one visit
  a.record('g1', '/a'); advance(10 * 60e3); // quiet for 10 minutes: not counted
  a.record('g1', '/a'); advance(30e3);
  a.record('g1', '/a'); // + 30 s
  await a.flush();
  assert.equal(writes[0].activeSeconds, 210);
  assert.equal(writes[0].requests, 5);
});

test('asset files are not counted: no request, no time', async () => {
  const { a, writes, advance } = setup();
  a.record('g1', '/dash'); advance(20e3);
  a.record('g1', '/static/app.js'); advance(20e3);
  a.record('g1', '/dash');
  await a.flush();
  assert.equal(writes[0].requests, 2);
  assert.equal(writes[0].activeSeconds, 40, 'the gap between the two pages is still the visit');
});

test('the query string is never kept anywhere in what is written', async () => {
  const { a, writes } = setup();
  a.record('g1', '/search?email=someone@example.com&token=abc');
  await a.flush();
  assert.doesNotMatch(JSON.stringify(writes), /someone|token|email|\?/);
  assert.deepEqual(writes[0].paths, { '/search': 1 });
});

test('an open WebSocket counts as activity (touch) and its open time is added when it closes', async () => {
  const { a, writes, advance } = setup();
  a.touch('g1'); advance(5000); a.touch('g1'); advance(5000); a.touch('g1');
  a.socketClosed('g1', 12000);
  await a.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].activeSeconds, 10); assert.equal(writes[0].wsSeconds, 12); assert.equal(writes[0].requests, 0);
  assert.deepEqual(writes[0].paths, {});
});

test('each link and each UTC day is its own batch; a batch is filed under the day its request happened', async () => {
  const { a, writes, advance, at } = setup();
  a.record('g1', '/a'); a.record('g2', '/b');
  advance(Date.parse('2026-03-06T00:00:05.000Z') - at()); // past midnight UTC
  a.record('g1', '/a');
  await a.flush();
  const key = (w) => w.grantId + '@' + w.day;
  assert.deepEqual(writes.map(key).sort(), ['g1@2026-03-05', 'g1@2026-03-06', 'g2@2026-03-05']);
});

test('a database failure keeps the batch for the next flush instead of losing it', async () => {
  const { a, writes, advance } = setup({ failFirst: 1 });
  a.record('g1', '/a'); advance(1000); a.record('g1', '/b');
  await a.flush(); // the write fails
  assert.equal(writes.length, 0); assert.equal(a.pendingCount(), 1);
  advance(1000); a.record('g1', '/a');
  await a.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].requests, 3); assert.deepEqual(writes[0].paths, { '/a': 2, '/b': 1 });
});

test('stop() writes what is left, and flushes that overlap do not lose or double count', async () => {
  const { a, writes } = setup();
  a.record('g1', '/a');
  await Promise.all([a.flush(), a.flush(), a.stop()]);
  assert.equal(writes.reduce((n, w) => n + w.requests, 0), 1);
});

test('memory is bounded when the database stays down', async () => {
  const { a } = setup({ failFirst: 1e9 });
  for (let i = 0; i < 6000; i++) a.record('g' + i, '/a');
  assert.ok(a.pendingCount() <= 5000);
});
