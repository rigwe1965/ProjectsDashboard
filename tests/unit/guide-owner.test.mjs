// The owner's side of the AI guide: giving a link a guide in the console and through MCP (only for a product whose guide is ready), and seeing
// what each link used. Everything is temporary: own database, registry and guides folder (set BEFORE the dashboard modules are imported).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpRequest, testProc } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-gowner-'));
const proc = testProc;
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [proc('app', 19051)] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, guide: true, processes: [proc('app', 19052)] },
  { id: 'nog', name: 'Nog', path: '.', processes: [proc('app', 19053)] },
  { id: 'nog-demo', name: 'Nog demo', path: '.', demoOf: 'nog', demoReady: true, processes: [proc('app', 19054)] },
  { id: 'dra', name: 'Dra', path: '.', processes: [proc('app', 19055)] },
  { id: 'dra-demo', name: 'Dra demo', path: '.', demoOf: 'dra', demoReady: true, guide: true, processes: [proc('app', 19056)] },
  { id: 'mis', name: 'Mis', path: '.', processes: [proc('app', 19057)] },
  { id: 'mis-demo', name: 'Mis demo', path: '.', demoOf: 'mis', demoReady: true, guide: true, processes: [proc('app', 19058)] },
] }));
const guides = join(dir, 'guides'); mkdirSync(guides);
const TEXT = 'The Toys tab lists every toy. Use the search box to find one by name. '.repeat(5);
writeFileSync(join(guides, 'toy.md'), TEXT);
writeFileSync(join(guides, 'dra.md'), TEXT + '\nTODO(owner): check this');
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');
process.env.GUIDES_DIR = guides;

const { createConsole } = await import('../../admin-console/console.mjs');
const { createProtocol } = await import('../../mcp/protocol.mjs');
const { createTools } = await import('../../mcp/tools.mjs');
const { createWriteTools } = await import('../../mcp/write-tools.mjs');
const { guideProblem } = await import('../../demo-gateway/guide/content.mjs');
const { guideView } = await import('../../lib/engagement.mjs');
const { demoApps } = await import('../../lib/registry.mjs');
const { getStore, closeStore } = await import('../../lib/store/index.mjs');
const store = await getStore();
const c = await createConsole({ port: 0, supervisor: async () => ({ ok: true, output: '[]' }) });
const port = await c.listen();
after(async () => { await c.close(); await closeStore(); rmSync(dir, { recursive: true, force: true }); });

const login = await httpRequest({ port, path: '/?t=' + c.launchToken });
const cookie = (login.headers['set-cookie'][0] || '').split(';')[0];
const api = (path, obj) => httpRequest({ port, path, method: obj ? 'POST' : 'GET', body: obj ? JSON.stringify(obj) : undefined,
  headers: { cookie, ...(obj ? { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` } : {}) } });
const demos = async () => JSON.parse((await api('/api/demos')).body);

test('guideProblem says in a sentence why a product cannot have a guide, and is null when it can', () => {
  const apps = demoApps();
  assert.equal(guideProblem('toy', apps.toy), null);
  assert.match(guideProblem('nog', apps.nog), /no guide turned on/);
  assert.match(guideProblem('dra', apps.dra), /guides\/dra\.md is still a draft/);
  assert.match(guideProblem('mis', apps.mis), /guides\/mis\.md does not exist/);
  assert.match(guideProblem('zzz', undefined), /no guide turned on/);
});

test('guideView: allowance, used, left (never below 0) and the estimated cost in dollars', () => {
  assert.deepEqual(guideView({ guideMessages: 20 }, { messages: 3, costMicro: 12345 }), { allowed: 20, used: 3, left: 17, estimatedCostUsd: 0.0123 });
  assert.deepEqual(guideView({ guideMessages: 2 }, { messages: 5, costMicro: 0 }), { allowed: 2, used: 5, left: 0, estimatedCostUsd: 0 });
  assert.deepEqual(guideView({}, undefined), { allowed: 0, used: 0, left: 0, estimatedCostUsd: 0 });
});

test('console: the product list says which products have a ready guide and why not for the others', async () => {
  const d = await demos();
  const by = Object.fromEntries(d.products.map((p) => [p.product, p.guide]));
  assert.deepEqual(by.toy, { ready: true });
  assert.equal(by.nog.ready, false); assert.match(by.nog.why, /no guide turned on/);
  assert.match(by.dra.why, /still a draft/); assert.match(by.mis.why, /does not exist/);
});

test('console: a link gets a guide only for a product that has one; the others are refused with the reason, and nothing is created', async () => {
  const before = (await store.grants.list()).length;
  const ok = await api('/api/demos', { customer: 'With guide', app: 'toy', hours: 5, guideMessages: 20 });
  assert.equal(ok.status, 200);
  const made = JSON.parse(ok.body);
  assert.equal(made.grant.guideMessages, 20); assert.deepEqual(made.grant.guide, { allowed: 20, used: 0, left: 20, estimatedCostUsd: 0 });
  assert.equal((await store.grants.findById(made.grant.id)).guideMessages, 20);
  for (const [app, why] of [['nog', /no guide turned on/], ['dra', /still a draft/], ['mis', /does not exist/]]) {
    const r = await api('/api/demos', { customer: 'No guide ' + app, app, guideMessages: 5 });
    assert.equal(r.status, 400, app); assert.match(JSON.parse(r.body).error, why);
  }
  assert.equal((await store.grants.list()).length, before + 1, 'only the link that could have a guide was created');
  for (const app of ['nog', 'dra', 'mis']) assert.equal((await api('/api/demos', { customer: 'Plain ' + app, app, guideMessages: 0 })).status, 200, 'no guide asked for: any product works');
  assert.equal((await api('/api/demos', { customer: 'Absent', app: 'nog' })).status, 200);
  assert.match(JSON.parse((await api('/api/demos', { customer: 'Too many', app: 'toy', guideMessages: 201 })).body).error, /whole number from 0 to 200/);
  assert.match(JSON.parse((await api('/api/demos', { customer: 'Bad', app: 'toy', guideMessages: 'lots' })).body).error, /whole number|cannot have a guide|0 to 200/);
});

test('console: each link shows how much of its guide allowance was used and the estimated cost; forget removes it', async () => {
  const { grant } = JSON.parse((await api('/api/demos', { customer: 'Counted', app: 'toy', guideMessages: 10 })).body);
  await store.guideUsage.add(grant.id, '2026-03-05', { messages: 3, inputTokens: 1000, outputTokens: 100, costMicro: 12345 });
  await store.guideUsage.add(grant.id, '2026-03-06', { messages: 1, costMicro: 5 });
  const row = (await demos()).grants.find((g) => g.id === grant.id);
  assert.deepEqual(row.guide, { allowed: 10, used: 4, left: 6, estimatedCostUsd: 0.0124 }); // 12,350 millionths of a dollar, rounded to four places
  const none = (await demos()).grants.find((g) => g.customer === 'Plain nog');
  assert.deepEqual(none.guide, { allowed: 0, used: 0, left: 0, estimatedCostUsd: 0 });
  assert.equal((await api('/api/demos/' + grant.id + '/revoke', {})).status, 200);
  assert.equal((await api('/api/demos/' + grant.id + '/forget', {})).status, 200);
  assert.equal((await demos()).grants.find((g) => g.id === grant.id).guide.used, 0, 'forgotten: the counts are gone');
});

test('the console page has the guide field, disabled for a product with no ready guide, and shows the use in the list and details', async () => {
  const html = (await httpRequest({ port, path: '/', headers: { cookie } })).body;
  assert.match(html, /name: 'guideMessages'/); assert.match(html, /AI guide messages \(0 = no guide\)/);
  assert.match(html, /guideInput\.disabled = !ready/); assert.match(html, /b\.guideMessages = guideInput\.disabled \? 0/);
  assert.match(html, /'Guide ' \+ g\.guide\.used \+ '\/' \+ g\.guide\.allowed/); assert.match(html, /estimated cost about \$/);
});

// ---- through MCP
const supervisor = async (args) => ({ ok: true, output: args[0] === 'status' ? '[]' : 'done' });
const proto = createProtocol({ name: 't', version: '1', log: () => {}, tools: [...createTools({ store, supervisor }), ...createWriteTools({ store, supervisor, enabled: true })] });
const call = async (name, args) => {
  const r = await proto.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const text = r.result?.content?.[0]?.text;
  return { isError: !!r.result?.isError, text, data: r.result && !r.result.isError ? JSON.parse(text).data : null };
};

test('MCP: create_demo_link takes guideMessages for a ready product and refuses it for the others; the tool says so in its schema', async () => {
  const tools = (await proto.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  const schema = tools.find((t) => t.name === 'create_demo_link').inputSchema.properties.guideMessages;
  assert.equal(schema.maximum, 200); assert.match(schema.description, /demo_state/);
  const ok = await call('create_demo_link', { customer: 'Via MCP', product: 'toy', guideMessages: 15 });
  assert.equal(ok.isError, false); assert.equal(ok.data.guideMessages, 15);
  assert.equal((await store.grants.findById(ok.data.id)).guideMessages, 15);
  const bad = await call('create_demo_link', { customer: 'Via MCP no', product: 'dra', guideMessages: 5 });
  assert.equal(bad.isError, true); assert.match(bad.text, /still a draft/);
  assert.equal((await call('create_demo_link', { customer: 'Via MCP plain', product: 'dra' })).data.guideMessages, 0);
  assert.equal((await call('create_demo_link', { customer: 'Via MCP big', product: 'toy', guideMessages: 500 })).isError, true, 'the schema limit is enforced');
});

test('MCP: list_demo_links, link_activity and demo_state show the guide\'s use and whether a product\'s guide is ready', async () => {
  const made = await call('create_demo_link', { customer: 'MCP counted', product: 'toy', guideMessages: 8 });
  await store.guideUsage.add(made.data.id, '2026-03-05', { messages: 2, costMicro: 20000 });
  const list = await call('list_demo_links', { app: 'toy' });
  assert.deepEqual(list.data.links.find((l) => l.id === made.data.id).guide, { allowed: 8, used: 2, left: 6, estimatedCostUsd: 0.02 });
  assert.deepEqual((await call('link_activity', { id: made.data.id })).data.link.guide, { allowed: 8, used: 2, left: 6, estimatedCostUsd: 0.02 });
  const state = Object.fromEntries((await call('demo_state', {})).data.products.map((p) => [p.product, p.guide]));
  assert.deepEqual(state.toy, { ready: true }); assert.equal(state.nog.ready, false); assert.match(state.dra.why, /still a draft/);
  assert.ok(!/ANTHROPIC|sk-/.test(JSON.stringify(state)), 'no key or secret is ever shown');
});
