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
