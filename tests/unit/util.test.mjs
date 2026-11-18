import test from 'node:test';
import assert from 'node:assert/strict';
import { num, sleep, errMessage, unmapV4, parseEnvText, missingKeys, createSerialLock, skipIfRunning, fireAndForget, maskSecrets } from '../../lib/util.mjs';

test('num: a number, or the default for unset / empty / not-a-number', () => {
  assert.equal(num('42', 1), 42);
  assert.equal(num('0', 1), 0);
  assert.equal(num(undefined, 7), 7);
  assert.equal(num('', 7), 7);
  assert.equal(num('abc', 7), 7);
});

test('errMessage: Error, string and undefined', () => {
  assert.equal(errMessage(new Error('boom')), 'boom');
  assert.equal(errMessage('plain'), 'plain');
  assert.equal(errMessage(undefined), 'undefined');
});

test('unmapV4 strips only the IPv4-mapped prefix', () => {
  assert.equal(unmapV4('::ffff:10.0.0.5'), '10.0.0.5');
  assert.equal(unmapV4('::1'), '::1');
  assert.equal(unmapV4(undefined), '');
});

test('parseEnvText: comments, blanks, "=" inside a value, CRLF', () => {
  const env = parseEnvText('# note\r\n\r\nA=1\r\n  B = two words  \r\nC=x=y\r\n=nokey\r\nD\r\n');
  assert.deepEqual(env, { A: '1', B: ' two words', C: 'x=y' });
  assert.deepEqual(parseEnvText('B = two words  ', { trimValues: true }), { B: 'two words' });
});

test('missingKeys: absent, empty and REPLACE_ME', () => {
  assert.deepEqual(missingKeys({ A: '1', B: '', C: 'REPLACE_ME' }, ['A', 'B', 'C', 'D']), ['B', 'C', 'D']);
});

test('createSerialLock runs in order and a failure does not block the next', async () => {
  const lock = createSerialLock();
  const order = [];
  const a = lock(async () => { await sleep(20); order.push('a'); });
  const b = lock(async () => { order.push('b'); throw new Error('b failed'); });
  const c = lock(async () => { order.push('c'); return 'c done'; });
  await a;
  await assert.rejects(b, /b failed/);
  assert.equal(await c, 'c done');
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('skipIfRunning skips an overlapping call and reports errors', async () => {
  let runs = 0; const errors = [];
  const tick = skipIfRunning(async () => { runs++; await sleep(30); if (runs === 2) throw new Error('second fails'); }, (e) => errors.push(e.message));
  const first = tick();
  assert.equal(await tick(), false);   // first is still running
  assert.equal(await first, true);
  assert.equal(await tick(), true);    // free again; this run throws, the error goes to onError
  assert.equal(runs, 2);
  assert.deepEqual(errors, ['second fails']);
});

test('fireAndForget never throws into the caller', async () => {
  const seen = [];
  fireAndForget(async () => { throw new Error('audit down'); }, (e) => seen.push(e.message));
  await sleep(5);
  assert.deepEqual(seen, ['audit down']);
});

test('maskSecrets hides passwords in URLs and values after secret-looking names, and leaves ordinary log text alone', () => {
  assert.equal(maskSecrets('DATABASE_URL=postgres://crm:Sup3rSecret@db:5432/crm'), 'DATABASE_URL=postgres://crm:***@db:5432/crm');
  assert.equal(maskSecrets('GET /api?token=abcdef123456 200'), 'GET /api?token=*** 200');
  assert.equal(maskSecrets('{"password": "hunter2hunter2", "user":"bob"}'), '{"password": "***", "user":"bob"}');
  assert.equal(maskSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def'), 'Authorization: Bearer ***');
  assert.equal(maskSecrets('NEXTAUTH_SECRET=abc12345xyz'), 'NEXTAUTH_SECRET=***');
  assert.equal(maskSecrets('api_key: sk-abcdefgh'), 'api_key: ***');
  for (const plain of ['http://localhost:3101/sign-in ready', 'Started app (pid 123) on :5200 UP', 'SUPABASE_SERVICE_ROLE_KEY missing', '']) assert.equal(maskSecrets(plain), plain);
});

test('demoProjectRefProblem: the reset script must be told which project it may empty, and it must be the one the URL points at (audit F-05)', async () => {
  const { demoProjectRefProblem: check } = await import('../../lib/util.mjs');
  const url = 'https://demoref.supabase.co';
  assert.match(check({ NEXT_PUBLIC_SUPABASE_URL: url }), /DEMO_PROJECT_REF is not set/);
  assert.match(check({ NEXT_PUBLIC_SUPABASE_URL: url, DEMO_PROJECT_REF: 'REPLACE_ME' }), /not set/);
  assert.match(check({ NEXT_PUBLIC_SUPABASE_URL: 'https://realref.supabase.co', DEMO_PROJECT_REF: 'demoref' }), /refusing/);
  assert.match(check({ NEXT_PUBLIC_SUPABASE_URL: 'nonsense', DEMO_PROJECT_REF: 'demoref' }), /not a valid URL/);
  assert.equal(check({ NEXT_PUBLIC_SUPABASE_URL: url, DEMO_PROJECT_REF: ' DemoRef ' }), null);
  assert.match(check({ NEXT_PUBLIC_SUPABASE_URL: 'https://demoref.evil.example', DEMO_PROJECT_REF: 'evil' }), /refusing/);
});

test('reset-supabase-demo.mjs stops before touching anything when the project ref is missing or wrong (audit F-05)', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = (extra) => spawnSync(process.execPath, ['supervisor/reset-supabase-demo.mjs', '--env', '--yes'], {
    encoding: 'utf8', timeout: 20000,
    // port 9 on localhost refuses at once, so if the guard failed the script would print table lines instead of stopping
    env: { PATH: process.env.PATH, NEXT_PUBLIC_SUPABASE_URL: 'http://demoref.localhost:9', SUPABASE_SERVICE_ROLE_KEY: 'k', ADMIN_EMAIL: 'a@x.test', ADMIN_PASSWORD: 'p', CUSTOMER_EMAIL: 'c@x.test', CUSTOMER_PASSWORD: 'p', ...extra },
  });
  const none = run({});
  assert.equal(none.status, 1); assert.match(none.stderr, /missing DEMO_PROJECT_REF/); assert.equal(none.stdout, '');
  const wrong = run({ DEMO_PROJECT_REF: 'other' });
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /refusing/); assert.equal(wrong.stdout, '');
  const right = run({ DEMO_PROJECT_REF: 'demoref' }); // passes the guard, then fails only because nothing answers on that port
  assert.doesNotMatch(right.stderr, /refusing|missing DEMO_PROJECT_REF/);
});

test('cachedFor: many callers inside the window share one call and one answer; a new window calls again (audit F-19)', async () => {
  const { cachedFor } = await import('../../lib/util.mjs');
  let t = 1000, calls = 0; const now = () => t;
  const get = cachedFor(5000, async () => { calls++; return calls; }, now);
  assert.deepEqual(await Promise.all([get(), get(), get()]), [1, 1, 1]);
  t += 4999; assert.equal(await get(), 1, 'still inside the window');
  t += 2; assert.equal(await get(), 2, 'the window passed: asked again');
  // a failure is shared too, and does not stick after the window
  let fail = true; const g2 = cachedFor(1000, async () => { if (fail) throw new Error('db down'); return 'ok'; }, now);
  await assert.rejects(g2(), /db down/); await assert.rejects(g2(), /db down/);
  fail = false; t += 1001; assert.equal(await g2(), 'ok');
});

import { mapLimit } from '../../lib/util.mjs';
test('mapLimit: runs at most `limit` at once, keeps the order, and fails like Promise.all', async () => {
  let running = 0, peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => { running++; peak = Math.max(peak, running); await sleep(n); running--; return n * 2; });
  assert.deepEqual(out, [10, 2, 8, 4, 6, 12, 14]);
  assert.ok(peak <= 3 && peak >= 2, `peak was ${peak}`);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
  assert.deepEqual(await mapLimit([1, 2], 0, async (n) => n), [1, 2], 'a limit of 0 still makes progress');
  await assert.rejects(mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; }), /boom/);
});
