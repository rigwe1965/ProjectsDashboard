// Admin console tests: both login modes, rate limiting, 2-step codes, CSRF/Host checks, and the auth CLI.
// Everything is temporary: own database and registry. DASHBOARD_DATA must be set BEFORE the modules are imported.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pd-con-'));
const proc = (name, port) => ({ name, cmd: 'x', port });
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [proc('app', 19001)] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, processes: [proc('app', 19002)] },
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

function req(port, { method = 'GET', path = '/', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: host ?? `127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}
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

test('demo links: created with limits through the API, listed with use counts', async () => {
  const { c, port } = await start();
  const cookie = cookieFrom(await req(port, { path: '/?t=' + c.launchToken }));
  const made = JSON.parse((await post(port, '/api/demos', { customer: 'Acme', app: 'toy', hours: 2, maxUses: 3, deviceLock: true }, { cookie })).body);
  assert.equal(made.grant.maxUses, 3);
  assert.equal(made.grant.deviceLock, true);
  assert.match(made.link, /\/d\/[a-f0-9]{48}$/);
  const bad = await post(port, '/api/demos', { customer: 'Acme', app: 'toy', maxUses: 0 }, { cookie });
  assert.equal(bad.status, 400);
  const list = JSON.parse((await req(port, { path: '/api/demos', headers: { cookie } })).body);
  assert.equal(list.grants.find((g) => g.id === made.grant.id).uses, 0);
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
  assert.equal(page.status, 200); assert.match(page.body, /Owner sign-in/);

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

test('password mode: a flood of failed logins from other addresses does not lock the owner out', async () => {
  const { port } = await start({ loginMaxPerIp: 100, loginMaxTotal: 3 });
  for (let i = 0; i < 6; i++) await post(port, '/login', { password: 'wrong wrong wrong' });
  assert.equal((await post(port, '/login', { password: 'wrong wrong wrong' })).status, 429, 'more bad guesses are refused');
  assert.equal((await post(port, '/login', { password: 'a long test passphrase' })).status, 200, 'the right password still works');
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
});

// ---------- the CLI
const cli = fileURLToPath(new URL('../../admin-console/auth-cli.mjs', import.meta.url));
function runCli(args, { input, env = {}, interactive } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
  assert.ok(JSON.parse((await get('?kind=admin')).body).events.every((e) => e.ev.startsWith('admin-')));
  assert.ok(JSON.parse((await get('?kind=demos')).body).events.every((e) => !e.ev.startsWith('admin-')));
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
