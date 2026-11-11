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

test('owner link: a new one replaces the owner\'s earlier link for that product, and only that one (audit F-08)', async () => {
  const { ownerLink, needsSharedInstance, OWNER } = await import('../../demo-gateway/owner-link.mjs');
  const other = await g.createGrant({ customer: 'Acme', app: product, hours: 1 });
  const first = await ownerLink(product);
  assert.equal(first.revoked.length, 0);
  const second = await ownerLink(product);
  assert.deepEqual(second.revoked, [first.grant.id], 'the earlier owner link is revoked, which frees its private seat');
  assert.equal(g.isActive(await g.findGrant(first.link.split('/d/')[1])), false);
  assert.equal(g.isActive(await g.findGrant(second.link.split('/d/')[1])), true);
  assert.equal(g.isActive(await g.findGrant(other.link.split('/d/')[1])), true, 'a customer\'s link is never touched');
  const owners = (await g.loadGrants()).filter((x) => x.app === product && x.customer === OWNER && g.isActive(x));
  assert.equal(owners.length, 1, 'never more than one live owner link per product');
  assert.equal(second.grant.customer, OWNER);
  // the launcher starts a shared instance only for products without private copies
  const apps = g.demoApps();
  for (const [id, a] of Object.entries(apps)) assert.equal(needsSharedInstance(id), !a.perLink, id);
  assert.equal(needsSharedInstance('no-such-product'), null);
  assert.ok(Object.values(apps).some((a) => a.perLink), 'the registry has private-copy products');
});

test('owner-link.mjs as a command: --shared exit codes, and a link line the launcher can pick up (audit F-08)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { minimalEnv } = await import('../../lib/clean-env.mjs');
  const run = (...a) => spawnSync(process.execPath, ['demo-gateway/owner-link.mjs', ...a], { encoding: 'utf8', timeout: 30000, env: { ...minimalEnv(process.env), DASHBOARD_DATA: dir } });
  const apps = g.demoApps();
  const shared = Object.keys(apps).find((k) => !apps[k].perLink), priv = Object.keys(apps).find((k) => apps[k].perLink);
  assert.equal(run('--shared', shared).status, 0);
  assert.equal(run('--shared', priv).status, 1);
  assert.equal(run('--shared', 'nope').status, 2);
  const r = run(product);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim().split('\n').at(-1), /^ {2}http\S+\/d\/[a-f0-9]{48}$/);
});
