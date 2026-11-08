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
  const env = cleanEnv({ VIRTUAL_ENV: 'x', PYTHONPATH: 'y', KEEP: '1', Path: 'C:\\bin;C:\\proj\\.venv\\Scripts;C:\\tools' }, ';'); // a Windows PATH, whatever OS the test runs on
  assert.equal(env.VIRTUAL_ENV, undefined);
  assert.equal(env.PYTHONPATH, undefined);
  assert.equal(env.KEEP, '1');
  assert.equal(env.Path, 'C:\\bin;C:\\tools');
});

test('clientIp ignores X-Forwarded-For unless the peer is a trusted proxy', async () => {
  const { clientIp } = await import('../../lib/http-util.mjs');
  const r = (peer, xff) => ({ socket: { remoteAddress: peer }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientIp(r('::ffff:1.2.3.4', '9.9.9.9')), '1.2.3.4');
  const trusted = new Set(['10.0.0.1', '10.0.0.2']);
  assert.equal(clientIp(r('10.0.0.1', '9.9.9.9'), trusted), '9.9.9.9');
  assert.equal(clientIp(r('10.0.0.1', '6.6.6.6, 9.9.9.9, 10.0.0.2'), trusted), '9.9.9.9', 'walks from the right, skipping trusted proxies');
  assert.equal(clientIp(r('10.0.0.1'), trusted), '10.0.0.1');
});

test('minimalEnv keeps toolchain variables and drops everything else (secrets, database URLs, tokens)', async () => {
  const { minimalEnv } = await import('../../lib/clean-env.mjs');
  const out = minimalEnv({ PATH: 'p', Path: 'p2', SystemRoot: 'C:/Windows', TEMP: 't', LANG: 'en', DATABASE_URL: 'postgres://u:p@h/db', METRICS_TOKEN: 'x', ANTHROPIC_API_KEY: 'k', AWS_SECRET_ACCESS_KEY: 's', MY_NEEDED: '1' }, '');
  assert.deepEqual(Object.keys(out).sort(), ['LANG', 'PATH', 'Path', 'SystemRoot', 'TEMP']);
  assert.equal(minimalEnv({ MY_NEEDED: '1', DATABASE_URL: 'x' }, 'my_needed').MY_NEEDED, '1', 'opt-in passthrough by name');
  assert.equal(minimalEnv({ MY_NEEDED: '1', DATABASE_URL: 'x' }, 'my_needed').DATABASE_URL, undefined);
});
