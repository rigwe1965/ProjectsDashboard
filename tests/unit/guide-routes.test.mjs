// The AI guide through a real gateway, with a fake in place of the Claude API (nothing is spent): who may use it, what the page is, the stream,
// the limits, what is stored (counts only) and what is not (the words).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { httpRequest, testProc } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-guide-routes-'));
const guides = join(dir, 'guides');
const GUIDE_TEXT = '# Toy guide\n' + 'Open the Toys tab to see every toy. Use the search box to find one by name. '.repeat(4);
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [testProc('app', 19041)] },
  { id: 'toy-demo', name: 'Toy (demo instance)', path: '.', demoOf: 'toy', demoReady: true, guide: true, demoAccounts: [{ label: 'Staff', user: 'staff@toy.test' }, { label: 'Owner', user: 'owner@toy.test', admin: true }], processes: [testProc('app', 19042)] },
  { id: 'nog', name: 'Nog', path: '.', processes: [testProc('app', 19043)] },
  { id: 'nog-demo', name: 'Nog demo', path: '.', demoOf: 'nog', demoReady: true, processes: [testProc('app', 19044)] },
  { id: 'dra', name: 'Dra', path: '.', processes: [testProc('app', 19045)] },
  { id: 'dra-demo', name: 'Dra demo', path: '.', demoOf: 'dra', demoReady: true, guide: true, processes: [testProc('app', 19046)] },
] }));
import { mkdirSync } from 'node:fs';
mkdirSync(guides);
writeFileSync(join(guides, 'toy.md'), GUIDE_TEXT);
writeFileSync(join(guides, 'dra.md'), GUIDE_TEXT + '\nTODO(owner): not checked yet');
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');

const { createGateway } = await import('../../demo-gateway/gateway.mjs');
const { createGuideClient } = await import('../../demo-gateway/guide/client.mjs');
const grants = await import('../../demo-gateway/grants.mjs');
const { closeStore, getStore } = await import('../../lib/store/index.mjs');
const store = await getStore();

// ---- a stand-in for the Claude API
const calls = [];
let behave = () => ({});
const textEv = (t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } });
const goodUsage = { input_tokens: 400, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 60 };
const fake = { messages: { stream: (params, opts) => {
  calls.push(params);
  const b = { events: [textEv('Open '), textEv('the Toys tab.')], final: { stop_reason: 'end_turn', usage: goodUsage }, ...behave(params, opts) };
  return { async *[Symbol.asyncIterator]() { if (b.beforeStart) throw b.error; yield { type: 'message_start', message: { usage: { input_tokens: 400, cache_read_input_tokens: 4000 } } }; for (const e of b.events) { if (typeof e === 'function') await e(opts); else yield e; } if (b.error) throw b.error; }, finalMessage: async () => b.final };
} } };
const reset = () => { calls.length = 0; behave = () => ({}); };

const mk = (extra = {}) => createGateway({ port: 0, baseHost: 'localhost', guidesDir: guides, guidePerMinute: 100, redeemPerMinute: 1000, brandName: 'Acme', bookingUrl: 'https://acme.example/book',
  guideClient: createGuideClient({ client: fake }), ...extra });
const gw = await mk(); const port = await gw.listen();
const tight = await mk({ guidePerMinute: 2 }); const tightPort = await tight.listen();
const broke = await mk({ guideDailyCapUsd: 0 }); const brokePort = await broke.listen();
const noKey = await createGateway({ port: 0, baseHost: 'localhost', guidesDir: guides, guideApiKey: '' });
const off = await mk({ guideOn: false });
after(async () => { for (const x of [gw, tight, broke, noKey, off]) await x.close(); await closeStore(); rmSync(dir, { recursive: true, force: true }); });

const host = (app, p) => `${app}.localhost:${p}`;
// A customer: a link with `guideMessages`, opened, and the cookie they get.
async function customer(app = 'toy', guideMessages = 5, p = port, extra = {}) {
  const { grant, link } = await grants.createGrant({ customer: 'C-' + Math.random().toString(36).slice(2, 7), app, guideMessages, ...extra });
  const r = await httpRequest({ port: p, host: host(app, p), path: '/d/' + link.split('/d/')[1], method: 'POST' });
  assert.equal(r.status, 302);
  return { grant, cookie: r.headers['set-cookie'][0].split(';')[0], p, app };
}
const chat = (c, message, { headers = {}, raw } = {}) => httpRequest({ port: c.p, host: host(c.app, c.p), path: '/_pd/guide/chat', method: 'POST',
  headers: { cookie: c.cookie, 'content-type': 'application/json', ...headers }, body: raw ?? JSON.stringify({ message }) });
const events = (r) => r.body.split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
const getPath = (c, path) => httpRequest({ port: c.p, host: host(c.app, c.p), path, headers: { cookie: c.cookie } });

test('the guide is on only with a key, and the kill switch turns it off', () => {
  assert.ok(gw.guide?.enabled);
  assert.equal(noKey.guide, null, 'no ANTHROPIC_API_KEY: no guide');
  assert.equal(off.guide, null, 'DEMO_GUIDE=off: no guide');
});

test('the page: the demo in a frame next to a chat panel, under a policy that allows only its own script and style', async () => {
  const c = await customer('toy', 7);
  const r = await getPath(c, '/_pd/guide');
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.headers['content-security-policy'], "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  assert.equal(r.headers['x-frame-options'], 'DENY'); assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.body, /<iframe class=demo src="\/"/); assert.match(r.body, /data-left="7"/); assert.match(r.body, /src="\/_pd\/guide\.js"/);
  assert.match(r.body, /AI assistant, not a person/); assert.match(r.body, /sent to Anthropic/); assert.match(r.body, /We do not store it/);
  assert.doesNotMatch(r.body, /<script(?![^>]*src=)|\son\w+=|style=/i, 'no inline script, handler or style');
  const js = await getPath(c, '/_pd/guide.js'), css = await getPath(c, '/_pd/guide.css');
  assert.equal(js.status, 200); assert.match(js.headers['content-type'], /javascript/); assert.match(js.body, /\/_pd\/guide\/chat/);
  assert.equal(css.status, 200); assert.match(css.headers['content-type'], /text\/css/);
  assert.doesNotMatch(js.body, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, 'the chat writes text with textContent only');
  assert.equal((await httpRequest({ port, host: host('toy', port), path: '/_pd/guide', method: 'POST', headers: { cookie: c.cookie } })).status, 405);
});

test('who gets a guide: a link with an allowance, on a product with the flag and a checked guide file; everyone else a plain 404', async () => {
  const none = await customer('toy', 0);
  for (const path of ['/_pd/guide', '/_pd/guide.js', '/_pd/guide.css']) assert.equal((await getPath(none, path)).status, 404, 'no allowance: ' + path);
  assert.equal((await chat(none, 'hi')).status, 404);
  const noflag = await customer('nog', 5);
  assert.equal((await getPath(noflag, '/_pd/guide')).status, 404, 'the product has no guide flag');
  const draft = await customer('dra', 5);
  assert.equal((await getPath(draft, '/_pd/guide')).status, 404, 'the guide file is still a draft');
  assert.equal((await chat(draft, 'hi')).status, 404);
  assert.equal((await httpRequest({ port, host: host('toy', port), path: '/_pd/guide' })).status, 401, 'no session');
  const gone = await customer('toy', 5);
  await grants.revokeGrant(gone.grant.id);
  assert.equal((await getPath(gone, '/_pd/guide')).status, 403); assert.equal((await chat(gone, 'hi')).status, 403, 'a revoked link loses the guide at once');
  const wrong = await customer('toy', 5); // the toy cookie on another product's address
  assert.equal((await httpRequest({ port, host: host('nog', port), path: '/_pd/guide', headers: { cookie: wrong.cookie } })).status, 403);
});

test('a question gets a streamed answer, then a count of what is left; usage is stored as numbers', async () => {
  reset();
  const c = await customer('toy', 3);
  const r = await chat(c, 'Where are the toys?');
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/event-stream/); assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual(events(r), [{ t: 'text', d: 'Open ' }, { t: 'text', d: 'the Toys tab.' }, { t: 'done', left: 2 }]);
  const total = await store.guideUsage.totalForGrant(c.grant.id);
  assert.equal(total.messages, 1); assert.equal(total.inputTokens, 400); assert.equal(total.cachedTokens, 4000); assert.equal(total.outputTokens, 60);
  assert.equal(total.costMicro, 40 + 40 + 30); // $0.10 and $0.50 per million: 400 in, 4000 cached at a tenth, 60 out
  const system = calls[0].system[0].text;
  assert.match(system, /AI assistant, not a person/); assert.match(system, /Open the Toys tab/);
  assert.match(system, /Staff: staff@toy\.test/); assert.doesNotMatch(system, /owner@toy\.test/, 'the owner-only account is not offered');
  assert.match(system, /Acme \(booking link: https:\/\/acme\.example\/book\)/);
  assert.doesNotMatch(system, /Where are the toys/, 'the customer\'s words are the user message, never part of the rules');
  assert.match(system, /guide for Toy:/, 'the product is named without "(demo instance)"');
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'Where are the toys?' }]);
});

test('the conversation is remembered for the next question (this browser session only), and a different session starts fresh', async () => {
  reset();
  const c = await customer('toy', 5);
  await chat(c, 'first question');
  await chat(c, 'second question');
  assert.deepEqual(calls[1].messages.map((m) => m.role + ':' + m.content), ['user:first question', 'assistant:Open the Toys tab.', 'user:second question']);
  const same = await httpRequest({ port, host: host('toy', port), path: '/d/' + 'x'.repeat(48), method: 'POST' }); void same;
  // the same link opened again in another browser is a different session: it does not see the first one's questions
  const { link } = await grants.createGrant({ customer: 'Two browsers', app: 'toy', guideMessages: 5, hours: 5 });
  const open = async () => (await httpRequest({ port, host: host('toy', port), path: '/d/' + link.split('/d/')[1], method: 'POST' })).headers['set-cookie'][0].split(';')[0];
  const a = { p: port, app: 'toy', cookie: await open() }, b = { p: port, app: 'toy', cookie: await open() };
  await chat(a, 'only in browser a'); calls.length = 0;
  await chat(b, 'in browser b');
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'in browser b' }]);
});

test('the allowance: the last message is answered, the next is refused with a plain sentence and costs nothing; the API is not called', async () => {
  reset();
  const c = await customer('toy', 2);
  assert.deepEqual(events(await chat(c, 'one')).at(-1), { t: 'done', left: 1 });
  assert.deepEqual(events(await chat(c, 'two')).at(-1), { t: 'done', left: 0 });
  const refused = await chat(c, 'three');
  assert.equal(refused.status, 429); const body = JSON.parse(refused.body);
  assert.match(body.error, /used all 2 messages included with this link/); assert.equal(body.left, 0);
  assert.equal(calls.length, 2, 'no third call to the API');
  assert.equal((await store.guideUsage.totalForGrant(c.grant.id)).messages, 2);
});

test('at the same moment, two questions cannot both take the last message', async () => {
  reset();
  behave = () => ({ events: [async () => { await new Promise((r) => setTimeout(r, 80)); }, textEv('ok')] });
  const c = await customer('toy', 1);
  const [a, b] = await Promise.all([chat(c, 'a'), chat(c, 'b')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 429]);
  assert.equal(calls.length, 1);
});

test('a link can be asked only so many times a minute, and the gateway has a daily spending cap', async () => {
  reset();
  const c = await customer('toy', 50, tightPort);
  assert.equal((await chat(c, 'q1')).status, 200); assert.equal((await chat(c, 'q2')).status, 200);
  const slow = await chat(c, 'q3');
  assert.equal(slow.status, 429); assert.equal(slow.headers['retry-after'], '30'); assert.match(JSON.parse(slow.body).error, /busy/);
  const d = await customer('toy', 5, brokePort);
  const capped = await chat(d, 'hello');
  assert.equal(capped.status, 503); assert.ok(!/cap|spend|limit|\$/i.test(JSON.parse(capped.body).error), 'the reason is not explained to the customer');
  assert.equal((await store.guideUsage.totalForGrant(d.grant.id)).messages, 0);
});

test('bad requests are refused before anything is reserved or sent: type, origin, size, shape, method', async () => {
  reset();
  const c = await customer('toy', 5);
  assert.equal((await chat(c, 'x', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await chat(c, 'x', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415, 'a plain cross-site form cannot post here');
  assert.equal((await chat(c, 'x', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await chat(c, 'x', { headers: { origin: `http://${host('toy', port)}` } })).status, 200, 'the page\'s own origin is fine');
  assert.equal((await chat(c, '   ')).status, 400); assert.equal((await chat(c, undefined, { raw: '{}' })).status, 400);
  assert.equal((await chat(c, undefined, { raw: '[1]' })).status, 400); assert.equal((await chat(c, undefined, { raw: 'not json' })).status, 400);
  assert.equal((await chat(c, undefined, { raw: JSON.stringify({ message: 5 }) })).status, 400);
  const long = await chat(c, 'y'.repeat(501)); assert.equal(long.status, 400); assert.match(JSON.parse(long.body).error, /under 500/);
  assert.equal((await chat(c, 'y'.repeat(500))).status, 200, '500 is allowed');
  assert.equal((await chat(c, undefined, { raw: JSON.stringify({ message: 'a', pad: 'z'.repeat(5000) }) })).status, 413);
  assert.equal((await getPath(c, '/_pd/guide/chat')).status, 405);
  assert.equal((await store.guideUsage.totalForGrant(c.grant.id)).messages, 2, 'only the two answered questions were counted');
  assert.equal(calls.length, 2);
});

test('API trouble: the customer gets a plain sentence, no technical words, and a failed call costs them nothing', async () => {
  reset();
  const c = await customer('toy', 3);
  behave = () => ({ events: [], beforeStart: true, error: Object.assign(new Error('Bearer sk-secret and the system prompt'), { status: 401 }) }); // refused before any answer began
  const r = await chat(c, 'hello');
  assert.equal(r.status, 200);
  const ev = events(r);
  assert.deepEqual(ev.map((e) => e.t), ['error', 'done']);
  assert.match(ev[0].d, /could not answer just now/); assert.ok(!r.body.includes('sk-secret') && !/key|401|auth/i.test(r.body));
  assert.equal(ev[1].left, 3, 'the message was not used up');
  behave = () => ({ events: [], beforeStart: true, error: Object.assign(new Error('x'), { status: 529 }) });
  assert.match(events(await chat(c, 'again'))[0].d, /busy/);
  behave = () => ({ events: [textEv('I can')], final: { stop_reason: 'refusal', usage: goodUsage } });
  const refusal = events(await chat(c, 'again'));
  assert.deepEqual(refusal.map((e) => e.t), ['text', 'error', 'done']); assert.match(refusal[1].d, /cannot help with that/);
  assert.equal((await store.guideUsage.totalForGrant(c.grant.id)).messages, 1, 'only the call that produced usage counts');
  behave = () => ({ events: [textEv('A long ans')], final: { stop_reason: 'max_tokens', usage: goodUsage } });
  const cut = events(await chat(c, 'long'));
  assert.deepEqual(cut.map((e) => e.t), ['text', 'note', 'done']); assert.match(cut[1].d, /too long/);
});

test('a customer who closes the page mid-answer stops the call, and what was already generated is still counted', async () => {
  reset();
  const c = await customer('toy', 3);
  let sawAbort = false;
  behave = () => ({ events: [textEv('Starting'), (opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => { sawAbort = true; reject(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' })); });
    setTimeout(resolve, 3000).unref();
  })] });
  await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/_pd/guide/chat', headers: { host: host('toy', port), cookie: c.cookie, 'content-type': 'application/json' } }, (res) => {
      res.once('data', () => { req.destroy(); resolve(); }); // the first piece arrives, then the customer leaves
    });
    req.on('error', () => {}); req.write(JSON.stringify({ message: 'hello' })); req.end();
    setTimeout(() => reject(new Error('no answer started')), 3000).unref();
  });
  for (let i = 0; i < 40 && !sawAbort; i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(sawAbort, 'the call to the API was cancelled');
  for (let i = 0; i < 40 && (await store.guideUsage.totalForGrant(c.grant.id)).messages === 0; i++) await new Promise((r) => setTimeout(r, 25));
  const t = await store.guideUsage.totalForGrant(c.grant.id);
  assert.equal(t.messages, 1, 'the tokens already used are paid for, so they count'); assert.equal(t.inputTokens, 400);
  assert.equal(gw.guide.conversations() >= 0, true);
});

test('what customers type is never written to the database, and the page and the stream carry no HTML for the answer', async () => {
  reset();
  const marker = 'ZEBRA-MARKER-' + Math.random().toString(36).slice(2);
  behave = () => ({ events: [textEv('<img src=x onerror=alert(1)> reply ' + marker)] });
  const c = await customer('toy', 3);
  const r = await chat(c, 'my question has ' + marker);
  assert.match(r.body, /reply ZEBRA/);
  assert.match(r.headers['content-type'], /text\/event-stream/, 'the answer is data, not a page');
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk(dir).filter((p) => !p.endsWith('.json') && !p.endsWith('.md'))) assert.ok(!readFileSync(f).includes(marker), `${f} holds none of the words typed or answered`);
});

test('a link\'s guide allowance is a whole number from 0 to 200, stored with the link and shown to the owner', async () => {
  for (const bad of [-1, 201, 1.5, 'lots', NaN]) await assert.rejects(grants.createGrant({ customer: 'Bad', app: 'toy', guideMessages: bad }), /whole number from 0 to 200/, String(bad));
  for (const empty of [undefined, null, '', 0, '0']) assert.equal((await grants.createGrant({ customer: 'None', app: 'toy', guideMessages: empty })).grant.guideMessages, 0);
  const { grant } = await grants.createGrant({ customer: 'Some', app: 'toy', guideMessages: '25' });
  assert.equal(grant.guideMessages, 25); assert.equal((await store.grants.findById(grant.id)).guideMessages, 25);
  assert.equal(grants.publicGrant(grant).guideMessages, 25);
  assert.equal((await grants.createGrant({ customer: 'Max', app: 'toy', guideMessages: 200 })).grant.guideMessages, 200);
});
