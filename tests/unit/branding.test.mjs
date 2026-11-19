// Branded demo pages: the page where a customer opens their link shows their name, a welcome note, the time left and an optional "book a call" link.
// Everything is temporary: own database and registry. DASHBOARD_DATA / DASHBOARD_REGISTRY are set BEFORE the dashboard modules are imported.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpRequest, testProc } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-brand-'));
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [testProc('app', 19031)] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, processes: [testProc('app', 19032)] },
] }));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');

const { esc, timeLeft, parseBookingUrl, renderLanding, bookingNote } = await import('../../demo-gateway/pages.mjs');
const { createGateway } = await import('../../demo-gateway/gateway.mjs');
const grants = await import('../../demo-gateway/grants.mjs');
const { oneLine, noteText } = await import('../../lib/text.mjs');
const { closeStore } = await import('../../lib/store/index.mjs');

const gw = await createGateway({ port: 0, baseHost: 'localhost', brandName: 'Igwe Software', bookingUrl: 'https://cal.example.com/igwe/demo?x=1' });
const port = await gw.listen();
const plain = await createGateway({ port: 0, baseHost: 'localhost' });
const plainPort = await plain.listen();
after(async () => { await gw.close(); await plain.close(); await closeStore(); rmSync(dir, { recursive: true, force: true }); });
const get = (p, path) => httpRequest({ port: p, host: `toy.localhost:${p}`, path });

// ---- pure pieces
test('esc escapes everything that could break out of a page', () => {
  assert.equal(esc('<script>alert("x")</script>&\'`'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;`');
  assert.equal(esc(null), '');
});

test('timeLeft: hours, days, under an hour, and null once ended', () => {
  const now = Date.parse('2026-03-05T10:00:00Z'), at = (ms) => new Date(now + ms).toISOString();
  assert.equal(timeLeft(at(30 * 60e3), now), 'less than an hour');
  assert.equal(timeLeft(at(3600e3), now), 'about 1 hour');
  assert.equal(timeLeft(at(5.5 * 3600e3), now), 'about 5 hours');
  assert.equal(timeLeft(at(47 * 3600e3), now), 'about 47 hours');
  assert.equal(timeLeft(at(72 * 3600e3), now), 'about 3 days');
  assert.equal(timeLeft(at(-1), now), null);
  assert.equal(timeLeft('garbage', now), null);
});

test('parseBookingUrl accepts only a plain https address', () => {
  assert.equal(parseBookingUrl(' https://cal.example.com/a?b=1 '), 'https://cal.example.com/a?b=1');
  for (const bad of ['', undefined, 'http://cal.example.com', 'javascript:alert(1)', 'https://user:pw@cal.example.com', '//cal.example.com', 'not a url', 'https://' + 'a'.repeat(300) + '.com']) assert.equal(parseBookingUrl(bad), null, String(bad));
});

test('oneLine and noteText: control characters and line breaks are handled, length is capped', () => {
  assert.equal(oneLine('  Dana\n\tat   Acme\u0000  ', 80), 'Dana at Acme');
  assert.equal(oneLine('x'.repeat(200), 80).length, 80);
  assert.equal(noteText('Hello\r\n\r\n\r\n\r\nbye\u0007  \nend', 400), 'Hello\n\nbye\nend');
  assert.equal(noteText('y'.repeat(900), 400).length, 400);
  assert.equal(oneLine('a' + String.fromCharCode(0x2028) + 'b', 10), 'a b');
});

test('renderLanding: shows only what is set; the owner\'s own label for the link is never shown', () => {
  const g = { customer: 'INTERNAL LABEL hot lead', expiresAt: new Date(Date.now() + 5 * 3600e3).toISOString(), displayName: null, welcome: null };
  const bare = renderLanding({ productName: 'CRM demo', g, notice: '<b>notice</b>' });
  assert.match(bare, /Your demo of CRM</); assert.doesNotMatch(bare, /Prepared for|Book a call|border-left/);
  assert.doesNotMatch(bare, /INTERNAL LABEL/);
  assert.match(bare, /left\)/); assert.match(bare, /<b>notice<\/b>/); assert.match(bare, /method="post"/);
  const full = renderLanding({ productName: 'CRM demo', g: { ...g, displayName: 'Dana at Acme', welcome: 'Hi Dana,\nstart with Contacts.' }, notice: 'n', brand: 'Igwe Software', bookingUrl: 'https://cal.example.com/x' });
  assert.match(full, /Prepared for <strong>Dana at Acme<\/strong>/); assert.match(full, /Hi Dana,<br>start with Contacts\./);
  assert.match(full, /Igwe Software/); assert.match(full, /href="https:\/\/cal\.example\.com\/x" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(full, /INTERNAL LABEL/);
});

test('renderLanding: markup typed by the owner or an assistant cannot become markup', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const html = renderLanding({ productName: evil, g: { expiresAt: new Date(Date.now() + 36e5).toISOString(), displayName: evil, welcome: evil }, notice: 'n', brand: evil, bookingUrl: 'https://a.example/"><script>x</script>' });
  assert.doesNotMatch(html, /<script|<img|onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /"><script/);
});

// ---- creating a link
test('a link keeps a cleaned name and note; empty ones are stored as none', async () => {
  const { grant } = await grants.createGrant({ customer: 'Label', app: 'toy', displayName: '  Dana\nat Acme ', welcome: 'Line one\r\n\r\n\r\n\r\nLine two' });
  assert.equal(grant.displayName, 'Dana at Acme'); assert.equal(grant.welcome, 'Line one\n\nLine two');
  const none = (await grants.createGrant({ customer: 'Label 2', app: 'toy', displayName: '   ', welcome: '' })).grant;
  assert.deepEqual([none.displayName, none.welcome], [null, null]);
  const long = (await grants.createGrant({ customer: 'Label 3', app: 'toy', welcome: 'z'.repeat(1000) })).grant;
  assert.equal(long.welcome.length, 400);
  assert.deepEqual([grants.publicGrant(grant).displayName, grants.publicGrant(grant).welcome], ['Dana at Acme', 'Line one\n\nLine two']);
});

// ---- the page, served by the real gateway
test('opening a branded link shows the name, the note, the time left and the booking link, and never the owner\'s label', async () => {
  const { link } = await grants.createGrant({ customer: 'SECRET INTERNAL LABEL', app: 'toy', hours: 72, displayName: 'Dana at Acme', welcome: 'Try <b>Contacts</b> first.' });
  const r = await get(port, '/d/' + link.split('/d/')[1]);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/); assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.body, /Your demo of Toy</);
  assert.match(r.body, /Prepared for <strong>Dana at Acme<\/strong>/);
  assert.match(r.body, /Try &lt;b&gt;Contacts&lt;\/b&gt; first\./);
  assert.match(r.body, /about 3 days left|about 72 hours left|about 71 hours left/);
  assert.match(r.body, /Igwe Software/);
  assert.match(r.body, /href="https:\/\/cal\.example\.com\/igwe\/demo\?x=1"/);
  assert.doesNotMatch(r.body, /SECRET INTERNAL LABEL/);
  assert.match(r.body, /method="post"/); assert.match(r.body, /address and browser type are noted/, 'the recording notice is still there');
  assert.equal((await grants.findGrant(link.split('/d/')[1])).uses, 0, 'a GET still never spends a use');
});

test('a plain link on a gateway without a brand or booking address shows neither', async () => {
  const { link } = await grants.createGrant({ customer: 'Plain', app: 'toy' });
  const r = await get(plainPort, '/d/' + link.split('/d/')[1]);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body, /Prepared for|Book a call|Igwe Software/);
  assert.match(r.body, /Your demo of Toy</);
});

test('a revoked link still gets the plain refusal page, not the branded one', async () => {
  const { grant, link } = await grants.createGrant({ customer: 'Gone', app: 'toy', displayName: 'Should not show' });
  await grants.revokeGrant(grant.id);
  const r = await get(port, '/d/' + link.split('/d/')[1]);
  assert.equal(r.status, 403); assert.doesNotMatch(r.body, /Should not show|Prepared for/);
});

test('a bad DEMO_BOOKING_URL is ignored instead of being put on the page', async () => {
  const bad = await createGateway({ port: 0, baseHost: 'localhost', bookingUrl: 'javascript:alert(1)' });
  const p = await bad.listen();
  try {
    const { link } = await grants.createGrant({ customer: 'B', app: 'toy' });
    const r = await get(p, '/d/' + link.split('/d/')[1]);
    assert.equal(r.status, 200); assert.doesNotMatch(r.body, /javascript:|Book a call/);
  } finally { await bad.close(); }
});

test('bookingNote: a "book a call" sentence with the address escaped, or nothing at all without one', () => {
  assert.equal(bookingNote(null), '');
  assert.equal(bookingNote(''), '');
  const note = bookingNote('https://cal.example.com/a?x=1&y="2"');
  assert.match(note, /href="https:\/\/cal\.example\.com\/a\?x=1&amp;y=&quot;2&quot;" target="_blank" rel="noopener noreferrer">book a call<\/a>/);
});

test('an expired or revoked link offers the booking page when one is set, and nothing extra when it is not', async () => {
  const { grant, link } = await grants.createGrant({ customer: 'Ended', app: 'toy' });
  await grants.revokeGrant(grant.id);
  const token = link.split('/d/')[1];
  const withBooking = await get(port, '/d/' + token);
  assert.equal(withBooking.status, 403);
  assert.match(withBooking.body, /Link not valid/);
  assert.match(withBooking.body, /href="https:\/\/cal\.example\.com\/igwe\/demo\?x=1" target="_blank" rel="noopener noreferrer">book a call<\/a>/);
  const without = await get(plainPort, '/d/' + token);
  assert.equal(without.status, 403);
  assert.match(without.body, /Link not valid/);
  assert.doesNotMatch(without.body, /book a call|cal\.example\.com/i, 'no booking address configured: the page is unchanged');
});
