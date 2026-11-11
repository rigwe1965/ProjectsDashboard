// The AI guide's limits: allowance per link, per-minute rate, daily spending cap, pricing, and room reserved for messages in progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite } from '../../lib/store/sqlite.mjs';
import { createBudget, priceUsage, PRICES, GUIDE_DEFAULTS, dayOf } from '../../demo-gateway/guide/budget.mjs';

async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pd-gb-'));
  const s = openSqlite(join(dir, 'db.sqlite'));
  try { await fn(s); } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
}
const usage = { input_tokens: 500, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 200 };

test('the default model is Haiku 5.5 and every model that can be chosen has a price', () => {
  assert.equal(GUIDE_DEFAULTS.model, 'claude-haiku-5-5');
  for (const m of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) assert.ok(PRICES[m].in > 0 && PRICES[m].out > PRICES[m].in);
  assert.throws(() => createBudget({ store: {}, model: 'claude-mystery' }), /no price known/);
  assert.throws(() => priceUsage('claude-mystery', usage), /no price known/);
});

test('pricing: cache reads cost a tenth, cache writes a quarter more, and the result is rounded up to whole micro-dollars', () => {
  // Haiku: $0.10 in, $0.50 out per million tokens = 0.1 and 0.5 micro-dollars per token.
  assert.deepEqual(priceUsage('claude-haiku-5-5', usage), { messages: 1, inputTokens: 500, cachedTokens: 4000, outputTokens: 200, costMicro: 190 }); // 50 + 40 + 100
  assert.deepEqual(priceUsage('claude-haiku-5-5', { input_tokens: 100, cache_creation_input_tokens: 4000, output_tokens: 1 }), { messages: 1, inputTokens: 4100, cachedTokens: 0, outputTokens: 1, costMicro: 511 }); // 10 + 500 + 0.5, up
  assert.equal(priceUsage('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 1000 }).costMicro, 12000);
  assert.deepEqual(priceUsage('claude-haiku-5-5', { input_tokens: -5, output_tokens: 'x' }), { messages: 1, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costMicro: 0 }, 'bad numbers count as zero');
  assert.deepEqual(priceUsage('claude-haiku-5-5'), { messages: 1, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costMicro: 0 });
});

test('a link with no allowance has no guide; the allowance counts every message ever answered, across days', async () => {
  await withStore(async (s) => {
    let t = Date.parse('2026-03-05T10:00:00Z');
    const b = createBudget({ store: s, perMinute: 100, dailyCapUsd: 100, now: () => t });
    assert.deepEqual(await b.begin('g', 0), { ok: false, why: 'no-guide' });
    assert.deepEqual(await b.begin('g', undefined), { ok: false, why: 'no-guide' });
    for (let i = 0; i < 2; i++) { const r = await b.begin('g', 3); assert.ok(r.ok); await r.done(usage); }
    t += 864e5; // the next day: the link's allowance is for its whole life
    const third = await b.begin('g', 3); assert.ok(third.ok); await third.done(usage);
    assert.deepEqual(await b.begin('g', 3), { ok: false, why: 'allowance', used: 3, allowed: 3 });
    assert.ok((await b.begin('other', 3)).ok, 'another link has its own allowance');
  });
});

test('messages in progress are reserved: two at once cannot both take the last message, and a failed call gives its message back', async () => {
  await withStore(async (s) => {
    const b = createBudget({ store: s, perMinute: 100, dailyCapUsd: 100 });
    const [a, c] = await Promise.all([b.begin('g', 1), b.begin('g', 1)]);
    assert.equal([a, c].filter((r) => r.ok).length, 1, 'exactly one gets the last message');
    assert.equal(b.pending(), 1);
    const winner = a.ok ? a : c;
    await winner.done(); // the call failed before any answer: nothing spent, nothing counted
    assert.equal(b.pending(), 0);
    assert.equal((await s.guideUsage.totalForGrant('g')).messages, 0);
    const again = await b.begin('g', 1); assert.ok(again.ok);
    await again.done(usage); await again.done(usage); // finishing twice counts once
    assert.equal((await s.guideUsage.totalForGrant('g')).messages, 1);
  });
});

test('at most N messages a minute per link, and a refused message does not use up the minute', async () => {
  await withStore(async (s) => {
    const b = createBudget({ store: s, perMinute: 2, dailyCapUsd: 100 });
    for (let i = 0; i < 2; i++) { const r = await b.begin('g', 50); assert.ok(r.ok); await r.done(usage); }
    assert.deepEqual(await b.begin('g', 50), { ok: false, why: 'rate' });
    assert.ok((await b.begin('h', 50)).ok, 'another link is not slowed down');
    const full = createBudget({ store: s, perMinute: 2, dailyCapUsd: 100 });
    for (let i = 0; i < 5; i++) assert.equal((await full.begin('k', 1)).ok, i === 0 ? true : false);
    assert.equal(full.pending(), 1);
  });
});

test('the daily cap stops every link once the day\'s estimated spend, plus the worst case of messages in progress, would pass it; a new day starts fresh', async () => {
  await withStore(async (s) => {
    let t = Date.parse('2026-03-05T23:00:00Z');
    const b = createBudget({ store: s, perMinute: 100, dailyCapUsd: 0.01, now: () => t }); // 10,000 micro-dollars
    assert.ok(b.worstCaseMicro > 0 && b.worstCaseMicro < 10000);
    await s.guideUsage.add('a', dayOf(t), { messages: 1, costMicro: 10000 - b.worstCaseMicro + 1 });
    assert.deepEqual(await b.begin('b', 20), { ok: false, why: 'daily' }, 'another link is stopped by the gateway-wide cap');
    t += 2 * 3600e3; // past midnight UTC
    const r = await b.begin('b', 20); assert.ok(r.ok, 'the new day has its own cap');
    assert.deepEqual(await createBudget({ store: s, dailyCapUsd: 0, now: () => t }).begin('b', 20), { ok: false, why: 'daily' }, 'a cap of 0 turns the guide off');
    assert.throws(() => createBudget({ store: s, dailyCapUsd: 'lots' }), /daily cap/);
  });
});

test('the cap holds against messages already in progress, using the worst case for each', async () => {
  await withStore(async (s) => {
    const probe = createBudget({ store: s });
    const b = createBudget({ store: s, perMinute: 100, dailyCapUsd: (probe.worstCaseMicro * 2.5) / 1e6 }); // room for two worst cases
    const r1 = await b.begin('a', 5), r2 = await b.begin('b', 5), r3 = await b.begin('c', 5);
    assert.deepEqual([r1.ok, r2.ok, r3.ok], [true, true, false]);
    await r1.done(usage);
    assert.ok((await b.begin('c', 5)).ok, 'once one finishes, its real (small) cost replaces the reservation');
  });
});
