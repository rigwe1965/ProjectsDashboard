// Grants write to DASHBOARD_DATA, so point it at a throwaway folder BEFORE importing the module.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pd-grants-'));
process.env.DASHBOARD_DATA = dir;
const g = await import('../../demo-gateway/grants.mjs');
const { getStore, closeStore } = await import('../../lib/store/index.mjs');
const product = Object.keys(g.demoApps())[0]; // any demo-ready product from the real registry
assert.ok(product, 'registry needs at least one demoReady product');
after(async () => { await closeStore(); rmSync(dir, { recursive: true, force: true }); });

test('create, find, expire and revoke a grant', async () => {
  const { grant, link } = await g.createGrant({ customer: '  Acme  ', app: product, hours: 1 });
  assert.equal(grant.customer, 'Acme');
  const token = link.split('/d/')[1];
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.equal(JSON.stringify(await g.loadGrants()).includes(token), false, 'token must be stored only as a hash');
  assert.equal(g.isActive(await g.findGrant(token)), true);
  await g.revokeGrant(grant.id);
  assert.equal(g.isActive(await g.findGrant(token)), false);
  assert.equal(g.publicGrant(await g.findGrant(token)).state, 'revoked');
});

test('creating and revoking a grant is recorded in the audit log', async () => {
  const store = await getStore();
  const evs = (await store.audit.list(50)).map((e) => e.ev);
  assert.ok(evs.includes('grant-created') && evs.includes('grant-revoked'));
});

test('rejects bad input', async () => {
  await assert.rejects(g.createGrant({ customer: '', app: product }), /required/);
  await assert.rejects(g.createGrant({ customer: 'X', app: 'no-such-app' }), /no demo-ready/);
  await assert.rejects(g.createGrant({ customer: 'X', app: product, hours: 0 }), /Hours/);
  await assert.rejects(g.createGrant({ customer: 'X', app: product, hours: g.MAX_HOURS + 1 }), /Hours/);
  await assert.rejects(g.revokeGrant('deadbeef'), /No such grant/);
});

test('an unknown token finds nothing', async () => assert.equal(await g.findGrant('0'.repeat(48)), null));
