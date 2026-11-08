// Admin login primitives with no dependencies: scrypt password hashes, TOTP (RFC 6238) two-step codes,
// session ids. Stored: a password hash, the TOTP secret (it must be recoverable to check codes, so it is ENCRYPTED with
// a key held outside the database whenever ADMIN_DATA_KEY is set), and a SHA-256 of each session id.
import { scrypt, randomBytes, timingSafeEqual, createHmac, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

export const MIN_PASSWORD_LENGTH = 12;
// OWASP guidance for scrypt: N=2^17, r=8, p=1 (about 128 MB and a third of a second per attempt). Stored hashes record
// their own parameters, so hashes made with a lower cost keep working and are upgraded at the next successful sign-in.
const SCRYPT = { N: 131072, r: 8, p: 1 };
const scryptAsync = promisify(scrypt);
const memFor = (N, r) => 256 * N * r; // scrypt needs 128*N*r; the limit has headroom

// scrypt runs on the thread pool (the event loop keeps serving), and at most MAX_HASHING run at once so a burst of sign-in
// attempts cannot use up the machine's memory (each one needs ~128 MB).
const MAX_HASHING = 2;
let hashing = 0; const queue = [];
async function withSlot(fn) {
  if (hashing >= MAX_HASHING) await new Promise((r) => queue.push(r)); else hashing++;
  try { return await fn(); } finally { const next = queue.shift(); if (next) next(); else hashing--; }
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(pw)) return 'Use more than one repeated character.';
  return null;
}

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await withSlot(() => scryptAsync(String(pw), salt, 64, { ...SCRYPT, maxmem: memFor(SCRYPT.N, SCRYPT.r) }));
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  try {
    const [kind, N, r, p, salt, key] = String(stored).split('$');
    if (kind !== 'scrypt' || !(+N <= 2 ** 20 && +r <= 16 && +p <= 4)) return false; // never let a damaged hash demand huge memory
    const want = Buffer.from(key, 'base64');
    const got = await withSlot(() => scryptAsync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p, maxmem: memFor(+N, +r) }));
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

// True when a stored hash was made with a lower cost than today's, so it can be replaced after a successful sign-in.
export function needsRehash(stored) {
  const [kind, N, r, p] = String(stored).split('$');
  return kind === 'scrypt' && (+N < SCRYPT.N || +r < SCRYPT.r || +p < SCRYPT.p);
}

// ---- encryption of the TOTP secret at rest. The key (32 bytes as 64 hex characters) lives outside the database, in the
// ADMIN_DATA_KEY environment variable, so a copy of the database file alone does not give away the authenticator secret.
export const newDataKey = () => randomBytes(32).toString('hex');
export function dataKey(env = process.env) {
  const h = String(env.ADMIN_DATA_KEY || '').trim();
  return /^[a-f0-9]{64}$/i.test(h) ? Buffer.from(h, 'hex') : null;
}
const SEALED = 'enc1.';
export const isSealed = (s) => typeof s === 'string' && s.startsWith(SEALED);
// With no key, the value is returned unchanged (stored as before); callers warn about that.
export function seal(plain, key = dataKey()) {
  if (!key || !plain) return plain;
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return SEALED + [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
// Plain (older) values pass through. A sealed value needs the right key: otherwise this throws, and callers refuse sign-in.
export function unseal(stored, key = dataKey()) {
  if (!isSealed(stored)) return stored;
  if (!key) throw new Error('The 2-step secret is encrypted but ADMIN_DATA_KEY is not set (or is not 64 hex characters).');
  const [iv, tag, enc] = stored.slice(SEALED.length).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
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
