import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, randomBytes } from 'node:crypto';
import { needsRehash, seal, unseal, isSealed, dataKey, newDataKey, hashPassword, verifyPassword, passwordProblem, base32Encode, base32Decode, totpCode, verifyTotp, newTotpSecret, otpauthUrl, hashSessionId, newSessionId } from '../../lib/auth.mjs';

test('passwords: hash and verify, wrong password and garbage hashes fail', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$131072\$8\$1\$/, 'current cost: N=2^17');
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('correct horse batterx', h), false);
  assert.equal(await verifyPassword('', h), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
  assert.equal(await verifyPassword('x', 'scrypt$1048576$64$1$AAAA$AAAA'), false, 'a hash that asks for absurd memory is refused');
  assert.notEqual(await hashPassword('same password here'), await hashPassword('same password here'), 'each hash has its own salt');
  assert.equal(needsRehash(h), false);
});

test('passwords: hashes made with the old, cheaper setting still verify and are flagged for upgrade', async () => {
  const salt = randomBytes(16), key = scryptSync('an old password here', salt, 64, { N: 16384, r: 8, p: 1 });
  const old = `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
  assert.equal(await verifyPassword('an old password here', old), true);
  assert.equal(await verifyPassword('another password here', old), false);
  assert.equal(needsRehash(old), true);
  assert.equal(needsRehash('garbage'), false);
});

test('passwords: hashing does not block the event loop, and a burst of attempts is queued', async () => {
  let ticks = 0; const t = setInterval(() => { ticks++; }, 5);
  const hs = await Promise.all([1, 2, 3, 4].map((i) => hashPassword('burst password ' + i)));
  clearInterval(t);
  assert.ok(ticks >= 5, 'timers kept firing while hashing: ' + ticks);
  assert.equal(new Set(hs).size, 4);
});

test('sealing: the 2-step secret round-trips with a key, tampering and a wrong key fail, plain values pass through', () => {
  const key = Buffer.from(newDataKey(), 'hex'), other = Buffer.from(newDataKey(), 'hex');
  const secret = newTotpSecret();
  const s = seal(secret, key);
  assert.ok(isSealed(s)); assert.ok(!s.includes(secret));
  assert.equal(unseal(s, key), secret);
  assert.notEqual(seal(secret, key), s, 'a new nonce each time');
  assert.throws(() => unseal(s, other), 'wrong key');
  assert.throws(() => unseal(s.slice(0, -4) + 'AAAA', key), 'tampered');
  assert.throws(() => unseal(s, null), /ADMIN_DATA_KEY/, 'sealed but no key');
  assert.equal(seal(secret, null), secret, 'no key: stored as before');
  assert.equal(unseal(secret, null), secret, 'a plain (older) value is still readable');
  assert.equal(dataKey({ ADMIN_DATA_KEY: 'short' }), null);
  assert.equal(dataKey({ ADMIN_DATA_KEY: key.toString('hex') }).equals(key), true);
});

test('password rules', () => {
  assert.match(passwordProblem('short'), /at least 12/);
  assert.match(passwordProblem('aaaaaaaaaaaaaaaa'), /repeated/);
  assert.equal(passwordProblem('a long enough passphrase'), null);
  assert.ok(passwordProblem('x'.repeat(201)));
});

test('base32 round trips', () => {
  const buf = Buffer.from('12345678901234567890');
  assert.equal(base32Encode(buf), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'); // RFC 6238 test secret
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), buf);
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq'), buf, 'case, spaces and dashes are ignored');
  assert.throws(() => base32Decode('not*base32'));
});

test('TOTP matches the RFC 6238 SHA-1 test vectors (last 6 digits of the 8-digit values)', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const at = (t) => totpCode(secret, Math.floor(t / 30));
  assert.equal(at(59), '287082');
  assert.equal(at(1111111109), '081804');
  assert.equal(at(1234567890), '005924');
  assert.equal(at(20000000000), '353130');
});

test('verifyTotp: accepts current and adjacent step, rejects others, refuses replays, ignores junk', () => {
  const secret = newTotpSecret();
  const now = 1700000000000, step = Math.floor(now / 30000);
  assert.equal(verifyTotp(secret, totpCode(secret, step), now), step);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 1), now), step - 1, 'one step of clock drift is allowed');
  assert.equal(verifyTotp(secret, totpCode(secret, step + 1), now), step + 1);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 3), now), null);
  assert.equal(verifyTotp(secret, totpCode(secret, step), now, step), null, 'a code already used must not work again');
  assert.equal(verifyTotp(secret, '12345', now), null);
  assert.equal(verifyTotp(secret, 'abcdef', now), null);
  assert.equal(verifyTotp(secret, undefined, now), null);
});

test('otpauth URL and session ids', () => {
  assert.match(otpauthUrl('ABC', 'admin', 'Projects Dashboard'), /^otpauth:\/\/totp\/Projects%20Dashboard:admin\?secret=ABC&issuer=Projects%20Dashboard/);
  const id = newSessionId();
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.notEqual(newSessionId(), id);
  assert.match(hashSessionId(id), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionId(id), id, 'only the hash is stored');
});

test('ADMIN_KEYS: the stored names are fixed (renaming one would silently sign everyone out of password mode)', async () => {
  const { ADMIN_KEYS } = await import('../../lib/auth.mjs');
  assert.deepEqual({ ...ADMIN_KEYS }, { passwordHash: 'admin_password_hash', totpSecret: 'admin_totp_secret', totpLastStep: 'admin_totp_last_step', totpPending: 'admin_totp_pending', totpPendingFile: 'admin_totp_pending_file' });
  assert.ok(Object.isFrozen(ADMIN_KEYS));
});

test('sign-in checks beyond the queue limit are refused at once with AUTH_BUSY, not queued', async () => {
  // a cheap hash, so the test is quick; what matters is how many are waiting when the 22nd arrives
  const { scryptSync, randomBytes } = await import('node:crypto');
  const salt = randomBytes(16), key = scryptSync('pw', salt, 64, { N: 1024, r: 8, p: 1 });
  const cheap = ['scrypt', 1024, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => verifyPassword('pw', cheap)));
  const busy = results.filter((r) => r.status === 'rejected' && r.reason.code === 'AUTH_BUSY').length;
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  assert.equal(busy + ok, 40, 'every attempt either ran or was refused as busy; none was reported as a wrong password');
  assert.equal(ok, 22, '2 running + 20 waiting');
  assert.equal(busy, 18);
  assert.equal(await verifyPassword('pw', cheap), true, 'and it recovers once they have finished');
});
