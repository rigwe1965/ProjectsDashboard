import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { cookieOf, safeEq, portInUse } from '../../lib/http-util.mjs';
import { cleanEnv } from '../../lib/clean-env.mjs';

const req = (cookie) => ({ headers: { cookie } });

test('cookieOf reads one cookie and keeps "=" inside the value', () => {
  assert.equal(cookieOf(req('a=1; pd=abc=def; z=9'), 'pd'), 'abc=def');
  assert.equal(cookieOf(req('a=1'), 'pd'), '');
  assert.equal(cookieOf({ headers: {} }, 'pd'), '');
});

test('safeEq compares strings without throwing on different lengths', () => {
  assert.equal(safeEq('abc', 'abc'), true);
  assert.equal(safeEq('abc', 'abd'), false);
  assert.equal(safeEq('abc', 'abcd'), false);
});

test('portInUse detects a listening port and a free one', async () => {
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const { port } = srv.address();
  assert.equal(await portInUse(port), true);
  await new Promise((r) => srv.close(r));
  assert.equal(await portInUse(port), false);
});

test('cleanEnv removes inherited virtualenv settings but keeps other PATH entries', () => {
  const env = cleanEnv({ VIRTUAL_ENV: 'x', PYTHONPATH: 'y', KEEP: '1', Path: 'C:\\bin;C:\\proj\\.venv\\Scripts;C:\\tools' });
  assert.equal(env.VIRTUAL_ENV, undefined);
  assert.equal(env.PYTHONPATH, undefined);
  assert.equal(env.KEEP, '1');
  assert.equal(env.Path, 'C:\\bin;C:\\tools');
});
