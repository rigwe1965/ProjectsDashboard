import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordProblem, base32Encode, base32Decode, totpCode, verifyTotp, newTotpSecret, otpauthUrl, hashSessionId, newSessionId } from '../../lib/auth.mjs';

test('passwords: hash and verify, wrong password and garbage hashes fail', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('correct horse batterx', h), false);
  assert.equal(verifyPassword('', h), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.notEqual(hashPassword('same password here'), hashPassword('same password here'), 'each hash has its own salt');
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
