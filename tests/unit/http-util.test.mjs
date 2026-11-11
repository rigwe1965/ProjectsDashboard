import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { cookieOf, safeEq, portInUse, BASE_SECURITY_HEADERS } from '../../lib/http-util.mjs';
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

test('BASE_SECURITY_HEADERS is the fixed baseline and cannot be changed by a caller', () => {
  assert.deepEqual(BASE_SECURITY_HEADERS, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
  assert.ok(Object.isFrozen(BASE_SECURITY_HEADERS));
});

test('limitKey: an IPv6 client is limited as its whole /64, IPv4 as itself', async () => {
  const { limitKey } = await import('../../lib/http-util.mjs');
  assert.equal(limitKey('203.0.113.7'), '203.0.113.7');
  assert.equal(limitKey('2001:db8:1:2::5'), limitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), 'same /64, same key');
  assert.equal(limitKey('2001:db8:1:2::5'), '2001:db8:1:2::/64');
  assert.notEqual(limitKey('2001:db8:1:2::5'), limitKey('2001:db8:1:3::5'), 'a different /64 is a different client');
  assert.equal(limitKey('::1'), '0:0:0:0::/64');
  assert.equal(limitKey('2001:DB8:0001:0002:0:0:0:9'), '2001:db8:1:2::/64', 'case and leading zeros do not matter');
  assert.equal(limitKey('not an address'), 'not an address');
  assert.equal(limitKey(undefined), 'undefined');
});

test('childEnv: a process\'s passEnv copies its own settings from the supervisor; nothing else leaks (audit F-06)', async () => {
  const { childEnv } = await import('../../supervisor/env.mjs');
  const source = { PATH: 'p', GATEWAY_PORT: '1', gateway_requests_per_minute: '5', DEMO_BASE_HOST: 'demo.example', TRUSTED_PROXIES: '10.0.0.1', DASHBOARD_DATA: 'D:\data', DATABASE_URL: 'postgres://u:p@h/db', ANTHROPIC_API_KEY: 'k', ADMIN_DATA_KEY: 'secret' };
  const app = { id: 'x' }, fillStr = (v) => v;
  const plain = childEnv(app, {}, fillStr, source);
  assert.equal(plain.DEMO_BASE_HOST, undefined, 'without passEnv nothing of the dashboard\'s settings reaches the process');
  assert.equal(plain.DATABASE_URL, undefined);
  const gw = childEnv(app, { passEnv: ['GATEWAY_*', 'DEMO_*', 'TRUSTED_PROXIES', 'DASHBOARD_DATA', 'DATABASE_*'], env: { GATEWAY_PORT: '4300' } }, fillStr, source);
  assert.equal(gw.DEMO_BASE_HOST, 'demo.example');
  assert.equal(gw.TRUSTED_PROXIES, '10.0.0.1');
  assert.equal(gw.DASHBOARD_DATA, 'D:\data');
  assert.equal(gw.DATABASE_URL, 'postgres://u:p@h/db');
  assert.equal(gw.gateway_requests_per_minute, '5', 'prefix match ignores case');
  assert.equal(gw.GATEWAY_PORT, '4300', 'the registry\'s own env value wins over the passed-through one');
  assert.equal(gw.ANTHROPIC_API_KEY, undefined, 'only what is listed');
  assert.equal(gw.ADMIN_DATA_KEY, undefined);
});

test('the registry\'s gateway entry passes its settings through, and no demo app lists passEnv (audit F-06)', async () => {
  const { readFileSync } = await import('node:fs');
  const reg = JSON.parse(readFileSync(new URL('../../registry/apps.json', import.meta.url), 'utf8'));
  const withPass = reg.apps.flatMap((a) => a.processes.filter((p) => p.passEnv).map(() => a.id));
  assert.deepEqual(withPass, ['gateway']);
  const gw = reg.apps.find((a) => a.id === 'gateway').processes[0];
  for (const need of ['GATEWAY_*', 'DEMO_*', 'TRUSTED_PROXIES', 'METRICS_TOKEN', 'AUDIT_*', 'DASHBOARD_DATA', 'DASHBOARD_DB', 'DATABASE_*']) assert.ok(gw.passEnv.includes(need), need);
  assert.ok(!gw.passEnv.some((p) => /KEY|SECRET|PASSWORD|ALERT|ADMIN/.test(p)), 'no secret of the console is handed to the gateway');
});
