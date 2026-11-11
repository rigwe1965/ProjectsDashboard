// The AI guide's API client, tested without spending anything: first against a fake client, then the real SDK against a local server that
// speaks the API's streaming format, so the request the SDK really sends and the way it reads the answer are both checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGuideClient, classifyError, MESSAGES, MAX_HISTORY } from '../../demo-gateway/guide/client.mjs';

// A stand-in for the SDK client: records the request, plays back events, and gives the final message.
function fake({ events, final, throwAt, error }) {
  const calls = [];
  const client = { messages: { stream: (params, opts) => {
    calls.push({ params, opts });
    const iterable = { async *[Symbol.asyncIterator]() { let i = 0; for (const ev of events ?? []) { if (throwAt === i++) throw error; yield ev; } if (throwAt === i) throw error; }, finalMessage: async () => final };
    return iterable;
  } } };
  return { client, calls };
}
const textEv = (t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } });
const start = (usage) => ({ type: 'message_start', message: { usage } });
const ok = { stop_reason: 'end_turn', usage: { input_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 40 } };

test('an answer is streamed piece by piece, returned whole, and its usage read from the final message', async () => {
  const { client, calls } = fake({ events: [start({ input_tokens: 300 }), textEv('Open '), { type: 'content_block_start' }, textEv('Contacts.')], final: ok });
  const g = createGuideClient({ client });
  const pieces = [];
  const r = await g.ask({ system: 'RULES', history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], message: 'where are contacts?', onText: (t) => pieces.push(t) });
  assert.deepEqual(pieces, ['Open ', 'Contacts.']);
  assert.deepEqual(r, { outcome: 'ok', text: 'Open Contacts.', usage: { input_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 40 } });
  const p = calls[0].params;
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.max_tokens, 1500);
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.deepEqual(p.system, [{ type: 'text', text: 'RULES', cache_control: { type: 'ephemeral' } }], 'the rules and guide are cached');
  assert.deepEqual(p.messages.map((m) => m.role + ':' + m.content), ['user:hi', 'assistant:hello', 'user:where are contacts?']);
  for (const banned of ['tools', 'tool_choice', 'temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(banned in p), `no ${banned}: no tools, no web, no settings Haiku 5.5 rejects`);
});

test('without a key (and no injected client) the guide is off and nothing is called; bad input is refused before any call', async () => {
  for (const key of [undefined, '', '   ']) { const g = createGuideClient({ apiKey: key }); assert.equal(g.available, false); assert.deepEqual(await g.ask({ system: 's', message: 'hi' }), { outcome: 'off', text: '', usage: null }); }
  const { client, calls } = fake({ events: [], final: ok });
  const g = createGuideClient({ client });
  for (const message of ['', '   ', undefined, 5, 'x'.repeat(2001)]) assert.equal((await g.ask({ system: 's', message })).outcome, 'bad-input');
  assert.equal((await g.ask({ system: '', message: 'hi' })).outcome, 'bad-input');
  assert.equal(calls.length, 0);
});

test('history is tidied: the first message is the customer\'s, roles alternate, odd entries and a trailing customer message are dropped, only the last 20 are kept', async () => {
  const { client, calls } = fake({ events: [textEv('a')], final: ok });
  const g = createGuideClient({ client });
  await g.ask({ system: 's', message: 'new', history: [{ role: 'assistant', content: 'stray' }, { role: 'user', content: 'q1' }, { role: 'user', content: 'q1b' }, { role: 'assistant', content: 'a1' },
    null, { role: 'system', content: 'sneaky' }, { role: 'assistant', content: '   ' }, { role: 'user', content: 5 }, { role: 'user', content: 'dangling' }] });
  assert.deepEqual(calls[0].params.messages.map((m) => m.role + ':' + m.content), ['user:q1b', 'assistant:a1', 'user:new']);
  const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
  await g.ask({ system: 's', message: 'new', history: long });
  assert.ok(calls[1].params.messages.length <= MAX_HISTORY + 1);
  assert.equal(calls[1].params.messages[0].role, 'user');
  await g.ask({ system: 's', message: 'new', history: 'not a list' });
  assert.deepEqual(calls[2].params.messages, [{ role: 'user', content: 'new' }]);
});

test('a refusal, a cut-off answer and an empty answer are each reported as such, with their usage', async () => {
  let g = createGuideClient({ client: fake({ events: [textEv('I')], final: { ...ok, stop_reason: 'refusal', stop_details: { category: 'cyber' } } }).client });
  assert.deepEqual((await g.ask({ system: 's', message: 'hi' })).outcome, 'refused');
  g = createGuideClient({ client: fake({ events: [textEv('Long answ')], final: { ...ok, stop_reason: 'max_tokens' } }).client });
  assert.equal((await g.ask({ system: 's', message: 'hi' })).outcome, 'truncated');
  g = createGuideClient({ client: fake({ events: [], final: { ...ok, stop_reason: 'max_tokens' } }).client }); // thinking used the whole budget
  const r = await g.ask({ system: 's', message: 'hi' });
  assert.equal(r.outcome, 'empty'); assert.equal(r.usage.output_tokens, 40, 'it still cost something, and is counted');
  g = createGuideClient({ client: fake({ events: [], final: ok }).client });
  assert.equal((await g.ask({ system: 's', message: 'hi' })).outcome, 'empty');
  for (const k of ['off', 'rate', 'down', 'refused', 'truncated', 'empty']) assert.ok(MESSAGES[k].length > 20 && !/api|key|token|anthropic|claude/i.test(MESSAGES[k]), `${k}: a plain sentence with no technical detail`);
});

test('API failures become fixed outcomes; the API\'s own message is never returned; a call that breaks half way is still counted', async () => {
  const cases = [[401, 'auth'], [403, 'auth'], [429, 'rate'], [529, 'rate'], [400, 'bad-request'], [500, 'down'], [503, 'down'], [undefined, 'down']];
  for (const [status, want] of cases) {
    const err = Object.assign(new Error('secret detail: system prompt says X'), { status });
    const r = await createGuideClient({ client: fake({ events: [], throwAt: 0, error: err }).client }).ask({ system: 's', message: 'hi' });
    assert.equal(r.outcome, want, String(status)); assert.equal(r.usage, null); assert.ok(!JSON.stringify(r).includes('secret detail'));
  }
  const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const r = await createGuideClient({ client: fake({ events: [start({ input_tokens: 300, cache_read_input_tokens: 4000 }), textEv('Partial'), { type: 'message_delta', usage: { output_tokens: 12 } }], throwAt: 3, error: err }).client }).ask({ system: 's', message: 'hi' });
  assert.equal(r.outcome, 'down'); assert.equal(r.text, 'Partial');
  assert.deepEqual(r.usage, { input_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 12 });
  const ctl = new AbortController(); ctl.abort();
  assert.equal(classifyError(new Error('x'), ctl.signal), 'aborted');
  assert.equal(classifyError({ name: 'APIUserAbortError' }), 'aborted');
});

// ---- the real SDK, against a local server that answers in the API's streaming format ----
function sse(res, events) { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); res.end(); }
const wire = (text, stop = 'end_turn') => [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 250, cache_read_input_tokens: 3900, cache_creation_input_tokens: 0, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...text.map((t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 33 } },
  { type: 'message_stop' },
];

async function withServer(handler, fn) {
  const seen = [];
  const server = http.createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null }); handler(req, res, seen.length); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`, seen); } finally { await new Promise((r) => server.close(r)); }
}

test('the real SDK sends the request we mean to send and reads a streamed answer and its usage', async () => {
  await withServer((req, res) => sse(res, wire(['Open the ', 'Deals tab.'])), async (baseUrl, seen) => {
    const g = createGuideClient({ apiKey: 'sk-test-not-real', baseUrl, timeoutMs: 5000 });
    const pieces = [];
    const r = await g.ask({ system: 'RULES AND GUIDE', message: 'Where are deals?', onText: (t) => pieces.push(t) });
    assert.equal(r.outcome, 'ok'); assert.equal(r.text, 'Open the Deals tab.'); assert.deepEqual(pieces, ['Open the ', 'Deals tab.']);
    assert.deepEqual(r.usage, { input_tokens: 250, cache_read_input_tokens: 3900, cache_creation_input_tokens: 0, output_tokens: 33 });
    assert.equal(seen[0].url, '/v1/messages'); assert.equal(seen[0].headers.authorization, 'Bearer sk-test-not-real'); assert.ok(seen[0].headers['anthropic-version']);
    const b = seen[0].body;
    assert.equal(b.stream, true); assert.equal(b.model, 'claude-haiku-5-5'); assert.equal(b.max_tokens, 1500);
    assert.deepEqual(b.output_config, { effort: 'low' });
    assert.deepEqual(b.system, [{ type: 'text', text: 'RULES AND GUIDE', cache_control: { type: 'ephemeral' } }]);
    assert.deepEqual(b.messages, [{ role: 'user', content: 'Where are deals?' }]);
    assert.ok(!('tools' in b));
  });
});

test('the real SDK: a refused key is reported as auth without the server\'s words, and an overloaded API as rate', async () => {
  await withServer((req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key: sk-test-not-real' } })); }, async (baseUrl) => {
    const r = await createGuideClient({ apiKey: 'sk-test-not-real', baseUrl, timeoutMs: 5000 }).ask({ system: 's', message: 'hi' });
    assert.equal(r.outcome, 'auth'); assert.ok(!JSON.stringify(r).includes('sk-test'));
  });
  await withServer((req, res) => { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' }); res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })); }, async (baseUrl, seen) => {
    const r = await createGuideClient({ apiKey: 'k', baseUrl, timeoutMs: 5000 }).ask({ system: 's', message: 'hi' });
    assert.equal(r.outcome, 'rate'); assert.ok(seen.length <= 2, 'one retry at most');
  });
});

test('the real SDK: cancelling stops the call and is reported as aborted, not as an API failure', async () => {
  await withServer((req) => { req.on('close', () => {}); /* never answers */ }, async (baseUrl) => {
    const ctl = new AbortController();
    const pending = createGuideClient({ apiKey: 'k', baseUrl, timeoutMs: 5000 }).ask({ system: 's', message: 'hi', signal: ctl.signal });
    setTimeout(() => ctl.abort(), 50);
    assert.equal((await pending).outcome, 'aborted');
  });
});
