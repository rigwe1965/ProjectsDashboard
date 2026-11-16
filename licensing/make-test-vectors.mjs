// Regenerates licensing/test-vectors.json. Every implementation of the licence check (this one, and the Python one in the RMM
// product) must give the same answers for these cases. The key here is a TEST key derived from a fixed phrase: it is public
// by design and is never used to sign a real licence.
//   node licensing/make-test-vectors.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, privateKeyFromSeed, publicKeyOf, sign, verify } from './licence.mjs';

const seed = createHash('sha256').update('facyke-licence-test-vectors-v1').digest();
const key = privateKeyFromSeed(seed);
const publicKey = publicKeyOf(key);

const base = { v: 1, id: 'lic_test000001', product: 'rmm', customer: 'Acme IT (test)', tier: 'premium', iat: '2026-11-17T00:00:00Z', exp: '2027-11-30T23:59:59Z' };
const premium = sign({ ...base, limits: { devices: 250, users: 25 } }, key);
const unlimited = sign({ ...base, id: 'lic_test000002', tier: 'enterprise', limits: { devices: null, users: null } }, key);
const [h, p, s] = premium.split('.');
const raised = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), limits: { devices: 9999, users: 25 } })).toString('base64url');
const flip = (str) => (str[0] === 'A' ? 'B' : 'A') + str.slice(1);
const otherKey = privateKeyFromSeed(createHash('sha256').update('some-other-key').digest());

const verifyCases = [
  { name: 'a genuine licence', token: premium, product: 'rmm', expect: { ok: true } },
  { name: 'a genuine licence, no product asked for', token: premium, expect: { ok: true } },
  { name: 'wrong product', token: premium, product: 'reci', expect: { ok: false, reason: 'wrong_product' } },
  { name: 'device limit raised after signing', token: `${h}.${raised}.${s}`, product: 'rmm', expect: { ok: false, reason: 'bad_signature' } },
  { name: 'payload corrupted', token: `${h}.${flip(p)}.${s}`, product: 'rmm', expect: { ok: false, reason: 'malformed' } },
  { name: 'signature changed', token: `${h}.${p}.${flip(s)}`, product: 'rmm', expect: { ok: false, reason: 'bad_signature' } },
  { name: 'signed by a different key', token: sign({ ...base, limits: { devices: 250 } }, otherKey), product: 'rmm', expect: { ok: false, reason: 'bad_signature' } },
  { name: 'a newer format this product does not know', token: premium.replace('FKL1.', 'FKL2.'), product: 'rmm', expect: { ok: false, reason: 'unsupported' } },
  { name: 'not a licence at all', token: 'hello', product: 'rmm', expect: { ok: false, reason: 'malformed' } },
  { name: 'empty', token: '', product: 'rmm', expect: { ok: false, reason: 'malformed' } },
  { name: 'two parts only', token: `${h}.${p}`, product: 'rmm', expect: { ok: false, reason: 'malformed' } },
];
for (const c of verifyCases) {
  const r = verify(c.token, { publicKeys: [publicKey], product: c.product });
  if (r.ok !== c.expect.ok || r.reason !== c.expect.reason) throw new Error(`vector "${c.name}" does not behave as written: ${JSON.stringify(r)}`);
}

const when = (name, token, now, usage) => {
  const licence = verify(token, { publicKeys: [publicKey] }).licence;
  const e = evaluate(licence, new Date(now), usage);
  return { name, token, now, usage, expect: { state: e.state, daysLeft: e.daysLeft, endsOn: e.endsOn, graceEndsOn: e.graceEndsOn, canAdd: e.canAdd, over: e.over, banner: e.banner } };
};
const evaluateCases = [
  when('well before the end, under the limit', premium, '2027-01-15T12:00:00Z', { devices: 30, users: 4 }),
  when('exactly at the limit: nothing more may be added', premium, '2027-01-15T12:00:00Z', { devices: 250, users: 4 }),
  when('over the limit: a note, nothing switched off', premium, '2027-01-15T12:00:00Z', { devices: 262, users: 4 }),
  when('31 days before the end: still quiet', premium, '2027-10-30T00:00:00Z', { devices: 10, users: 1 }),
  when('30 days before the end: expiring', premium, '2027-11-01T00:00:00Z', { devices: 10, users: 1 }),
  when('the day after the end: grace, adding still works', premium, '2027-12-01T08:00:00Z', { devices: 10, users: 1 }),
  when('last day of grace', premium, '2027-12-30T23:00:00Z', { devices: 10, users: 1 }),
  when('after grace: lapsed, nothing may be added', premium, '2027-12-31T00:00:00Z', { devices: 10, users: 1 }),
  when('lapsed and over the limit', premium, '2028-03-01T00:00:00Z', { devices: 300, users: 30 }),
  when('unlimited tier, large use', unlimited, '2027-03-01T00:00:00Z', { devices: 5000, users: 900 }),
  when('unlimited tier, lapsed', unlimited, '2028-06-01T00:00:00Z', { devices: 5000, users: 900 }),
  when('usage not reported counts as none', premium, '2027-03-01T00:00:00Z', {}),
];

const out = {
  about: 'Test vectors for licensing/licence.mjs. TEST key only. Regenerate with: node licensing/make-test-vectors.mjs',
  publicKey,
  verify: verifyCases,
  evaluate: evaluateCases,
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'test-vectors.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${verifyCases.length} verify cases and ${evaluateCases.length} evaluate cases.`);
