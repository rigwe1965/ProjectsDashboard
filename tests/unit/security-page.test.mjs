// The public Security page says only what the software does: each item names the file behind it, and the numbers it quotes are checked against the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_HOURS } from '../../demo-gateway/grants.mjs';
import { MAX_MESSAGE_CHARS } from '../../demo-gateway/guide/routes.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const sec = JSON.parse(read('showcase/security.json'));
const items = sec.sections.flatMap((s) => s.items);
const textOf = (label) => items.find((i) => i.label.startsWith(label)).text;

test('every item has a label, a plain sentence or two, and a source file that exists', () => {
  assert.ok(sec.sections.length >= 5);
  for (const i of items) {
    assert.ok(i.label && i.text, 'label and text: ' + JSON.stringify(i));
    assert.ok(i.text.length >= 40 && i.text.length <= 420, 'a short, readable text: ' + i.label);
    assert.ok(existsSync(root + i.source), `${i.label}: source file ${i.source} exists`);
  }
  assert.match(sec.updated, /^\d{4}-\d\d-\d\d$/);
});

test('nothing on the page promises more than anyone can back up', () => {
  const all = JSON.stringify(sec.sections).toLowerCase();
  for (const word of ['guarantee', '100%', 'unhackable', 'military', 'bank-grade', 'never be', 'impossible', 'fully secure', 'iso 27001 certified', 'soc 2 certified', 'compliant']) assert.ok(!all.includes(word), `"${word}" is not used`);
  assert.match(sec.notYet.text, /not had an independent penetration test/);
  assert.match(sec.notYet.text, /no formal certification/);
  assert.match(sec.notYet.text, /guide can also be wrong/, 'the page admits the AI can be wrong');
});

test('the numbers the page quotes match the code', () => {
  assert.match(textOf('It expires'), /never longer than 30 days/);
  assert.equal(MAX_HOURS, 30 * 24, 'a link can last 30 days at most');
  assert.match(textOf('When you open'), /after 90 days/);
  assert.match(read('demo-gateway/server.mjs'), /AUDIT_RETENTION_DAYS, 90\)/, 'the audit log default is 90 days');
  assert.match(textOf('Owner-only'), /after 12 hours/);
  assert.match(read('admin-console/console.mjs'), /ADMIN_SESSION_HOURS, 12\)/, 'console sessions last 12 hours by default');
  assert.match(textOf('It expires'), /within seconds/);
  assert.match(read('demo-gateway/gateway.mjs'), /GATEWAY_WS_RECHECK_MS, 5000\)/, 'open connections are re-checked every 5 seconds');
  assert.match(textOf('It has limits'), /at most 500 characters/);
  assert.equal(MAX_MESSAGE_CHARS, 500, 'the guide accepts 500 characters a message');
  assert.match(textOf('We do not keep'), /after 2 hours without use/);
  assert.match(read('demo-gateway/guide/routes.mjs'), /IDLE_MS = 2 \* 3600e3/, 'a conversation is forgotten after 2 hours');
});

test('claims about behaviour are still true in the code they point to', () => {
  const redeem = read('demo-gateway/redeem.mjs'), pages = read('demo-gateway/pages.mjs'), grants = read('demo-gateway/grants.mjs'), activity = read('demo-gateway/activity.mjs');
  assert.match(redeem, /A GET never opens the demo or spends a use/, 'previews do not open the link');
  assert.match(grants, /tokenHash: hashToken\(token\)/, 'only a hash of the link token is stored');
  assert.doesNotMatch(grants, /token: token|\btoken,/, 'the token itself is not put in the stored grant');
  assert.match(redeem, /HttpOnly; SameSite=Lax/, 'the session cookie is HttpOnly');
  assert.match(pages, /frame-ancestors 'none'/, 'the gateway\'s own pages cannot be framed');
  assert.match(pages, /strict-transport-security/, 'HSTS over HTTPS');
  assert.match(pages, /address and browser type are noted/, 'customers are told what is recorded');
  assert.match(activity, /never the query string|query string/i, 'the query string is not kept');
  assert.match(grants, /maxUses/); assert.match(grants, /deviceLock/);
});

test('the AI guide claims are true in the code: no words stored or logged, no tools, plain-text answers, the customer is told', () => {
  assert.ok(sec.sections.some((s) => s.title === 'The AI demo guide'));
  const routes = read('demo-gateway/guide/routes.mjs'), client = read('demo-gateway/guide/client.mjs'), prompt = read('demo-gateway/guide/prompt.mjs'), js = read('demo-gateway/guide/guide.js');
  const redeem = read('demo-gateway/redeem.mjs'), pages = read('demo-gateway/pages.mjs');
  // "not saved in our database or our logs": the words are never given to the store, the audit log or the logger.
  assert.doesNotMatch(routes, /store\.audit|audit\(/, 'the guide writes nothing to the audit log');
  assert.doesNotMatch(routes, /guideUsage\.add/, 'usage is recorded by the budget, as numbers');
  for (const [name, code] of [['routes', routes], ['client', client]]) {
    for (const call of code.match(/logger\.\w+\([^;]*;/g) ?? []) assert.doesNotMatch(call, /message|text|history|content|system/, `${name}: a log line carries no words: ${call}`);
  }
  assert.match(routes, /never written to disk or to the log/);
  for (const file of ['lib/store/sqlite.mjs', 'lib/store/postgres.mjs']) {
    const ddl = read(file).match(/CREATE TABLE IF NOT EXISTS guide_usage \(([\s\S]*?)\);/)[1];
    const columns = ddl.replace(/PRIMARY KEY \([^)]*\)/, '').split(',').map((c) => c.trim().split(/\s+/)[0]).filter((c) => c && c !== 'PRIMARY');
    assert.deepEqual(columns, ['grant_id', 'day', 'messages', 'input_tokens', 'cached_tokens', 'output_tokens', 'cost_micro'], file + ': the usage table has numbers only, no place for words');
  }
  // "cannot see or change anything": the API call has no tools, and the rules say so.
  assert.doesNotMatch(client, /tools\s*:|tool_choice/, 'no tools are sent to the model');
  assert.match(prompt, /You cannot click, change or run anything/); assert.match(prompt, /AI assistant, not a person/);
  // "shown as plain text": only textContent writes what the model says.
  assert.match(js, /textContent/); assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML/);
  // "you are told first": the opening page says it, and the page itself.
  assert.match(pages, /sent to Anthropic to get the answer/); assert.match(routes, /sent to Anthropic to get an answer/);
  assert.match(redeem, /guide: guideFor\(g, slug, target\)/, 'the opening page shows the guide only for a link that has one');
  assert.match(read('demo-gateway/gateway.mjs'), /guideOn: String\(process\.env\.DEMO_GUIDE/, 'it can be switched off for the whole service');
});
