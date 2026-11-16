// Signed licence files for the products that are sold one copy per customer (docs/PLAN-licensing.md).
//
// A licence is one line of text: FKL1.<payload>.<signature>
//   payload    base64url of a small JSON document (who, which product, which tier, what limits, from when to when)
//   signature  base64url Ed25519 signature over the text "FKL1.<payload>"
// Only the owner holds the private key (it never lives in a repository or on a customer's machine). A product carries
// the matching public key and checks the signature by itself, offline. This file is the reference implementation; the
// Python version in the RMM product must agree with licensing/test-vectors.json.
//
// What this module decides: is a licence genuine, and what does it entitle the customer to at a given moment. It never
// decides to shut anything down. A product asks `evaluate()` whether it may ADD another device, user or vehicle and what
// banner to show, and keeps everything that already exists working whatever the answer.
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';

export const FORMAT = 'FKL1';
export const GRACE_DAYS = 30; // after the end date, adding more still works this long
export const EXPIRY_WARNING_DAYS = 30; // the banner starts this long before the end date
const DAY_MS = 86_400_000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

// Ed25519 keys travel as their raw 32 bytes in base64url. These prefixes wrap them into the DER forms node:crypto reads.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** The public key (raw 32 bytes, base64url) that matches a private key given as PEM or as a node:crypto KeyObject. */
export function publicKeyOf(privateKey) {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
  return b64u(spki.subarray(spki.length - 32));
}

/** A private key from its 32-byte seed. Used by the test vectors, which must be reproducible. */
export function privateKeyFromSeed(seed) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]), format: 'der', type: 'pkcs8' });
}

const publicKeyObject = (raw) => createPublicKey({ key: Buffer.concat([SPKI_PREFIX, fromB64u(raw)]), format: 'der', type: 'spki' });

const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(s) && !Number.isNaN(Date.parse(s));

/** Throws a plain-words Error when a licence payload is not acceptable. Returns the payload for chaining. */
export function checkPayload(p) {
  const fail = (m) => { throw new Error(`Licence is not valid: ${m}`); };
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('it is not an object');
  if (p.v !== 1) fail('unsupported version');
  for (const k of ['id', 'product', 'customer', 'tier']) if (typeof p[k] !== 'string' || !p[k].trim()) fail(`${k} is missing`);
  if (!/^[a-z0-9-]{2,40}$/.test(p.product)) fail('product must be lower-case letters, digits and hyphens');
  if (!isIsoDate(p.iat) || !isIsoDate(p.exp)) fail('dates must be ISO dates');
  if (Date.parse(p.exp) <= Date.parse(p.iat)) fail('the end date must be after the start date');
  if (!p.limits || typeof p.limits !== 'object' || Array.isArray(p.limits)) fail('limits are missing');
  for (const [k, v] of Object.entries(p.limits)) {
    if (!/^[a-z]{2,20}$/.test(k)) fail(`limit name "${k}" is not allowed`);
    if (v !== null && !(Number.isInteger(v) && v >= 0)) fail(`limit "${k}" must be a whole number, or null for unlimited`);
  }
  return p;
}

/** Signs a licence payload with the owner's private key and returns the one-line licence text. */
export function sign(payload, privateKey) {
  checkPayload(payload);
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  const body = `${FORMAT}.${b64u(JSON.stringify(payload))}`;
  return `${body}.${b64u(edSign(null, Buffer.from(body), key))}`;
}

/**
 * Checks that a licence text is genuine: well formed, signed by one of `publicKeys`, for `product`. It does NOT look at the
 * dates (that is `evaluate`), so an expired licence still verifies and the product can say so kindly.
 * Returns { ok: true, licence } or { ok: false, reason } where reason is malformed | unsupported | bad_signature | wrong_product.
 */
export function verify(token, { publicKeys, product } = {}) {
  const parts = typeof token === 'string' ? token.trim().split('.') : [];
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  if (parts[0] !== FORMAT) return { ok: false, reason: parts[0].startsWith('FKL') ? 'unsupported' : 'malformed' };
  let payload;
  let signature;
  try {
    payload = JSON.parse(fromB64u(parts[1]).toString('utf8'));
    signature = fromB64u(parts[2]);
    checkPayload(payload);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const body = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signedByUs = (publicKeys ?? []).some((raw) => {
    try {
      return edVerify(null, body, publicKeyObject(raw), signature);
    } catch {
      return false;
    }
  });
  if (!signedByUs) return { ok: false, reason: 'bad_signature' };
  if (product && payload.product !== product) return { ok: false, reason: 'wrong_product' };
  return { ok: true, licence: payload };
}

/** Reads the payload of a licence text WITHOUT checking the signature. For showing what a file says; never for deciding anything. */
export function peek(token) {
  const parts = typeof token === 'string' ? token.trim().split('.') : [];
  if (parts.length !== 3 || parts[0] !== FORMAT) return null;
  try {
    return JSON.parse(fromB64u(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
}

const dateOnly = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * What a verified licence entitles the customer to at `now`, given how much they use (`usage`, e.g. { devices: 31, users: 4 }).
 *
 *   state    active | expiring (ends within 30 days) | grace (ended, up to 30 days ago) | lapsed (ended more than 30 days ago)
 *   canAdd   per limit name: may another one be added? True while under the limit and the licence is not lapsed.
 *   banner   plain words for the admin, or null when there is nothing to say
 *
 * Nothing that already exists is ever switched off by this: a product that is over its limit or lapsed only refuses to
 * ADD, and says why.
 */
export function evaluate(licence, now = new Date(), usage = {}) {
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  const end = Date.parse(licence.exp);
  const daysLeft = Math.ceil((end - t) / DAY_MS);
  const graceEnd = end + GRACE_DAYS * DAY_MS;
  const state = t < end - EXPIRY_WARNING_DAYS * DAY_MS ? 'active' : t < end ? 'expiring' : t < graceEnd ? 'grace' : 'lapsed';
  const canAdd = {};
  const over = {};
  for (const [name, limit] of Object.entries(licence.limits)) {
    const used = usage[name] ?? 0;
    canAdd[name] = state !== 'lapsed' && (limit === null || used < limit);
    if (limit !== null && used > limit) over[name] = { used, limit };
  }
  const notes = [];
  if (state === 'expiring') notes.push(`Your licence ends on ${dateOnly(end)}. Renew it to keep adding more.`);
  if (state === 'grace') notes.push(`Your licence ended on ${dateOnly(end)}. You can keep adding until ${dateOnly(graceEnd)}; renew it to continue after that.`);
  if (state === 'lapsed') notes.push(`Your licence ended on ${dateOnly(end)}. Everything you have keeps working, but you cannot add more until it is renewed.`);
  for (const [name, o] of Object.entries(over)) notes.push(`You are using ${o.used} ${name}; your licence covers ${o.limit}.`);
  return { state, daysLeft, endsOn: dateOnly(end), graceEndsOn: dateOnly(graceEnd), limits: licence.limits, usage, canAdd, over, banner: notes.length ? notes.join(' ') : null };
}
