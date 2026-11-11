// Admin console tests: both login modes, rate limiting, 2-step codes, CSRF/Host checks, and the auth CLI.
// Everything is temporary: own database and registry. DASHBOARD_DATA must be set BEFORE the modules are imported.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpRequest, testProc, testEnv } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-con-'));
const proc = testProc;
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [proc('app', 19001)] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, processes: [proc('app', 19002)], reset: { steps: [{ cmd: 'x' }] },
    demoAccounts: [{ label: 'Limited', user: 'limited@x.test' }, { label: 'Admin', user: 'admin@x.test', admin: true }] },
] }));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');

const { createConsole } = await import('../../admin-console/console.mjs');
const { getStore, closeStore } = await import('../../lib/store/index.mjs');
const { hashPassword, newTotpSecret, totpCode, seal, isSealed, newDataKey } = await import('../../lib/auth.mjs');
const { scryptSync, randomBytes } = await import('node:crypto');
const store = await getStore();
const fakeSupervisor = async () => ({ ok: true, output: '[]' });

const started = [];
async function start(opts = {}) {
  const c = await createConsole({ port: 0, supervisor: fakeSupervisor, ...opts });
  const port = await c.listen(); started.push(c);
  return { c, port };
}
after(async () => { for (const c of started) await c.close(); await closeStore(); rmSync(dir, { recursive: true, force: true }); });

const req = (port, o = {}) => httpRequest({ port, ...o });
const post = (port, path, obj, headers = {}) => req(port, { method: 'POST', path, body: JSON.stringify(obj), headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, ...headers } });
const cookieFrom = (r) => (r.headers['set-cookie']?.[0] || '').split(';')[0];

// ---------- token mode (nothing configured)
test('token mode: launch URL logs in, everything else is refused, headers are set', async () => {
  const { c, port } = await start();
  assert.equal((await req(port, {})).status, 401);
  assert.equal((await req(port, { path: '/?t=wrong' })).status, 403);
  const ok = await req(port, { path: '/?t=' + c.launchToken });
  assert.equal(ok.status, 302);
  const cookie = cookieFrom(ok);
  const home = await req(port, { headers: { cookie } });
  assert.equal(home.status, 200);
  assert.equal(home.headers['x-frame-options'], 'DENY');
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal(home.headers['referrer-policy'], 'no-referrer');
  assert.equal(home.headers['cache-control'], 'no-store');
  assert.match(home.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await req(port, { path: '/api/apps', headers: { cookie } })).status, 200);
});

test('Host allow-list (DNS rebinding) and same-origin check (CSRF) apply', async () => {
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  assert.equal((await req(port, { host: 'evil.example', headers: { cookie } })).status, 403);
  const noOrigin = await req(port, { method: 'POST', path: '/api/demos', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noOrigin.status, 403);
  const wrongOrigin = await req(port, { method: 'POST', path: '/api/demos', headers: { cookie, origin: 'http://evil.example' }, body: '{}' });
  assert.equal(wrongOrigin.status, 403);
});

test('refuses to listen beyond localhost without a password', async () => {
  await assert.rejects(createConsole({ port: 0, bindHost: '0.0.0.0', supervisor: fakeSupervisor }), /without a password/);
});

test('ADMIN_REQUIRE_TOTP: beyond localhost the console needs 2-step codes as well as a password', async () => {
  const keep = { pw: await store.meta.get('admin_password_hash'), totp: await store.meta.get('admin_totp_secret') };
  process.env.ADMIN_REQUIRE_TOTP = '1';
  try {
    await store.meta.set('admin_password_hash', await hashPassword('a-long-test-password'));
    await store.meta.set('admin_totp_secret', '');
    const opts = { port: 0, bindHost: '0.0.0.0', scheme: 'https', supervisor: fakeSupervisor };
    await assert.rejects(createConsole(opts), /without 2-step codes/);
    await store.meta.set('admin_totp_secret', newTotpSecret());
    const c = await createConsole(opts); // allowed now (not listening: only the start-up checks run)
    await c.close();
    // loopback is never held to it
    await store.meta.set('admin_totp_secret', '');
    await (await createConsole({ port: 0, supervisor: fakeSupervisor })).close();
  } finally {
    delete process.env.ADMIN_REQUIRE_TOTP;
    await store.meta.set('admin_password_hash', keep.pw ?? ''); await store.meta.set('admin_totp_secret', keep.totp ?? '');
  }
});

test('demo links: created with limits through the API, listed with use counts', async () => {
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Acme', app: 'toy', hours: 2, maxUses: 3, deviceLock: true }, { cookie })).body);
  assert.equal(made.grant.maxUses, 3);
  assert.equal(made.grant.deviceLock, true);
  assert.match(made.link, /\/d\/[a-f0-9]{48}$/);
  const bad = await post(port, '/api/demos', { customer: 'Acme', app: 'toy', maxUses: 0 }, { cookie });
  assert.equal(bad.status, 400);
  for (const name of ['constructor', '__proto__', 'toString']) assert.equal((await post(port, '/api/demos', { customer: 'Acme', app: name, hours: 1 }, { cookie })).status, 400, name + ' is not a product (audit F-13)');
  const list = JSON.parse((await req(port, { path: '/api/demos', headers: { cookie } })).body);
  assert.equal(list.grants.find((g) => g.id === made.grant.id).uses, 0);
});

test('a console uses the store it is given: links it creates are not in the process-wide store', async () => {
  const { openSqlite } = await import('../../lib/store/sqlite.mjs');
  const own = openSqlite(join(dir, 'own-console.db'));
  const before = (await store.grants.list()).length;
  const { c, port } = await start({ store: own });
  try {
    const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
    const made = await post(port, '/api/demos', { customer: 'Own store', app: 'toy', hours: 1 }, { cookie });
    assert.equal(made.status, 200);
    assert.equal((await own.grants.list()).length, 1);
    assert.equal((await store.grants.list()).length, before);
  } finally { own.close(); }
});

test('creating and revoking a customer link is audited with where it came from, and shows under the admin filter', async () => {
  const { c, port } = await start({ trustedProxies: ['127.0.0.1'] });
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const from = { 'x-forwarded-for': '198.51.100.23' };
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Audited', app: 'toy', hours: 1 }, { cookie, ...from })).body);
  assert.equal((await post(port, '/api/demos/' + made.grant.id + '/revoke', {}, { cookie, ...from })).status, 200);
  await new Promise((r) => setTimeout(r, 50)); // the console writes its audit rows without waiting
  const mine = (await store.audit.list(200)).filter((e) => e.grant === made.grant.id);
  const created = mine.find((e) => e.ev === 'grant-created'), revoked = mine.find((e) => e.ev === 'grant-revoked');
  assert.deepEqual([created?.ip, created?.by], ['198.51.100.23', 'console']);
  assert.deepEqual([revoked?.ip, revoked?.by], ['198.51.100.23', 'console']);
  const admin = JSON.parse((await req(port, { path: '/api/audit?kind=admin', headers: { cookie, ...from } })).body).events;
  assert.ok(admin.some((e) => e.ev === 'grant-created' && e.grant === made.grant.id), 'under the admin filter');
  const demos = JSON.parse((await req(port, { path: '/api/audit?kind=demos', headers: { cookie, ...from } })).body).events;
  assert.ok(!demos.some((e) => e.ev === 'grant-created' && e.grant === made.grant.id), 'not under the customer filter');
});

test('the log view hides secret-looking values in what an app printed', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(dir, 'logs'), { recursive: true });
  writeFileSync(join(dir, 'logs', 'toy-app.log'), 'listening\nDATABASE_URL=postgres://u:LeakyPass99@db/x\nsession token=abcdef123456 ok\n');
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const { log } = JSON.parse((await req(port, { path: '/api/apps/toy/logs?proc=app', headers: { cookie } })).body);
  assert.match(log, /listening/);
  assert.ok(!log.includes('LeakyPass99') && !log.includes('abcdef123456'), 'secrets are masked: ' + log);
  assert.match(log, /postgres:\/\/u:\*\*\*@db\/x/);
});

test('/_pd/healthz needs no login but still obeys the Host allow-list', async () => {
  const { port } = await start();
  const ok = await req(port, { path: '/_pd/healthz' });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true });
  assert.equal((await req(port, { path: '/_pd/healthz', host: 'evil.example' })).status, 403);
});

// ---------- password mode
test('password mode: login page, sessions, wrong password, logout; launch token switched off', async () => {
  await store.meta.set('admin_password_hash', await hashPassword('a long test passphrase'));
  const { c, port } = await start();
  const anon = await req(port, {});
  assert.equal(anon.status, 302); assert.equal(anon.headers.location, '/login');
  assert.equal((await req(port, { path: '/api/apps' })).status, 401);
  assert.equal((await req(port, { path: '/?t=' + c.launchToken })).status, 302, 'token URL no longer logs in: it just redirects to /login');
  assert.equal((await req(port, { path: '/?t=' + c.launchToken })).headers.location, '/login');
  const page = await req(port, { path: '/login' });
  assert.equal(page.status, 200); assert.ok(page.body.includes('<h1>Sign in</h1>'));

  assert.equal((await post(port, '/login', { password: 'nope nope nope' })).status, 401);
  assert.equal((await req(port, { method: 'POST', path: '/login', body: '{}', headers: { 'content-type': 'application/json' } })).status, 403, 'login needs a same-origin header');
  const good = await post(port, '/login', { password: 'a long test passphrase' });
  assert.equal(good.status, 200);
  assert.match(good.headers['set-cookie'][0], /^pd_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\//);
  const cookie = cookieFrom(good);
  assert.equal((await req(port, { headers: { cookie } })).status, 200);
  assert.equal((await req(port, { path: '/api/apps', headers: { cookie } })).status, 200);
  assert.equal((await req(port, { path: '/login', headers: { cookie } })).status, 302, 'already signed in -> sent to the dashboard');

  assert.equal((await post(port, '/logout', {}, { cookie })).status, 200);
  assert.equal((await req(port, { path: '/api/apps', headers: { cookie } })).status, 401, 'session is gone after logout');
  const evs = (await store.audit.list(20)).map((e) => e.ev);
  assert.ok(evs.includes('admin-login') && evs.includes('admin-login-failed'));
});

test('password mode: sessions are stored hashed, and a forged cookie is refused', async () => {
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 100 });
  const good = await post(port, '/login', { password: 'a long test passphrase' });
  const id = cookieFrom(good).split('=')[1];
  const rows = store.sessions; // only the hash is queryable
  assert.equal(rows.get(id), null, 'the raw session id is not what is stored');
  assert.equal((await req(port, { path: '/api/apps', headers: { cookie: 'pd_session=' + 'a'.repeat(64) } })).status, 401);
  assert.equal((await req(port, { path: '/api/apps', headers: { cookie: 'pd_session=short' } })).status, 401);
});

test('password mode: too many wrong attempts are refused with 429 (even with the right password)', async () => {
  const { port } = await start({ loginMaxPerIp: 3, loginMaxTotal: 1000 });
  let last;
  for (let i = 0; i < 6; i++) last = await post(port, '/login', { password: 'wrong wrong wrong' });
  assert.equal(last.status, 429);
  assert.equal((await post(port, '/login', { password: 'a long test passphrase' })).status, 429, 'locked out even for the right password');
});

test('sign-in limit counts an IPv6 client by its /64, so new addresses do not give new tries', async () => {
  const { port } = await start({ loginMaxPerIp: 3, loginMaxTotal: 1000, trustedProxies: ['127.0.0.1'] });
  let last;
  for (let i = 0; i < 6; i++) last = await post(port, '/login', { password: 'wrong wrong wrong' }, { 'x-forwarded-for': '2001:db8:aa:bb:' + (i + 1) + '::' + (i + 7) });
  assert.equal(last.status, 429, 'six addresses in one /64 used up one budget');
  const other = await post(port, '/login', { password: 'wrong wrong wrong' }, { 'x-forwarded-for': '2001:db8:aa:cc::1' });
  assert.equal(other.status, 401, 'a different /64 has its own');
});

test('password mode: a flood of failed logins from other addresses does not lock the owner out', async () => {
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 3, loginPenaltyMs: 0 });
  for (let i = 0; i < 6; i++) await post(port, '/login', { password: 'wrong wrong wrong' });
  assert.equal((await post(port, '/login', { password: 'wrong wrong wrong' })).status, 429, 'more bad guesses are refused');
  assert.equal((await post(port, '/login', { password: 'a long test passphrase' })).status, 200, 'the right password still works');
});

test('past the overall failure cap, wrong guesses are answered slowly but the right password is not delayed', async () => {
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 2, loginPenaltyMs: 300 });
  for (let i = 0; i < 3; i++) await post(port, '/login', { password: 'wrong wrong wrong' });
  let t = Date.now();
  assert.equal((await post(port, '/login', { password: 'wrong wrong wrong' })).status, 429);
  assert.ok(Date.now() - t >= 280, 'a wrong guess waited');
  t = Date.now();
  assert.equal((await post(port, '/login', { password: 'a long test passphrase' })).status, 200);
  assert.ok(Date.now() - t < 280 + 1000, 'the right password was not made to wait the penalty on top');
});

test('a console beyond this machine needs HTTPS unless plain HTTP is explicitly allowed', async () => {
  await store.meta.set('admin_password_hash', await hashPassword('a long test passphrase'));
  await assert.rejects(createConsole({ port: 0, bindHost: '0.0.0.0', supervisor: fakeSupervisor }), /plain HTTP/);
  await assert.rejects(createConsole({ port: 0, bindHost: '0.0.0.0', scheme: 'http', supervisor: fakeSupervisor }), /plain HTTP/);
  for (const extra of [{ scheme: 'https' }, { allowHttp: true }]) {
    const c = await createConsole({ port: 0, bindHost: '0.0.0.0', allowedHosts: ['127.0.0.1'], supervisor: fakeSupervisor, ...extra });
    started.push(c);
  }
  started.push(await createConsole({ port: 0, supervisor: fakeSupervisor })); // loopback over HTTP is fine
});

test('over HTTPS the console session cookie carries the __Host- prefix and Secure', async () => {
  await store.meta.set('admin_password_hash', await hashPassword('a long test passphrase'));
  await store.meta.set('admin_totp_secret', '');
  const { port } = await start({ scheme: 'https', allowedHosts: ['127.0.0.1'], loginMaxPerIp: 100, loginMaxTotal: 100 });
  const ok = await post(port, '/login', { password: 'a long test passphrase' }, { origin: `https://127.0.0.1:${port}` });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['set-cookie'][0], /^__Host-pd_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure/);
  const cookie = ok.headers['set-cookie'][0].split(';')[0];
  assert.equal((await req(port, { path: '/api/apps', headers: { cookie } })).status, 200, 'the prefixed cookie is accepted');
  assert.equal((await req(port, { path: '/api/apps', headers: { cookie: cookie.replace('__Host-', '') } })).status, 401, 'the unprefixed name is not');
});

test('demo reset: lists accounts, asks before wiping a demo that is in use, resets on request and audits it', async () => {
  const prevHash = await store.meta.get('admin_password_hash');
  await store.meta.set('admin_password_hash', ''); // token mode, whatever earlier tests left behind
  const calls = [];
  const { c, port } = await start({ supervisor: async (args) => { calls.push(args.join(' ')); return { ok: true, output: args[0] === 'status' ? '[]' : 'reset done' }; } });
  assert.equal((await req(port, { path: '/api/demos' })).status, 401);
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const post2 = (path, body) => post(port, path, body, { cookie });
  const list = JSON.parse((await req(port, { path: '/api/demos', headers: { cookie } })).body);
  const toy = list.products.find((p) => p.product === 'toy');
  assert.equal(toy.canReset, true); assert.equal(toy.inUse, 0);
  assert.deepEqual(toy.accounts.map((a) => [a.user, a.admin]), [['limited@x.test', false], ['admin@x.test', true]]);
  assert.equal((await post2('/api/demos/nope/reset', {})).status, 404);
  const noOrigin = await req(port, { method: 'POST', path: '/api/demos/toy/reset', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noOrigin.status, 403);

  const { grant } = await (await import('../../demo-gateway/grants.mjs')).createGrant({ customer: 'In use', app: 'toy', hours: 1 });
  assert.equal((await store.grants.redeem(grant.id, 'dev')).ok, true);
  const ask = await post2('/api/demos/toy/reset', {});
  assert.equal(ask.status, 409); assert.equal(JSON.parse(ask.body).inUse, 1);
  assert.ok(!calls.includes('reset toy-demo'), 'nothing was reset without the extra confirmation');
  const forced = await post2('/api/demos/toy/reset', { force: true });
  assert.equal(forced.status, 200, forced.body);
  assert.ok(calls.includes('reset toy-demo'));
  const ev = (await store.audit.list(100)).filter((e) => e.ev === 'demo-reset' || e.ev === 'demo-reset-requested');
  assert.ok(ev.some((e) => e.ev === 'demo-reset' && e.by === 'admin' && e.ok === true));
  assert.ok(ev.some((e) => e.ev === 'demo-reset-requested' && e.forced === true));
  assert.ok((JSON.parse((await req(port, { path: '/api/demos', headers: { cookie } })).body)).products.find((p) => p.product === 'toy').lastReset, 'the last reset time is shown');
  await store.meta.set('admin_password_hash', prevHash ?? '');
});

test('2-step codes: two simultaneous logins with the same code cannot both succeed', async () => {
  const secret = newTotpSecret();
  await store.meta.set('admin_totp_secret', secret);
  await store.meta.set('admin_totp_last_step', '-1');
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 100 });
  const code = totpCode(secret, Math.floor(Date.now() / 30000));
  const rs = await Promise.all([1, 2, 3].map(() => post(port, '/login', { password: 'a long test passphrase', code })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
});

test('2-step secret at rest: an encrypted secret signs in with the key, and is refused (not bypassed) without it', async () => {
  const keyHex = newDataKey(), secret = newTotpSecret();
  await store.meta.set('admin_totp_secret', seal(secret, Buffer.from(keyHex, 'hex')));
  await store.meta.set('admin_totp_last_step', '-1');
  assert.ok(isSealed(await store.meta.get('admin_totp_secret')));
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 100 });
  const step = Math.floor(Date.now() / 30000);
  const prev = process.env.ADMIN_DATA_KEY;
  try {
    delete process.env.ADMIN_DATA_KEY;
    assert.equal((await post(port, '/login', { password: 'a long test passphrase', code: totpCode(secret, step) })).status, 401, 'no key: sign-in fails closed');
    process.env.ADMIN_DATA_KEY = keyHex;
    assert.equal((await post(port, '/login', { password: 'a long test passphrase', code: totpCode(secret, step) })).status, 200, 'with the key it works');
  } finally { if (prev === undefined) delete process.env.ADMIN_DATA_KEY; else process.env.ADMIN_DATA_KEY = prev; }
});

test('sign-in upgrades an older, cheaper password hash', async () => {
  const salt = randomBytes(16), pw = 'a long test passphrase';
  const old = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
  await store.meta.set('admin_password_hash', old);
  await store.meta.set('admin_totp_secret', '');
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 100 });
  assert.equal((await post(port, '/login', { password: pw })).status, 200);
  assert.match(await store.meta.get('admin_password_hash'), /^scrypt\$131072\$/, 'now stored at the current cost');
  assert.equal((await post(port, '/login', { password: pw })).status, 200, 'and still signs in');
});

test('2-step codes: required, wrong code refused, a code cannot be used twice', async () => {
  const secret = newTotpSecret();
  await store.meta.set('admin_totp_secret', secret);
  await store.meta.set('admin_totp_last_step', '-1');
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 100 });
  const step = Math.floor(Date.now() / 30000);
  assert.equal((await post(port, '/login', { password: 'a long test passphrase' })).status, 401, 'password alone is not enough');
  assert.equal((await post(port, '/login', { password: 'a long test passphrase', code: '000000' })).status, 401);
  assert.equal((await post(port, '/login', { password: 'wrong wrong wrong', code: totpCode(secret, step) })).status, 401, 'right code, wrong password');
  const ok = await post(port, '/login', { password: 'a long test passphrase', code: totpCode(secret, step) });
  assert.equal(ok.status, 200);
  assert.equal((await post(port, '/login', { password: 'a long test passphrase', code: totpCode(secret, step) })).status, 401, 'same code again is a replay');
  const err = JSON.parse((await post(port, '/login', { password: 'x', code: '1' })).body).error;
  assert.equal(err, 'Wrong password or code.', 'does not reveal which part was wrong');
  await store.meta.set('admin_totp_secret', '');
  assert.equal(JSON.parse((await post(port, '/login', { password: 'x' })).body).error, 'Wrong password or code.', 'same words when 2-step is off');
});

// ---------- the CLI
const cli = fileURLToPath(new URL('../../admin-console/auth-cli.mjs', import.meta.url));
function runCli(args, { input, env = {}, interactive } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { env: testEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; interactive?.(out, p); });
    p.stderr.on('data', (d) => { err += d; });
    if (input) p.stdin.end(input);
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

test('CLI: set-password validates, confirms, stores a hash; enable-totp needs a real code; status reflects it', async () => {
  const d2 = mkdtempSync(join(tmpdir(), 'pd-cli-')); const env = { DASHBOARD_DATA: d2, DASHBOARD_REGISTRY: join(dir, 'registry.json') };
  try {
    assert.match((await runCli(['status'], { env })).out, /Password:\s+not set/);
    assert.equal((await runCli(['set-password'], { env, input: 'short\nshort\n' })).code, 1);
    const mismatch = await runCli(['set-password'], { env, input: 'a long enough passphrase\nsomething else entirely\n' });
    assert.equal(mismatch.code, 1); assert.match(mismatch.err, /did not match/);
    const ok = await runCli(['set-password'], { env, input: 'a long enough passphrase\na long enough passphrase\n' });
    assert.equal(ok.code, 0, ok.err);
    assert.doesNotMatch(ok.out + ok.err, /a long enough passphrase/, 'the password is never echoed');
    assert.match((await runCli(['status'], { env })).out, /Password:\s+set/);

    // wrong code -> not enabled
    const bad = await runCli(['enable-totp'], { env, input: '000000\n' });
    assert.equal(bad.code, 1); assert.match(bad.err, /NOT turned on/);
    assert.match((await runCli(['status'], { env })).out, /2-step codes:\s+off/);
    // right code, computed from the secret the CLI prints
    let sent = false;
    const good = await runCli(['enable-totp'], { env, interactive: (out, p) => {
      const m = out.match(/Secret:\s+([A-Z2-7 ]+)\n/);
      if (m && !sent && out.includes('to confirm')) { sent = true; p.stdin.end(totpCode(m[1].replace(/ /g, ''), Math.floor(Date.now() / 30000)) + '\n'); }
    } });
    assert.equal(good.code, 0, good.err + good.out);
    assert.match((await runCli(['status'], { env })).out, /2-step codes:\s+on/);
    assert.equal((await runCli(['disable-totp'], { env })).code, 0);
    assert.match((await runCli(['status'], { env })).out, /2-step codes:\s+off/);
    assert.equal((await runCli(['remove-password'], { env })).code, 0);
    assert.match((await runCli(['status'], { env })).out, /Password:\s+not set/);
    assert.equal((await runCli(['bogus'], { env })).code, 1);
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

test('CLI: with ADMIN_DATA_KEY set the 2-step secret is stored encrypted; gen-key makes a usable key', async () => {
  const d2 = mkdtempSync(join(tmpdir(), 'pd-cli-')); const base = { DASHBOARD_DATA: d2, DASHBOARD_REGISTRY: join(dir, 'registry.json') };
  const key = (await runCli(['gen-key'], { env: base })).out.trim();
  assert.match(key, /^[a-f0-9]{64}$/);
  const env = { ...base, ADMIN_DATA_KEY: key }, f = join(d2, 't.txt');
  try {
    await runCli(['set-password'], { env, input: 'a long enough passphrase\na long enough passphrase\n' });
    await runCli(['enable-totp', '--start', '--to-file', f], { env });
    const secret = readFileSync(f, 'utf8').match(/Secret:\s+([A-Z2-7 ]+)\n/)[1].replace(/ /g, '');
    const ok = await runCli(['enable-totp', '--code', totpCode(secret, Math.floor(Date.now() / 30000))], { env });
    assert.equal(ok.code, 0, ok.err + ok.out);
    assert.match((await runCli(['status'], { env })).out, /2-step secret:\s+encrypted/);
    assert.match((await runCli(['status'], { env: base })).out, /encrypted \(ADMIN_DATA_KEY is not set/, 'without the key it says it cannot be read');
    assert.doesNotMatch(readFileSync(join(d2, 'dashboard.db')).toString('latin1'), new RegExp(secret), 'the secret is not in the database file');
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

test('CLI: set-password --from-file stores the password and deletes the file, even when the password is rejected', async () => {
  const d2 = mkdtempSync(join(tmpdir(), 'pd-cli-')); const env = { DASHBOARD_DATA: d2, DASHBOARD_REGISTRY: join(dir, 'registry.json') };
  const pwFile = join(d2, 'pw.txt');
  try {
    writeFileSync(pwFile, 'short\n');
    const bad = await runCli(['set-password', '--from-file', pwFile], { env });
    assert.equal(bad.code, 1);
    assert.equal(existsSync(pwFile), false, 'the file is deleted even when the password is too short');
    assert.match((await runCli(['status'], { env })).out, /Password:\s+not set/);

    writeFileSync(pwFile, 'a long enough passphrase\r\nsecond line ignored\r\n');
    const ok = await runCli(['set-password', '--from-file', pwFile], { env });
    assert.equal(ok.code, 0, ok.err);
    assert.equal(existsSync(pwFile), false, 'the file is deleted after reading');
    assert.doesNotMatch(ok.out + ok.err, /a long enough passphrase/, 'the password is never echoed');
    assert.match((await runCli(['status'], { env })).out, /Password:\s+set/);

    assert.equal((await runCli(['set-password', '--from-file', join(d2, 'missing.txt')], { env })).code, 1);
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

test('CLI: enable-totp --start / --code works without a prompt and never prints the secret', async () => {
  const d2 = mkdtempSync(join(tmpdir(), 'pd-cli-')); const env = { DASHBOARD_DATA: d2, DASHBOARD_REGISTRY: join(dir, 'registry.json') };
  const secretFile = join(d2, 'totp.txt');
  try {
    assert.equal((await runCli(['enable-totp', '--start', '--to-file', secretFile], { env })).code, 1, 'needs a password first');
    assert.equal((await runCli(['set-password'], { env, input: 'a long enough passphrase\na long enough passphrase\n' })).code, 0);
    assert.equal((await runCli(['enable-totp', '--code', '123456'], { env })).code, 1, 'no pending secret yet');

    const start = await runCli(['enable-totp', '--start', '--to-file', secretFile], { env });
    assert.equal(start.code, 0, start.err);
    const text = readFileSync(secretFile, 'utf8');
    const secret = text.match(/Secret:\s+([A-Z2-7 ]+)\n/)[1].replace(/ /g, '');
    assert.doesNotMatch(start.out + start.err, new RegExp(secret.slice(0, 8)), 'the secret goes to the file, not the terminal');
    assert.match((await runCli(['status'], { env })).out, /2-step codes:\s+off/, 'not on until a code is confirmed');

    const bad = await runCli(['enable-totp', '--code', '000000'], { env });
    assert.equal(bad.code, 1); assert.match(bad.err, /NOT turned on/);
    assert.match((await runCli(['status'], { env })).out, /2-step codes:\s+off/);

    const good = await runCli(['enable-totp', '--code', totpCode(secret, Math.floor(Date.now() / 30000))], { env });
    assert.equal(good.code, 0, good.err + good.out);
    assert.match((await runCli(['status'], { env })).out, /2-step codes:\s+on/);
    assert.equal(existsSync(secretFile), false, 'the setup file holding the secret is deleted once setup is confirmed');
    assert.equal((await runCli(['enable-totp', '--code', totpCode(secret, Math.floor(Date.now() / 30000))], { env })).code, 1, 'the pending secret is used up');
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

test('activity feed: needs sign-in, filters, limits, and never returns anything outside the safe fields', async () => {
  await store.meta.set('admin_password_hash', await hashPassword('a long test passphrase'));
  await store.meta.set('admin_totp_secret', '');
  const { port } = await start({ loginMaxPerIp: 1000, loginMaxTotal: 1000 });
  assert.equal((await req(port, { path: '/api/audit' })).status, 401, 'refused without a session');
  const login = await post(port, '/login', { password: 'a long test passphrase' });
  assert.equal(login.status, 200, login.body);
  const cookie = cookieFrom(login);
  await store.audit.addMany([
    { ev: 'admin-login', ip: '127.0.0.1', ua: 'Mozilla/5.0' },
    { ev: 'admin-login-failed', ip: '1.2.3.4', ua: '<img src=x onerror=alert(1)>' },
    { ev: 'enter', grant: 'ab12cd34', app: 'toy', ip: '5.6.7.8', tokenHash: 'SECRET-HASH', sid: 'SECRET-SESSION' },
    { ev: 'denied', grant: 'ab12cd34', app: 'toy', ip: '5.6.7.8', why: 'expired' },
  ]);
  const get = async (q) => req(port, { path: '/api/audit' + q, headers: { cookie } });
  const all = await get('');
  assert.equal(all.status, 200);
  const { events } = JSON.parse(all.body);
  assert.ok(events.length >= 4);
  assert.doesNotMatch(all.body, /SECRET-HASH|SECRET-SESSION/, 'fields outside the whitelist are never sent');
  assert.ok(events.every((e) => !('tokenHash' in e) && !('sid' in e)));
  assert.match(all.body, /onerror=alert/, 'untrusted text is returned as data (the page shows it as plain text)');
  const ownerEvent = (e) => e.ev.startsWith('admin-') || e.ev === 'grant-created' || e.ev === 'grant-revoked'; // what the owner did
  assert.ok(JSON.parse((await get('?kind=admin')).body).events.every(ownerEvent));
  assert.ok(JSON.parse((await get('?kind=demos')).body).events.every((e) => !ownerEvent(e)));
  const problems = JSON.parse((await get('?kind=problems')).body).events;
  assert.ok(problems.length >= 2 && problems.every((e) => e.ev === 'admin-login-failed' || e.ev === 'denied'));
  assert.equal(JSON.parse((await get('?limit=2')).body).events.length, 2);
  assert.equal((await get('?kind=bogus')).status, 400);
  assert.equal((await req(port, { method: 'POST', path: '/api/audit', headers: { cookie, origin: `http://127.0.0.1:${port}` } })).status === 200, false, 'read-only');
});

// ---------- error handling
test('security: scripts need a per-response nonce; no inline script or handler is allowed', async () => {
  await store.meta.set('admin_password_hash', await hashPassword('a long test passphrase'));
  const { port } = await start({ trustedProxies: ['127.0.0.1'] });
  const fresh = { 'x-forwarded-for': '203.0.113.99' };
  const cookie = cookieFrom(await post(port, '/login', { password: 'a long test passphrase' }, fresh));
  const one = await req(port, { headers: { cookie, ...fresh } }), two = await req(port, { headers: { cookie, ...fresh } });
  const nonce = (r) => /script-src 'nonce-([^']+)'/.exec(r.headers['content-security-policy'])?.[1];
  assert.ok(nonce(one) && nonce(one) !== nonce(two), 'a fresh nonce for each response');
  assert.doesNotMatch(one.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
  assert.ok(one.body.includes(`<script nonce="${nonce(one)}">`), 'the page script carries the nonce');
  assert.doesNotMatch(one.body, /<script>/, 'no un-nonced script tag');
  assert.doesNotMatch(one.body, /\son(click|load|error|submit|change)=/i, 'no inline event handler attributes');
  const login = await req(port, { path: '/login' });
  assert.ok(login.body.includes(`<script nonce="${nonce(login)}">`));
  const api = await req(port, { path: '/api/session', headers: { cookie, ...fresh } });
  assert.equal(api.headers['content-security-policy'], undefined, 'json responses are not given a page CSP (json() sets its own headers)');
});

test('errors: bad JSON bodies are 400, unknown grant is 404, failed supervisor commands are 502, unreadable status is flagged', async () => {
  await store.meta.set('admin_password_hash', await hashPassword('a long test passphrase'));
  const failing = async (args) => (args[0] === 'status' ? { ok: false, output: 'boom' } : { ok: false, output: 'NOT RESPONDING after 60s' });
  const { port } = await start({ supervisor: failing, trustedProxies: ['127.0.0.1'] });
  const fresh = { 'x-forwarded-for': '203.0.113.77' }; // its own rate-limit bucket
  assert.equal((await post(port, '/login', null, fresh)).status, 400, 'a JSON null body is a bad request, not a 500');
  const good = await post(port, '/login', { password: 'a long test passphrase' }, fresh);
  const cookie = cookieFrom(good);
  const authed = { cookie };
  assert.equal((await post(port, '/api/demos', null, authed)).status, 400);
  assert.equal((await post(port, '/api/demos', { customer: 'X', app: 'nope' }, authed)).status, 400);
  assert.equal((await post(port, '/api/demos/deadbeef/revoke', {}, authed)).status, 404, 'unknown grant');
  const start502 = await post(port, '/api/apps/toy/start', {}, authed);
  assert.equal(start502.status, 502);
  assert.equal(JSON.parse(start502.body).ok, false);
  const apps = await req(port, { path: '/api/apps', headers: authed });
  assert.equal(apps.status, 200);
  assert.equal(apps.headers['x-status-error'], 'failed', 'a failed status check is reported, not shown as "all stopped"');
  assert.equal((await req(port, { method: 'DELETE', path: '/api/demos', headers: authed })).status, 405);
});

test('security: starting an app and signing out are recorded in the audit log', async () => {
  await store.meta.set('admin_password_hash', await hashPassword('a long test passphrase'));
  const { port } = await start({ trustedProxies: ['127.0.0.1'] });
  const fresh = { 'x-forwarded-for': '203.0.113.88' };
  const cookie = cookieFrom(await post(port, '/login', { password: 'a long test passphrase' }, fresh));
  const authed = { cookie, ...fresh };
  await post(port, '/api/apps/toy/start', {}, authed);
  await post(port, '/logout', {}, authed);
  await new Promise((r) => setTimeout(r, 100)); // audit writes are fire-and-forget
  const evs = (await store.audit.list(50)).map((e) => e.ev);
  assert.ok(evs.includes('admin-app-start'), evs.join());
  assert.ok(evs.includes('admin-logout'), evs.join());
});

test('status: requests that arrive together share one supervisor status check, and an action drops the saved answer', async () => {
  await store.meta.set('admin_password_hash', ''); // token mode
  let statusRuns = 0;
  const supervisor = async (args) => {
    if (args[0] !== 'status') return { ok: true, output: 'done' };
    statusRuns++; await new Promise((r) => setTimeout(r, 150)); // a slow check, like a real one
    return { ok: true, output: '[]' };
  };
  const { c, port } = await start({ supervisor });
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const get = (path) => req(port, { path, headers: { cookie } });
  await Promise.all([get('/api/apps'), get('/api/demos'), get('/api/apps'), get('/api/demos')]);
  assert.equal(statusRuns, 1, 'four requests at once ran one check');
  await get('/api/apps');
  assert.equal(statusRuns, 1, 'a request a moment later reuses the answer');
  const done = await post(port, '/api/apps/toy/start', {}, { cookie });
  assert.equal(done.status, 200);
  await get('/api/apps');
  assert.equal(statusRuns, 2, 'after a start the next request asks again');
});

test('a start/stop request that is refused (wrong origin, or the app is busy) is recorded in the activity feed', async () => {
  await store.meta.set('admin_password_hash', ''); // token mode
  let release; const slow = new Promise((r) => { release = r; });
  const supervisor = async (args) => { if (args[0] === 'status') return { ok: true, output: '[]' }; await slow; return { ok: true, output: 'done' }; };
  const { c, port } = await start({ supervisor });
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const bad = await req(port, { method: 'POST', path: '/api/apps/toy/start', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 403);
  const first = post(port, '/api/apps/toy/start', {}, { cookie }); // holds the app busy until released
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await post(port, '/api/apps/toy/start', {}, { cookie })).status, 409);
  release(); assert.equal((await first).status, 200);
  const feed = JSON.parse((await req(port, { path: '/api/audit?kind=problems', headers: { cookie } })).body).events;
  assert.deepEqual(feed.filter((e) => e.ev === 'admin-action-refused').map((e) => e.why).sort(), ['bad-origin', 'busy']);
});

test('forgetting a customer removes their audit events and name, but only once the link is no longer active', async () => {
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Forget Me', app: 'toy', hours: 1 }, { cookie })).body);
  const id = made.grant.id;
  assert.equal((await post(port, '/api/demos/' + id + '/forget', {}, { cookie })).status, 409, 'still active');
  assert.equal((await post(port, '/api/demos/' + id + '/revoke', {}, { cookie })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok((await store.audit.list(500)).some((e) => e.grant === id), 'events exist first');
  const r = await post(port, '/api/demos/' + id + '/forget', {}, { cookie });
  assert.equal(r.status, 200);
  assert.ok(JSON.parse(r.body).removed >= 2);
  await new Promise((r2) => setTimeout(r2, 50));
  assert.ok(!(await store.audit.list(500)).some((e) => e.grant === id), 'no events left for the grant');
  assert.equal((await store.grants.findById(id)).customer, '(removed)');
  assert.equal((await post(port, '/api/demos/deadbeef/forget', {}, { cookie })).status, 404);
});

test('forget refuses a request that is not signed in, not same-origin or not a POST, and deletes nothing', async () => {
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Keep Me', app: 'toy', hours: 1 }, { cookie })).body);
  const id = made.grant.id, path = '/api/demos/' + id + '/forget';
  assert.equal((await post(port, '/api/demos/' + id + '/revoke', {}, { cookie })).status, 200); // inactive, so only the checks below can stop a forget
  await new Promise((r) => setTimeout(r, 50));
  const eventsBefore = (await store.audit.list(500)).filter((e) => e.grant === id).length;
  assert.ok(eventsBefore >= 2);

  const signedOut = await req(port, { method: 'POST', path, body: '{}', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` } });
  assert.ok([401, 403].includes(signedOut.status), 'without a session: ' + signedOut.status);
  const noOrigin = await req(port, { method: 'POST', path, body: '{}', headers: { cookie, 'content-type': 'application/json' } });
  assert.equal(noOrigin.status, 403, 'no Origin header');
  const crossSite = await req(port, { method: 'POST', path, body: '{}', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' } });
  assert.equal(crossSite.status, 403, 'another site');
  const wrongVerb = await req(port, { method: 'GET', path, headers: { cookie } });
  assert.ok([404, 405].includes(wrongVerb.status), 'GET: ' + wrongVerb.status);

  assert.equal((await store.audit.list(500)).filter((e) => e.grant === id).length, eventsBefore, 'no events were deleted');
  assert.equal((await store.grants.findById(id)).customer, 'Keep Me', 'the name was not removed');
  assert.equal((await post(port, path, {}, { cookie })).status, 200, 'a proper request still works');
});

test('a request body that is not JSON, or not an object, is the client\'s mistake (400); damaged stored data is not (audit F-15)', async () => {
  const prevHash = await store.meta.get('admin_password_hash');
  await store.meta.set('admin_password_hash', '');
  const { c, port } = await start({ supervisor: async () => ({ ok: true, output: '[]' }) });
  try {
    const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
    const raw = (path, body) => req(port, { method: 'POST', path, body, headers: { cookie, 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` } });
    for (const path of ['/api/demos', '/api/demos/toy/reset']) {
      assert.equal((await raw(path, '{nope')).status, 400, path + ': not JSON');
      assert.equal((await raw(path, 'null')).status, 400, path + ': JSON null is not an object (it used to be a 500)');
      assert.equal((await raw(path, '[1]')).status, 400, path + ': an array is not an object');
    }
    const { toResponse } = await import('../../lib/errors.mjs');
    assert.equal(toResponse(new SyntaxError('Unexpected token in stored data')).status, 500, 'a SyntaxError from anywhere else is a server fault');
  } finally { await c.close(); await store.meta.set('admin_password_hash', prevHash ?? ''); }
});

test('ADMIN_APP_CONTROL=off: the console shows status only; start, stop and logs are refused and the page is told (audit F-19)', async () => {
  const prevHash = await store.meta.get('admin_password_hash');
  await store.meta.set('admin_password_hash', '');
  const on = await start({}), off = await start({ appControl: false });
  try {
    const cookieOn = cookieFrom(await req(on.port, { path: '/?t=' + on.c.launchToken }));
    const cookieOff = cookieFrom(await req(off.port, { path: '/?t=' + off.c.launchToken }));
    const apps = async (p, cookie) => JSON.parse((await req(p, { path: '/api/apps', headers: { cookie } })).body);
    assert.ok((await apps(on.port, cookieOn)).every((a) => a.controls === true), 'by default the buttons work');
    assert.ok((await apps(off.port, cookieOff)).every((a) => a.controls === false), 'switched off: the page is told to hide them');
    const demos = async (p, cookie) => JSON.parse((await req(p, { path: '/api/demos', headers: { cookie } })).body);
    assert.equal((await demos(on.port, cookieOn)).appControl, true);
    assert.equal((await demos(off.port, cookieOff)).appControl, false);
    const startToy = (p, cookie) => post(p, '/api/apps/toy/start', {}, { cookie });
    assert.equal((await startToy(off.port, cookieOff)).status, 403, 'and a hand-made request is refused too');
    assert.notEqual((await startToy(on.port, cookieOn)).status, 403);
    assert.equal((await req(off.port, { path: '/api/apps/toy/logs?proc=app', headers: { cookie: cookieOff } })).status, 403);
  } finally { await store.meta.set('admin_password_hash', prevHash ?? ''); }
});

test('the public health check asks the database once per window, however often it is called (audit F-19)', async () => {
  const hits = []; const real = store.meta.get;
  const spyStore = { ...store, meta: { ...store.meta, get: async (k) => { if (k === 'health-check') hits.push(k); return real.call(store.meta, k); } } };
  const { port } = await start({ store: spyStore });
  for (let i = 0; i < 8; i++) assert.equal((await req(port, { path: '/_pd/healthz' })).status, 200);
  assert.equal(hits.length, 1, 'eight calls, one database read');
});

// ---------- per-link activity (analytics plan step 3)
test('demo links show what the customer did: engagement in the list, day-by-day detail on request, sign-in required, status-only mode too', async () => {
  const { c, port } = await start({ appControl: false });
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Activity Co', app: 'toy', hours: 2 }, { cookie })).body);
  const id = made.grant.id;
  const row = async () => JSON.parse((await req(port, { path: '/api/demos', headers: { cookie } })).body).grants.find((g) => g.id === id);
  assert.equal((await row()).activity.engagement, 'none');
  await store.grants.redeem(id, 'dev'); // the customer opens it
  assert.equal((await row()).activity.engagement, 'opened');
  await store.activity.add(id, '2026-03-05', { requests: 4, firstAt: '2026-03-05T10:00:00.000Z', lastAt: '2026-03-05T10:05:00.000Z', activeSeconds: 300, paths: { '/crm/contacts': 3, '/crm': 1 } });
  await store.activity.add(id, '2026-03-06', { requests: 1, activeSeconds: 20, paths: { '/crm': 1 } });
  const a = (await row()).activity;
  assert.deepEqual([a.engagement, a.requests, a.activeMinutes, a.activeDays], ['returned', 5, 5, 2]);
  const detail = JSON.parse((await req(port, { path: `/api/demos/${id}/activity`, headers: { cookie } })).body);
  assert.deepEqual(detail.days.map((d) => d.day), ['2026-03-05', '2026-03-06']);
  assert.deepEqual(detail.topPages, [{ path: '/crm/contacts', count: 3 }, { path: '/crm', count: 2 }]);
  assert.equal((await req(port, { path: `/api/demos/${id}/activity` })).status, 401, 'signed-in owner only');
  assert.equal((await req(port, { path: '/api/demos/0123456789abcdef/activity', headers: { cookie } })).status, 404);
  assert.equal((await req(port, { path: '/api/demos/zz/activity', headers: { cookie } })).status, 404, 'not a link id');
});

test('forget also deletes the activity counts for the link (analytics plan step 4)', async () => {
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Counted Co', app: 'toy', hours: 1 }, { cookie })).body);
  const id = made.grant.id, other = 'feedfacefeedface';
  await store.activity.add(id, '2026-03-05', { requests: 3, paths: { '/a': 3 } });
  await store.activity.add(other, '2026-03-05', { requests: 9 });
  assert.equal((await post(port, '/api/demos/' + id + '/revoke', {}, { cookie })).status, 200);
  assert.equal((await post(port, '/api/demos/' + id + '/forget', {}, { cookie })).status, 200);
  assert.deepEqual(await store.activity.forGrant(id), []);
  assert.equal((await store.activity.forGrant(other)).length, 1, 'another link\'s counts are untouched');
});

test('a link can be created with a name and welcome note for the customer; they are cleaned, listed to the owner, and removed by forget', async () => {
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Label only', app: 'toy', hours: 1, displayName: ' Dana\nat Acme ', welcome: 'Try <b>Contacts</b>\r\n\r\n\r\n\r\nthen Deals' }, { cookie })).body);
  assert.equal(made.grant.displayName, 'Dana at Acme'); assert.equal(made.grant.welcome, 'Try <b>Contacts</b>\n\nthen Deals', 'stored as text; the gateway escapes it when it shows it');
  const listed = JSON.parse((await req(port, { path: '/api/demos', headers: { cookie } })).body).grants.find((g) => g.id === made.grant.id);
  assert.equal(listed.displayName, 'Dana at Acme');
  const plain = JSON.parse((await post(port, '/api/demos', { customer: 'No extras', app: 'toy', hours: 1 }, { cookie })).body);
  assert.deepEqual([plain.grant.displayName, plain.grant.welcome], [null, null]);
  assert.equal((await post(port, '/api/demos/' + made.grant.id + '/revoke', {}, { cookie })).status, 200);
  assert.equal((await post(port, '/api/demos/' + made.grant.id + '/forget', {}, { cookie })).status, 200);
  const after = await store.grants.findById(made.grant.id);
  assert.deepEqual([after.customer, after.displayName, after.welcome], ['(removed)', null, null]);
});
