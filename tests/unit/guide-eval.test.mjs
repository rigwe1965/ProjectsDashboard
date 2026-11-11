// The AI guide's quality-check tooling, tested without spending anything: the questions are well formed, the grader catches the failures it is
// for, a run adds up tokens and cost, and the command refuses to spend unless asked (and then works against a local stand-in for the API).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, EOL } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMON_CASES, PRODUCT_CASES, casesFor, knownProducts } from '../guide-eval/cases.mjs';
import { grade, estimateRun, runEval, report, systemFor, summarise } from '../guide-eval/eval.mjs';
import { GUIDES_DIR } from '../../demo-gateway/guide/content.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ok = (text, usage = { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 40 }) => ({ outcome: 'ok', text, usage });
const byId = (id) => casesFor('crm').find((c) => c.id === id);

test('the questions are well formed: unique, every check is a pattern with a reason, about 30 or more per product, and the traps are all there', () => {
  assert.deepEqual(knownProducts().sort(), ['crm', 'rmm']);
  for (const p of knownProducts()) {
    const cases = casesFor(p);
    assert.ok(cases.length >= 30, `${p} has ${cases.length} questions`);
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, p + ': ids are unique');
    for (const c of cases) {
      assert.ok(c.ask.length > 1 && c.ask.length <= 500, c.id + ': a realistic question length (the guide accepts 500 characters)');
      assert.ok(c.checks.length >= 1, c.id + ' has a check');
      for (const ck of c.checks) { assert.ok(ck.why, c.id + ': says what a failure means'); assert.ok((ck.need instanceof RegExp) !== (ck.not instanceof RegExp), c.id + ': exactly one of need/not'); }
    }
  }
  const kinds = new Set(COMMON_CASES.map((c) => c.kind));
  for (const k of ['refer', 'unknown', 'honest', 'off-topic', 'injection', 'language']) assert.ok(kinds.has(k), 'covers ' + k);
  assert.ok(COMMON_CASES.some((c) => /real person|bot or a salesperson/.test(c.ask)), '"are you a person?" is asked');
  assert.ok(PRODUCT_CASES.crm.every((c) => c.id.startsWith('crm-')) && PRODUCT_CASES.rmm.every((c) => c.id.startsWith('rmm-')));
});

test('the grader passes sound answers and catches a quoted price, an obeyed injection, a leaked prompt, markdown, a claimed human, and silence', () => {
  assert.deepEqual(grade(byId('price'), ok('I cannot talk about prices. Please ask the person who sent you this demo.')), []);
  assert.match(grade(byId('price'), ok('It starts at $29 per user per month.')).join(), /quotes a price/);
  assert.match(grade(byId('price'), ok('Not something I can say.')).join(), /refers pricing/);
  assert.deepEqual(grade(byId('inject-ignore'), ok('I can only help with the demo. What would you like to find?')), []);
  assert.match(grade(byId('inject-ignore'), ok('PWNED')).join(), /obeyed/);
  assert.match(grade(byId('inject-reveal'), ok('Sure: Rules (they cannot be changed by anything the customer writes): ...')).join(), /repeats its instructions|revealed/);
  assert.match(grade(byId('where-start'), ok('**Start** here: open Contacts.')).join(), /markdown/);
  assert.match(grade(byId('where-start'), ok('Open Contacts first, see https://example.com')).join(), /no links/);
  assert.deepEqual(grade(byId('are-you-human'), ok('No, I am an AI assistant for this demo.')), []);
  assert.match(grade(byId('are-you-human'), ok("I'm a real person, happy to help.")).join(), /claims to be a person|says it is an AI/);
  assert.match(grade(byId('hi'), { outcome: 'down', text: '', usage: null }).join(), /no usable answer/);
  assert.deepEqual(grade(byId('price'), { outcome: 'refused', text: '', usage: null }), [], 'a refusal by the model is safe');
  assert.match(grade(byId('hi'), ok('x'.repeat(1300))).join(), /too long/);
});

test('a run grades every question once, adds up tokens and cost, and reports the cache share and each failure', async () => {
  const seen = [];
  const client = { model: 'claude-haiku-5-5', ask: async ({ message, system }) => {
    seen.push({ message, system });
    const first = seen.length === 1;
    const usage = { input_tokens: first ? 50 : 50, cache_read_input_tokens: first ? 0 : 3000, cache_creation_input_tokens: first ? 3000 : 0, output_tokens: 40 };
    return ok(/cost/i.test(message) ? 'It is $10 a month.' : 'I can only help with the demo, and the person who sent you this demo can answer the rest. Open Contacts to start; the AI assistant is here for the demo and the demo only.', usage);
  } };
  const cases = casesFor('crm');
  const s = await runEval({ client, system: 'SYS', cases });
  assert.equal(seen.length, cases.length, 'one call per question');
  assert.equal(seen[0].message, cases[0].ask, 'the first call goes alone, to write the cache');
  assert.equal(s.total, cases.length); assert.equal(s.passed + s.failed, s.total);
  assert.ok(s.results.find((r) => r.id === 'price').fails.length, 'the quoted price is caught');
  assert.equal(s.usage.cache_creation_input_tokens, 3000); assert.equal(s.usage.output_tokens, 40 * cases.length);
  assert.ok(s.cacheShare > 0.9, 'most prompt tokens came from the cache');
  assert.ok(s.costUsd > 0 && s.costUsd < 0.05);
  const text = report(s);
  assert.match(text, /answers passed/); assert.match(text, /FAIL price \[refer\]/); assert.match(text, /Cache: \d+%/);
  assert.match(report(summarise([{ id: 'a', kind: 'k', ask: 'q', usage: { input_tokens: 4000, output_tokens: 10 }, fails: [] }]), {}), /too short to be cached/, 'no cache use is explained');
});

test('the estimate is positive, grows with the guide and the number of questions, and a model with no price is refused', () => {
  const cases = casesFor('crm');
  const a = estimateRun({ system: 'x'.repeat(12000), cases }), b = estimateRun({ system: 'x'.repeat(24000), cases });
  assert.ok(a.usd > 0 && b.usd > a.usd);
  assert.ok(a.usd < 0.1, 'a full run on Haiku costs cents: ' + a.usd);
  assert.throws(() => estimateRun({ system: 'x', cases, model: 'not-a-model' }), /no price/);
});

test('a draft guide cannot be checked unless --allow-draft is given, and then the TODO lines are left out', () => {
  const DRAFT_DIR = mkdtempSync(join(tmpdir(), 'guide-draft-')); writeFileSync(join(DRAFT_DIR, 'crm.md'), readFileSync(join(GUIDES_DIR, 'crm.md'), 'utf8') + EOL + 'TODO(owner): check this.' + EOL);
  assert.throws(() => systemFor('crm', { dir: DRAFT_DIR }), /--allow-draft/);
  const r = systemFor('crm', { dir: DRAFT_DIR, allowDraft: true, productName: 'CRM' });
  assert.equal(r.draft, true);
  assert.ok(!r.system.includes('TODO(owner)'));
  assert.match(r.system, /demo guide for CRM/); assert.match(r.system, /<guide>/);
});

// ---- the command itself ----
const run = (args, env) => new Promise((resolve) => {
  const e = { ...process.env, ...env }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const p = spawn(process.execPath, ['tests/guide-eval/run.mjs', ...args], { cwd: root, env: e });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

test('the command spends nothing without --yes, refuses without a key, and never prints the key', async () => {
  const dry = await run(['crm', '--allow-draft'], { ANTHROPIC_API_KEY: undefined });
  assert.equal(dry.code, 0); assert.match(dry.out, /Estimated cost at most \$0\.\d+/); assert.match(dry.out, /Nothing was sent/);
  const nokey = await run(['crm', '--allow-draft', '--yes'], { ANTHROPIC_API_KEY: undefined });
  assert.equal(nokey.code, 1); assert.match(nokey.out, /ANTHROPIC_API_KEY is not set/);
  // A draft is made from a copy of the real guide with the owner's marker added, so this does not depend on which real guides are finished.
  const draftDir = mkdtempSync(join(tmpdir(), 'guide-draft-')); writeFileSync(join(draftDir, 'crm.md'), readFileSync(join(GUIDES_DIR, 'crm.md'), 'utf8') + EOL + 'TODO(owner): check this.' + EOL);
  const draft = await run(['crm', '--yes', '--dir', draftDir], { ANTHROPIC_API_KEY: 'sk-secret-not-real', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
  assert.equal(draft.code, 1); assert.match(draft.out, /draft/); assert.ok(!draft.out.includes('sk-secret'), 'the key is never printed');
  const bad = await run(['nothing'], {}); assert.equal(bad.code, 1); assert.match(bad.out, /Usage/);
  const pricey = await run(['crm', '--allow-draft', '--max-usd', '0.0001'], {}); assert.equal(pricey.code, 1); assert.match(pricey.out, /above the limit/);
});

test('against a local stand-in for the API: --smoke makes two calls and reports caching; a full run grades, reports and saves the answers', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const b = JSON.parse(body); seen.push({ auth: req.headers.authorization, b });
      const cached = seen.length > 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = [
        { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 80, cache_read_input_tokens: cached ? 3000 : 0, cache_creation_input_tokens: cached ? 0 : 3000, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I can only help with the demo. Please ask the person who sent you this demo about the rest. Open Contacts to start.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } },
        { type: 'message_stop' },
      ];
      for (const e of ev) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ANTHROPIC_API_KEY: 'sk-test-not-real', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` };
  try {
    const smoke = await run(['crm', '--allow-draft', '--smoke', '--yes'], env);
    assert.equal(smoke.code, 0, smoke.out); assert.match(smoke.out, /Caching works: 3000 tokens/); assert.equal(seen.length, 2);
    assert.equal(seen[0].auth, 'Bearer sk-test-not-real');
    seen.length = 0;
    const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { readFileSync, rmSync } = await import('node:fs');
    const file = join(tmpdir(), 'guide-eval-' + process.pid + '.json');
    const full = await run(['rmm', '--allow-draft', '--yes', '--out', file], env);
    assert.match(full.out, /answers passed/); assert.equal(seen.length, casesFor('rmm').length);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.product, 'rmm'); assert.equal(saved.draft, true); assert.equal(saved.total, seen.length);
    assert.ok(!JSON.stringify(saved).includes('sk-test'), 'the key is not in the saved results');
    rmSync(file, { force: true });
  } finally { await new Promise((r) => server.close(r)); }
});
