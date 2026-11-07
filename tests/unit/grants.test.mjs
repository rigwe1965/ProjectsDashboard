// Grants write to DASHBOARD_DATA, so point it at a throwaway folder BEFORE importing the module.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pd-grants-'));
process.env.DASHBOARD_DATA = dir;
const g = await import('../../demo-gateway/grants.mjs');
const product = Object.keys(g.demoApps())[0]; // any demo-ready product from the real registry

before(() => assert.ok(product, 'registry needs at least one demoReady product'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('create, find, expire and revoke a grant', () => {
  const { grant, link } = g.createGrant({ customer: '  Acme  ', app: product, hours: 1 });
  assert.equal(grant.customer, 'Acme');
  const token = link.split('/d/')[1];
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.equal(JSON.stringify(g.loadGrants()).includes(token), false, 'token must be stored only as a hash');
  assert.equal(g.isActive(g.findGrant(token)), true);
  g.revokeGrant(grant.id);
  assert.equal(g.isActive(g.findGrant(token)), false);
  assert.equal(g.publicGrant(g.findGrant(token)).state, 'revoked');
});

test('rejects bad input', () => {
  assert.throws(() => g.createGrant({ customer: '', app: product }), /required/);
  assert.throws(() => g.createGrant({ customer: 'X', app: 'no-such-app' }), /no demo-ready/);
  assert.throws(() => g.createGrant({ customer: 'X', app: product, hours: 0 }), /Hours/);
  assert.throws(() => g.createGrant({ customer: 'X', app: product, hours: g.MAX_HOURS + 1 }), /Hours/);
  assert.throws(() => g.revokeGrant('deadbeef'), /No such grant/);
});

test('an unknown token finds nothing', () => assert.equal(g.findGrant('0'.repeat(48)), null));
