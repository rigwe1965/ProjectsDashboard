import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPayload, evaluate, peek, publicKeyOf, sign, verify } from '../../licensing/licence.mjs';
import { run } from '../../licensing/cli.mjs';

const vectors = JSON.parse(readFileSync(new URL('../../licensing/test-vectors.json', import.meta.url), 'utf8'));
const keys = [vectors.publicKey];

// ---- the shared test vectors: every implementation (this one, the Python one in RMM) must agree with them ----------------
for (const c of vectors.verify) {
  test(`vector, verify: ${c.name}`, () => {
    const r = verify(c.token, { publicKeys: keys, product: c.product });
    assert.equal(r.ok, c.expect.ok);
    if (!c.expect.ok) assert.equal(r.reason, c.expect.reason);
  });
}
for (const c of vectors.evaluate) {
  test(`vector, evaluate: ${c.name}`, () => {
    const licence = verify(c.token, { publicKeys: keys }).licence;
    const e = evaluate(licence, new Date(c.now), c.usage);
    assert.deepEqual({ state: e.state, endsOn: e.endsOn, graceEndsOn: e.graceEndsOn, canAdd: e.canAdd, over: e.over, banner: e.banner }, { state: c.expect.state, endsOn: c.expect.endsOn, graceEndsOn: c.expect.graceEndsOn, canAdd: c.expect.canAdd, over: c.expect.over, banner: c.expect.banner });
    assert.equal(e.daysLeft + 0, c.expect.daysLeft + 0); // + 0 turns -0 into 0
  });
}

// ---- signing and checking ---------------------------------------------------------------------------------------------------
const good = { v: 1, id: 'lic_x', product: 'rmm', customer: 'Acme', tier: 'standard', iat: '2026-01-01T00:00:00Z', exp: '2027-01-01T00:00:00Z', limits: { devices: 25 } };

test('a licence signed with the private key verifies with the matching public key only', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const a = generateKeyPairSync('ed25519').privateKey;
  const b = generateKeyPairSync('ed25519').privateKey;
  const token = sign(good, a);
  assert.match(token, /^FKL1\.[\w-]+\.[\w-]+$/);
  assert.equal(verify(token, { publicKeys: [publicKeyOf(a)] }).ok, true);
  assert.equal(verify(token, { publicKeys: [publicKeyOf(b)] }).reason, 'bad_signature');
  assert.equal(verify(token, { publicKeys: [] }).reason, 'bad_signature');
  assert.equal(verify(token, { publicKeys: [publicKeyOf(b), publicKeyOf(a)] }).ok, true, 'a product may carry two keys (rotation)');
});

test('a garbage public key never makes a licence verify, and never throws', () => {
  const token = vectors.verify[0].token;
  assert.equal(verify(token, { publicKeys: ['not-a-key', ''] }).ok, false);
});

test('surrounding whitespace in a pasted licence is ignored', () => {
  assert.equal(verify(`  ${vectors.verify[0].token}\n`, { publicKeys: keys }).ok, true);
});

test('an expired licence still verifies: the product says so kindly instead of refusing to read it', () => {
  const r = verify(vectors.verify[0].token, { publicKeys: keys });
  assert.equal(r.ok, true);
  assert.equal(evaluate(r.licence, new Date('2035-01-01')).state, 'lapsed');
});

test('peek reads a licence without trusting it, and returns null for anything else', () => {
  assert.equal(peek(vectors.verify[0].token).customer, 'Acme IT (test)');
  assert.equal(peek('nope'), null);
  assert.equal(peek(undefined), null);
});

test('payload rules: required fields, dates, limits', () => {
  assert.doesNotThrow(() => checkPayload(good));
  for (const bad of [null, [], { ...good, v: 2 }, { ...good, id: '' }, { ...good, product: 'Bad Product' }, { ...good, iat: 'yesterday' }, { ...good, exp: '2025-01-01T00:00:00Z' }, { ...good, limits: null }, { ...good, limits: { devices: -1 } }, { ...good, limits: { devices: 1.5 } }, { ...good, limits: { 'Bad-Name': 1 } }]) {
    assert.throws(() => checkPayload(bad), /Licence is not valid/);
  }
  assert.doesNotThrow(() => checkPayload({ ...good, limits: { devices: null } }), 'null means unlimited');
});

test('signing refuses an invalid payload, so a bad licence can never be issued', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  assert.throws(() => sign({ ...good, limits: { devices: -5 } }, generateKeyPairSync('ed25519').privateKey), /not valid/);
});

test('evaluate: banners are quiet when there is nothing to say', () => {
  const e = evaluate(good, new Date('2026-03-01'), { devices: 3 });
  assert.equal(e.state, 'active');
  assert.equal(e.banner, null);
  assert.deepEqual(e.canAdd, { devices: true });
});

// ---- the command-line tool -------------------------------------------------------------------------------------------------
function tool() {
  const dir = mkdtempSync(join(tmpdir(), 'licence-test-'));
  const out = [];
  const err = [];
  const io = { out: (s) => out.push(s), err: (s) => err.push(s), now: () => new Date('2026-11-17T10:00:00Z') };
  return { dir, out, err, io, key: join(dir, 'signing-key.pem'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('keygen makes a key outside the repository, prints only the public key, and never overwrites', () => {
  const t = tool();
  try {
    assert.equal(run(['keygen', '--out', t.key], t.io), 0);
    assert.ok(existsSync(t.key));
    const pem = readFileSync(t.key, 'utf8');
    assert.match(pem, /BEGIN PRIVATE KEY/);
    const printed = t.out.join('\n');
    assert.ok(!printed.includes(pem.split('\n')[1]), 'the private key is never printed');
    assert.match(printed, /Public key .*: [\w-]{43}/);
    // a second run must not replace it
    assert.equal(run(['keygen', '--out', t.key], t.io), 1);
    assert.match(t.err.join('\n'), /already a key/);
    assert.equal(readFileSync(t.key, 'utf8'), pem);
  } finally {
    t.done();
  }
});

test('keygen refuses a place inside this repository', () => {
  const t = tool();
  try {
    assert.equal(run(['keygen', '--out', join(process.cwd(), 'licensing', 'oops.pem')], t.io), 1);
    assert.match(t.err.join('\n'), /outside this repository/);
    assert.ok(!existsSync(join(process.cwd(), 'licensing', 'oops.pem')));
  } finally {
    t.done();
  }
});

test('issue produces a licence the printed public key accepts, and notes it in issued.jsonl without secrets', () => {
  const t = tool();
  try {
    run(['keygen', '--out', t.key], t.io);
    const pub = t.out.join('\n').match(/: ([\w-]{43})/)[1];
    t.out.length = 0;
    assert.equal(run(['issue', '--key', t.key, '--product', 'rmm', '--customer', 'Acme IT', '--tier', 'premium', '--limit', 'devices=250', '--limit', 'users=25', '--until', '2027-11-30'], t.io), 0);
    const token = t.out[0];
    const r = verify(token, { publicKeys: [pub], product: 'rmm' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.licence.limits, { devices: 250, users: 25 });
    assert.equal(r.licence.exp, '2027-11-30T23:59:59Z');
    assert.equal(r.licence.iat, '2026-11-17T10:00:00Z');
    const issued = readFileSync(join(t.dir, 'issued.jsonl'), 'utf8');
    assert.match(issued, /Acme IT/);
    assert.ok(!issued.includes('PRIVATE'));
    assert.ok(!issued.includes(token), 'the licence text itself is not copied into the ledger');
  } finally {
    t.done();
  }
});

test('issue refuses bad input with a plain message and issues nothing', () => {
  const t = tool();
  try {
    run(['keygen', '--out', t.key], t.io);
    t.out.length = 0;
    const base = ['issue', '--key', t.key, '--product', 'rmm', '--customer', 'Acme', '--tier', 'standard', '--until', '2027-11-30'];
    const cases = [
      [['issue', '--key', join(t.dir, 'missing.pem'), '--product', 'rmm', '--customer', 'A', '--tier', 't', '--until', '2027-01-01'], /No signing key/],
      [[...base, '--limit', 'devices=lots'], /must look like name=number/],
      [[...base.slice(0, -1), '30/11/2027'], /Dates must look like/],
      [base.filter((_, i) => i !== 3 && i !== 4), /product is missing/], // leave out --product rmm
    ];
    for (const [args, message] of cases) {
      t.err.length = 0;
      assert.equal(run(args, t.io), 1);
      assert.match(t.err.join('\n'), message);
    }
    assert.equal(t.out.length, 0);
    assert.ok(!existsSync(join(t.dir, 'issued.jsonl')));
  } finally {
    t.done();
  }
});

test('issue accepts null for an unlimited limit', () => {
  const t = tool();
  try {
    run(['keygen', '--out', t.key], t.io);
    t.out.length = 0;
    assert.equal(run(['issue', '--key', t.key, '--product', 'rmm', '--customer', 'Big Co', '--tier', 'enterprise', '--limit', 'devices=null', '--until', '2027-11-30'], t.io), 0);
    assert.deepEqual(peek(t.out[0]).limits, { devices: null });
  } finally {
    t.done();
  }
});

test('inspect shows a licence, checks the signature when given the public key, and says what it allows', () => {
  const t = tool();
  try {
    const token = vectors.verify[0].token;
    assert.equal(run(['inspect', token, '--public-key', vectors.publicKey, '--use', 'devices=250', '--now', '2027-12-01'], t.io), 0);
    const text = t.out.join('\n');
    assert.match(text, /Signature: genuine/);
    assert.match(text, /grace/);
    assert.match(text, /"devices":false/);
    t.out.length = 0;
    assert.equal(run(['inspect', vectors.verify[3].token, '--public-key', vectors.publicKey], t.io), 2);
    assert.match(t.out.join('\n'), /NOT genuine \(bad_signature\)/);
    assert.equal(run(['inspect', 'rubbish'], t.io), 1);
  } finally {
    t.done();
  }
});

test('an unknown command prints usage and fails', () => {
  const t = tool();
  assert.equal(run(['frobnicate'], t.io), 1);
  assert.match(t.err.join('\n'), /Usage/);
  t.done();
});
