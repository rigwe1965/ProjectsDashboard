// The public Security page says only what the software does: each item names the file behind it, and the numbers it quotes are checked against the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_HOURS } from '../../demo-gateway/grants.mjs';

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
