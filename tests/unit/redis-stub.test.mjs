// The in-memory Upstash stand-in used by the production-mode CRM demo: it must behave like Redis for the commands the CRM sends.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStub } from '../../supervisor/redis-rest-stub.mjs';

const stub = createStub('secret');
const port = await new Promise((r) => stub.server.listen(0, '127.0.0.1', () => r(stub.server.address().port)));
after(() => stub.close());
const call = async (cmds, token = 'secret') => {
  const r = await fetch(`http://127.0.0.1:${port}/pipeline`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmds) });
  return { status: r.status, body: r.ok ? await r.json() : null };
};

test('INCR + EXPIRE NX count a window; GET/SET EX hold a flag; unknown commands are errors', async () => {
  const first = await call([['INCR', 'rl:a'], ['EXPIRE', 'rl:a', '60', 'NX']]);
  assert.deepEqual(first.body, [{ result: 1 }, { result: 1 }]);
  const second = await call([['INCR', 'rl:a'], ['EXPIRE', 'rl:a', '60', 'NX']]);
  assert.deepEqual(second.body, [{ result: 2 }, { result: 0 }], 'NX: the window is not extended by later hits');
  assert.deepEqual((await call([['SET', 'k', '1', 'EX', '30'], ['GET', 'k'], ['GET', 'nope'], ['TTL', 'k']])).body.map((x) => x.result).slice(0, 3), ['OK', '1', null]);
  assert.ok((await call([['TTL', 'k']])).body[0].result > 0);
  assert.match((await call([['FLUSHALL']])).body[0].error, /unsupported/);
});

test('keys expire, and a wrong token or a bad request is refused', async () => {
  await call([['INCR', 'short'], ['EXPIRE', 'short', '1']]);
  await new Promise((r) => setTimeout(r, 1100));
  assert.deepEqual((await call([['GET', 'short']])).body, [{ result: null }]);
  assert.equal((await call([['GET', 'x']], 'wrong')).status, 401);
  const bad = await fetch(`http://127.0.0.1:${port}/pipeline`, { method: 'POST', headers: { authorization: 'Bearer secret' }, body: 'not json' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200, 'health check');
});
