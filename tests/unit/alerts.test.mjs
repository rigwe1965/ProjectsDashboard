import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebhookSender, createAlerter, runChecks } from '../../lib/alerts.mjs';

const clock = () => { let t = 1_000_000; const now = () => t; now.add = (ms) => { t += ms; }; return now; };
const recorder = () => { const sent = []; const send = async (title, text) => { sent.push({ title, text }); return true; }; send.sent = sent; return send; };

test('alerter: one failed check says nothing; the second reports DOWN once; recovery reports BACK once', async () => {
  const send = recorder(), now = clock();
  const a = createAlerter({ send, failAfter: 2, now });
  assert.equal(await a.observe('crm/app', false), null);
  assert.equal(await a.observe('crm/app', false), 'down');
  assert.equal(await a.observe('crm/app', false), null, 'no second message while it stays down');
  now.add(5 * 60000);
  assert.equal(await a.observe('crm/app', true), 'back');
  assert.equal(await a.observe('crm/app', true), null);
  assert.equal(send.sent.length, 2);
  assert.match(send.sent[0].title, /crm\/app is DOWN/);
  assert.match(send.sent[1].text, /down for 5 min/);
});

test('alerter: a blip that recovers before failAfter sends nothing; a reminder comes after repeatMs', async () => {
  const send = recorder(), now = clock();
  const a = createAlerter({ send, failAfter: 2, repeatMs: 3600e3, now });
  await a.observe('x', false); await a.observe('x', true);
  assert.equal(send.sent.length, 0);
  await a.observe('x', false); await a.observe('x', false);
  now.add(1800e3); assert.equal(await a.observe('x', false), null);
  now.add(1800e3); assert.equal(await a.observe('x', false), 'reminder');
  assert.equal(send.sent.length, 2);
});

test('alerter: clear() forgets a thing without any message', async () => {
  const send = recorder();
  const a = createAlerter({ send, failAfter: 1 });
  await a.observe('x', false); a.clear('x');
  assert.equal(await a.observe('x', true), null);
  assert.equal(send.sent.length, 1, 'only the DOWN message; no BACK after a clear');
});

test('runChecks: a recorded process that stops answering is reported; one the owner stopped (no record) is not; the database is checked', async () => {
  const send = recorder();
  const a = createAlerter({ send, failAfter: 1 });
  const rows = [{ app: 'crm-demo', proc: 'app', up: false }, { app: 'airfinder-demo', proc: 'app', up: false }, { app: 'imageapp-demo', proc: 'app', up: true }];
  const records = { 'crm-demo': { app: { pid: 1 } }, 'imageapp-demo': { app: { pid: 2 } } };
  await runChecks({ alerter: a, status: async () => rows, records: async () => records, dbCheck: async () => {} });
  assert.deepEqual(send.sent.map((m) => m.title), ['ProjectsDashboard: crm-demo/app is DOWN']);
  await runChecks({ alerter: a, status: async () => rows, records: async () => ({}), dbCheck: async () => {} });
  assert.equal(send.sent.length, 1, 'once the owner stops it (record gone) there is no BACK message');
});

test('runChecks: a failing database and an unreadable status are reported', async () => {
  const send = recorder();
  const a = createAlerter({ send, failAfter: 1 });
  await runChecks({ alerter: a, status: async () => { throw new Error('boom'); }, records: async () => ({}), dbCheck: async () => { throw new Error('database is locked'); } });
  assert.deepEqual(send.sent.map((m) => m.title).sort(), ['ProjectsDashboard: database is DOWN', 'ProjectsDashboard: status check is DOWN']);
  assert.match(send.sent.find((m) => /database/.test(m.title)).text, /database is locked/);
});

test('webhook sender: format follows the service, https only, never throws', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true }; };
  assert.equal(await makeWebhookSender('https://ntfy.sh/my-topic', { fetchImpl })('T', 'body'), true);
  assert.equal(calls[0].init.body, 'body'); assert.equal(calls[0].init.headers.title, 'T');
  await makeWebhookSender('https://discord.com/api/webhooks/1/x', { fetchImpl })('T', 'body');
  assert.deepEqual(JSON.parse(calls[1].init.body), { content: '**T**\nbody' });
  await makeWebhookSender('https://hooks.slack.com/services/a/b/c', { fetchImpl })('T', 'body');
  assert.deepEqual(JSON.parse(calls[2].init.body), { text: '*T*\nbody' });
  assert.throws(() => makeWebhookSender('http://example.com/x'), /https/);
  assert.throws(() => makeWebhookSender('not a url'), /valid URL/);
  assert.doesNotThrow(() => makeWebhookSender('http://127.0.0.1:9/x'));
  assert.equal(await makeWebhookSender('https://ntfy.sh/t', { fetchImpl: async () => { throw new Error('offline'); } })('T', 'b'), false);
  assert.equal(await makeWebhookSender('https://ntfy.sh/t', { fetchImpl: async () => ({ ok: false }) })('T', 'b'), false);
  assert.equal(makeWebhookSender('https://ntfy.sh/secret-topic').host, 'ntfy.sh');
});

// a sender whose answers are scripted: true = delivered, false = the webhook could not be reached
const flaky = (answers) => { const sent = []; const send = async (title, text) => { sent.push({ title, text }); return answers.length ? answers.shift() : true; }; send.sent = sent; return send; };

test('alerter: a DOWN message that did not get through is tried again at the next check (audit F-07)', async () => {
  const send = flaky([false, false, true]);
  const a = createAlerter({ send, failAfter: 2, now: clock() });
  assert.equal(await a.observe('x', false), null);
  assert.equal(await a.observe('x', false), 'unsent');
  assert.equal(await a.observe('x', false), 'unsent', 'still not delivered: tried again, not silent for six hours');
  assert.equal(await a.observe('x', false), 'down');
  assert.equal(await a.observe('x', false), null, 'delivered once, so quiet again');
  assert.equal(send.sent.length, 3);
});

test('alerter: a reminder that did not get through is tried again at the next check (audit F-07)', async () => {
  const now = clock(), send = flaky([true, false, true]);
  const a = createAlerter({ send, failAfter: 1, repeatMs: 3600e3, now });
  assert.equal(await a.observe('x', false), 'down');
  now.add(3600e3);
  assert.equal(await a.observe('x', false), 'unsent');
  assert.equal(await a.observe('x', false), 'reminder');
  assert.equal(await a.observe('x', false), null);
});

test('alerter: a BACK message that did not get through is kept and tried again while the thing stays up (audit F-07)', async () => {
  const now = clock(), send = flaky([true, false, false, true]);
  const a = createAlerter({ send, failAfter: 1, now });
  await a.observe('x', false); now.add(300e3);
  assert.equal(await a.observe('x', true), 'unsent');
  assert.equal(await a.observe('x', true), 'unsent');
  assert.equal(await a.observe('x', true), 'back');
  assert.equal(await a.observe('x', true), null, 'delivered, record gone');
  assert.match(send.sent.at(-1).text, /down for 5 min/, 'the message still says how long it was down');
  assert.equal(send.sent.length, 4);
});

test('alerter: if it goes down again before BACK was delivered, the failure is reported at once, not after another grace period (audit F-07)', async () => {
  const send = flaky([true, false]);
  const a = createAlerter({ send, failAfter: 2, now: clock() });
  await a.observe('x', false); await a.observe('x', false); // DOWN delivered
  assert.equal(await a.observe('x', true), 'unsent');       // BACK lost
  assert.equal(await a.observe('x', false), null, 'one failed check is still not reported');
  assert.equal(await a.observe('x', true), 'back', 'the held BACK goes out when the thing is up again');
});
