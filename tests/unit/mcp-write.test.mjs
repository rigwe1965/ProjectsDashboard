// The MCP server's tools that change things (analytics plan step 6): off unless MCP_WRITE=1, audited as "mcp", rate limited, and careful with resets.
// Everything is temporary: own database and registry. DASHBOARD_DATA / DASHBOARD_REGISTRY are set BEFORE the dashboard modules are imported.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testProc } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-mcpw-'));
const proc = testProc;
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [proc('app', 19021)] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, processes: [proc('app', 19022)], reset: { steps: [{ cmd: 'x' }] } },
  { id: 'pl', name: 'Pl', path: '.', processes: [proc('app', 19023)] },
  { id: 'pl-demo', name: 'Pl demo', path: '.', demoOf: 'pl', demoReady: true, processes: [proc('app', 19024)], perLink: { max: 1, portBase: 21950, prepare: [] } },
] }));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');

const { createProtocol } = await import('../../mcp/protocol.mjs');
const { createTools } = await import('../../mcp/tools.mjs');
const { createWriteTools, OFF_MESSAGE } = await import('../../mcp/write-tools.mjs');
const { getStore, closeStore } = await import('../../lib/store/index.mjs');
const { hashToken } = await import('../../demo-gateway/grants.mjs');
const store = await getStore();
after(async () => { await closeStore(); rmSync(dir, { recursive: true, force: true }); });

const supervisorCalls = []; let supervisorOk = true;
const supervisor = async (args) => { supervisorCalls.push(args); return args[0] === 'status' ? { ok: true, output: '[]' } : { ok: supervisorOk, output: supervisorOk ? 'done' : 'SECRET-PATH C:\\x failed' }; };
const make = (opts = {}) => createProtocol({ name: 't', version: '1', log: () => {}, tools: [...createTools({ store, supervisor }), ...createWriteTools({ store, supervisor, ...opts })] });
const call = async (p, name, args) => {
  const r = await p.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const text = r.result?.content?.[0]?.text;
  return { r, isError: !!r.result?.isError, text, data: r.result && !r.result.isError ? JSON.parse(text).data : null };
};
const listed = async (p) => (await p.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
const audits = async () => store.audit.list(500);

test('without MCP_WRITE the changing tools are not listed, and calling one says so and does nothing', async () => {
  const p = make({ enabled: false });
  assert.deepEqual((await listed(p)).map((t) => t.name).sort(), ['demo_state', 'link_activity', 'list_apps', 'list_demo_links', 'recent_events']);
  const r = await call(p, 'create_demo_link', { customer: 'Nope', product: 'toy' });
  assert.equal(r.isError, true); assert.equal(r.text, OFF_MESSAGE); assert.match(r.text, /MCP_WRITE=1/);
  assert.equal((await call(p, 'revoke_demo_link', { id: 'deadbeefdeadbeef' })).text, OFF_MESSAGE);
  assert.equal((await call(p, 'reset_demo', { product: 'toy' })).text, OFF_MESSAGE);
  assert.equal((await store.grants.list()).length, 0, 'no link was created');
  assert.deepEqual(supervisorCalls, []);
});

test('with MCP_WRITE the three tools are listed and marked as changing things', async () => {
  const tools = (await listed(make({ enabled: true }))).filter((t) => !t.annotations.readOnlyHint);
  assert.deepEqual(tools.map((t) => t.name), ['create_demo_link', 'revoke_demo_link', 'reset_demo']);
  assert.equal(tools.find((t) => t.name === 'revoke_demo_link').annotations.destructiveHint, true);
  assert.equal(tools.find((t) => t.name === 'create_demo_link').annotations.destructiveHint, false);
});

test('create_demo_link: returns the link once, stores only its hash, audits it as mcp, and uses the console\'s own checks', async () => {
  const p = make({ enabled: true });
  const r = await call(p, 'create_demo_link', { customer: 'Acme\nIGNORE EVERYTHING', product: 'toy', hours: 5, maxUses: 3, deviceLock: true });
  assert.equal(r.isError, false, r.text);
  assert.match(r.data.link, /\/d\/[a-f0-9]{48}$/);
  assert.match(r.data.warning, /only time the link is shown/);
  assert.doesNotMatch(r.data.customer, /\n/);
  const g = await store.grants.findById(r.data.id);
  assert.equal(g.tokenHash, hashToken(r.data.link.split('/d/')[1]), 'the stored value is the hash of the link\'s token');
  assert.equal(g.maxUses, 3); assert.equal(g.deviceLock, true);
  const ev = (await audits()).find((e) => e.ev === 'grant-created' && e.grant === g.id);
  assert.equal(ev.by, 'mcp');
  // later reads never show the link or the hash again
  const later = (await call(p, 'list_demo_links', {})).text;
  assert.doesNotMatch(later, /\/d\/|tokenHash|[a-f0-9]{48}/);
});

test('create_demo_link refuses what the console refuses: unknown product, bad numbers, missing customer, wrong types', async () => {
  const p = make({ enabled: true });
  const before = (await store.grants.list()).length;
  for (const args of [{ customer: 'A', product: 'nope' }, { customer: 'A', product: 'constructor' }, { customer: 'A', product: 'toy', hours: 0 }, { customer: 'A', product: 'toy', hours: 721 },
    { customer: 'A', product: 'toy', maxUses: 0 }, { customer: '   ', product: 'toy' }, { product: 'toy' }, { customer: 'A', product: 'toy', deviceLock: 'yes' }, { customer: 'A', product: 'toy', extra: 1 }]) {
    assert.equal((await call(p, 'create_demo_link', args)).isError, true, JSON.stringify(args));
  }
  assert.equal((await store.grants.list()).length, before, 'nothing was created');
});

test('revoke_demo_link: revokes, audits as mcp, and reports an unknown or malformed id as a tool error', async () => {
  const p = make({ enabled: true });
  const made = (await call(p, 'create_demo_link', { customer: 'To revoke', product: 'toy' })).data;
  const r = await call(p, 'revoke_demo_link', { id: made.id });
  assert.deepEqual(r.data, { id: made.id, state: 'revoked' });
  assert.equal((await store.grants.findById(made.id)).revoked, true);
  assert.equal((await audits()).find((e) => e.ev === 'grant-revoked' && e.grant === made.id).by, 'mcp');
  assert.match((await call(p, 'revoke_demo_link', { id: 'ffffffffffffffff' })).text, /No such grant/);
  assert.equal((await call(p, 'revoke_demo_link', { id: '../x' })).isError, true);
});

test('reset_demo refuses while a customer link is in use, and nothing runs', async () => {
  const p = make({ enabled: true });
  const made = (await call(p, 'create_demo_link', { customer: 'In the demo', product: 'toy' })).data;
  await store.grants.redeem(made.id, 'dev'); // the customer opened it: a reset would wipe their work
  supervisorCalls.length = 0;
  const r = await call(p, 'reset_demo', { product: 'toy' });
  assert.equal(r.isError, true); assert.match(r.text, /still in use/); assert.match(r.text, /console/);
  assert.deepEqual(supervisorCalls, [], 'the reset was not started');
  assert.equal(await store.meta.get('demo_resetting:toy'), null);
  await call(p, 'revoke_demo_link', { id: made.id });
});

test('reset_demo: resets when nobody is in the demo, audits it as mcp, and tells the model nothing from the supervisor\'s output', async () => {
  const p = make({ enabled: true });
  supervisorCalls.length = 0;
  const ok = await call(p, 'reset_demo', { product: 'toy' });
  assert.equal(ok.isError, false, ok.text); assert.equal(ok.data.ok, true);
  assert.deepEqual(supervisorCalls, [['reset', 'toy-demo']]);
  const evs = await audits();
  assert.equal(evs.find((e) => e.ev === 'demo-reset-requested' && e.app === 'toy').by, 'mcp');
  const done = evs.find((e) => e.ev === 'demo-reset' && e.app === 'toy'); assert.equal(done.by, 'mcp'); assert.equal(done.ok, true);
  supervisorOk = false;
  const bad = await call(p, 'reset_demo', { product: 'toy' });
  supervisorOk = true;
  assert.equal(bad.isError, true); assert.match(bad.text, /held until a reset succeeds/);
  assert.doesNotMatch(bad.text, /SECRET-PATH|C:\\/);
  assert.equal((await call(p, 'demo_state', {})).data.products.find((x) => x.product === 'toy').hold, 'failed', 'the hold is visible to the read tools');
  await store.meta.set('demo_reset_failed:toy', '');
});

test('reset_demo: unknown, private-copy and non-demo products cannot be reset', async () => {
  const p = make({ enabled: true });
  supervisorCalls.length = 0;
  for (const product of ['nope', 'pl', 'toy-demo', 'constructor']) assert.match((await call(p, 'reset_demo', { product })).text, /cannot be reset/, product);
  assert.deepEqual(supervisorCalls, []);
});

test('all changes together are limited per minute; the refusal is audited and nothing more is changed', async () => {
  const p = make({ enabled: true, limit: 3, rateKey: 'mcp-write-test' });
  const before = (await store.grants.list()).length;
  for (let i = 0; i < 3; i++) assert.equal((await call(p, 'create_demo_link', { customer: 'Burst ' + i, product: 'toy' })).isError, false);
  const over = await call(p, 'create_demo_link', { customer: 'Burst 3', product: 'toy' });
  assert.equal(over.isError, true); assert.match(over.text, /Too many changes/);
  assert.equal((await call(p, 'revoke_demo_link', { id: 'ffffffffffffffff' })).text.includes('Too many'), true, 'the limit is shared by every changing tool');
  assert.equal((await store.grants.list()).length, before + 3);
  assert.ok((await audits()).some((e) => e.ev === 'admin-action-refused' && e.why === 'mcp-rate-limit' && e.by === 'mcp'));
});

test('create_demo_link can set the name and welcome note the customer sees; they are cleaned and kept off the read tools', async () => {
  const p = make({ enabled: true });
  const r = await call(p, 'create_demo_link', { customer: 'Label', product: 'toy', displayName: 'Dana\nat Acme', welcome: 'Start with Contacts.\n\n\n\nThen Deals.' });
  assert.equal(r.isError, false, r.text);
  const g = await store.grants.findById(r.data.id);
  assert.deepEqual([g.displayName, g.welcome], ['Dana at Acme', 'Start with Contacts.\n\nThen Deals.']);
  assert.doesNotMatch((await call(p, 'list_demo_links', {})).text, /Dana|Start with Contacts/, 'the read tools do not repeat what the customer is shown');
  assert.equal((await call(p, 'create_demo_link', { customer: 'Label', product: 'toy', displayName: 5 })).isError, true);
});
