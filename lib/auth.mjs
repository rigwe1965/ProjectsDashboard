// Admin login primitives with no dependencies: scrypt password hashes, TOTP (RFC 6238) two-step codes,
// session ids. Only hashes are ever stored: a password hash, the TOTP secret (it must be recoverable to
// check codes, so it lives in the git-ignored database), and a SHA-256 of each session id.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 12;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(pw)) return 'Use more than one repeated character.';
  return null;
}

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [kind, N, r, p, salt, key] = String(stored).split('$');
    if (kind !== 'scrypt') return false;
    const want = Buffer.from(key, 'base64');
    const got = scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

// ---- TOTP (works with Google Authenticator, Microsoft Authenticator, 1Password, Authy ...)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).replace(/[\s=-]/g, '').toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error('not base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secretB32, step, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

// Returns the time step the code matched (so the caller can refuse to accept the same step twice), or null.
// Accepts the previous and next 30-second step to allow for clock drift.
export function verifyTotp(secretB32, code, now = Date.now(), lastUsedStep = -1) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const cur = Math.floor(now / 30000);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (step <= lastUsedStep) continue; // replay of an already accepted code
    const want = totpCode(secretB32, step);
    if (timingSafeEqual(Buffer.from(want), Buffer.from(given))) return step;
  }
  return null;
}

export const otpauthUrl = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- sessions: the browser holds a random id, the database holds only its hash
export const newSessionId = () => randomBytes(32).toString('hex');
export const hashSessionId = (id) => createHash('sha256').update(String(id)).digest('hex');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
