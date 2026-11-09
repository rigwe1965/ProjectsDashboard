// End-to-end gateway tests against a fake upstream. Everything is temporary: own registry, own database, random ports.
// DASHBOARD_DATA and DASHBOARD_REGISTRY must be set BEFORE the dashboard modules are imported.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const dir = mkdtempSync(join(tmpdir(), 'pd-gw-'));
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

// --- fake demo instance (main), second process (for demoRoutes), and a dead port
const seen = { wsHeaders: null };
const main = http.createServer((req, res) => {
  if (req.url === '/hang') return; // never answers
  if (req.url === '/setcookie') { res.setHeader('set-cookie', ['theme=dark; Path=/; Domain=.localhost', 'pd_demo=evil; Path=/', '__Host-pd_dev=evil; Path=/; Secure', 'plain=1; Path=/']); return res.end('ok'); }
  if (req.url === '/die') { res.writeHead(200, { 'content-length': '1000' }); res.write('partial'); setTimeout(() => res.socket.destroy(), 30); return; }
  if (req.url.startsWith('/slow-upload')) { let n = 0; req.on('data', (c) => { n += c.length; }); req.on('end', () => res.end(String(n))); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ url: req.url, host: req.headers.host, cookie: req.headers.cookie ?? null, xff: req.headers['x-forwarded-for'] ?? null, spoof: ['forwarded', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'x-client-ip'].filter((h) => h in req.headers) }));
});
const wss = new WebSocketServer({ server: main });
wss.on('connection', (ws, req) => { seen.wsHeaders = req.headers; ws.on('message', (m) => ws.send('echo:' + m)); });
const second = http.createServer((req, res) => res.end('second:' + req.url));
const third = http.createServer((req, res) => res.end('third:' + req.headers.host));
const mainPort = await listen(main), secondPort = await listen(second), thirdPort = await listen(third);
const deadPort = await new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const proc = (name, port) => ({ name, cmd: 'x', port });
const reg = { apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [proc('app', 19001)] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, processes: [proc('app', mainPort), proc('other', secondPort)], demoRoutes: [{ prefix: '/other', process: 'other' }] },
  { id: 'hosty', name: 'Hosty', path: '.', processes: [proc('app', 19003)] },
  { id: 'hosty-demo', name: 'Hosty demo', path: '.', demoOf: 'hosty', demoReady: true, processes: [{ ...proc('app', thirdPort), host: '127.0.0.1' }] },
  { id: 'nohost', name: 'Nohost', path: '.', processes: [proc('app', 19004)] },
  { id: 'nohost-demo', name: 'Nohost demo', path: '.', demoOf: 'nohost', demoReady: true, processes: [{ ...proc('app', 19005), host: 'no-such-host.invalid' }] },
  { id: 'dead', name: 'Dead', path: '.', processes: [proc('app', 19002)] },
  { id: 'dead-demo', name: 'Dead demo', path: '.', demoOf: 'dead', demoReady: true, processes: [proc('app', deadPort)] },
] };
writeFileSync(join(dir, 'registry.json'), JSON.stringify(reg));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');

const { createGateway } = await import('../../demo-gateway/gateway.mjs');
const grants = await import('../../demo-gateway/grants.mjs');
const { closeStore } = await import('../../lib/store/index.mjs');

const gw = await createGateway({ port: 0, baseHost: 'localhost', upstreamTimeoutMs: 300, maxBodyBytes: 1000, wsRecheckMs: 100, maxWsPerGrant: 2, redeemPerMinute: 1000 });
const gwPort = await gw.listen();
const gwTrusted = await createGateway({ port: 0, baseHost: 'localhost', trustedProxies: ['127.0.0.1'] });
const trustedPort = await gwTrusted.listen();

after(async () => { await gw.close(); await gwTrusted.close(); await new Promise((r) => main.close(r)); main.closeAllConnections?.(); second.close(); third.close(); await closeStore(); rmSync(dir, { recursive: true, force: true }); });

// ---- helpers
function request({ port = gwPort, host = 'toy.localhost', path = '/', method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `${host}:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
// Creates a link and opens it like a customer would, so `cookie` is the real session cookie the gateway issues.
// (`token` is the secret from the link itself; it is NOT a valid cookie.)
async function newGrant(app = 'toy') {
  const { grant, link } = await grants.createGrant({ customer: 'T', app, hours: 1 });
  const token = link.split('/d/')[1];
  const opened = await request({ host: app + '.localhost', path: '/d/' + token, method: 'POST' });
  assert.equal(opened.status, 302);
  return { id: grant.id, token, cookie: (opened.headers['set-cookie']?.[0] || '').split(';')[0] };
}
function wsOpen({ cookie, port = gwPort, host = 'toy.localhost', origin }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: `${host}:${port}`, ...(cookie ? { Cookie: cookie } : {}) }, origin });
    ws.on('open', () => resolve({ ws }));
    ws.on('unexpected-response', (_req, res) => { resolve({ status: res.statusCode }); res.resume(); });
    ws.on('error', () => {});
  });
}
const waitClose = (ws, ms = 3000) => new Promise((resolve) => { const t = setTimeout(() => resolve(false), ms); ws.on('close', () => { clearTimeout(t); resolve(true); }); });

// ---- HTTP proxying
test('redeems a link, then proxies with the gateway cookie stripped and other cookies kept', async () => {
  const g = await newGrant();
  const redeem = await request({ path: '/d/' + g.token, method: 'POST' });
  assert.equal(redeem.status, 302);
  assert.match(redeem.headers['set-cookie'][0], /^pd_demo=[a-f0-9]{64}; HttpOnly; SameSite=Lax/);
  assert.ok(!redeem.headers['set-cookie'][0].includes(g.token), 'the cookie must not contain the link token');
  const r = await request({ path: '/hello?x=1', headers: { cookie: `${g.cookie}; theme=dark` } });
  assert.equal(r.status, 200);
  const seenByUpstream = JSON.parse(r.body);
  assert.equal(seenByUpstream.url, '/hello?x=1');
  assert.equal(seenByUpstream.host, `127.0.0.1:${mainPort}`);
  assert.equal(seenByUpstream.cookie, 'theme=dark');
});

test('a GET of any link only shows the shared-demo notice; it never opens the demo, even with no use limit', async () => {
  const { link } = await grants.createGrant({ customer: 'Unlimited', app: 'toy', hours: 1 });
  const token = link.split('/d/')[1];
  const r = await request({ path: '/d/' + token });
  assert.equal(r.status, 200);
  assert.equal(r.headers['set-cookie'], undefined, 'no session from a GET');
  assert.match(r.body, /shared demonstration/i);
  assert.equal((await grants.findGrant(token)).uses, 0);
  assert.equal((await request({ path: '/d/' + token, method: 'POST' })).status, 302);
});

test('Next.js dev-only helper routes (source excerpts, open-in-editor) are answered by the gateway, not forwarded', async () => {
  const g = await newGrant();
  for (const p of ['/__nextjs_original-stack-frame?file=a', '/__nextjs_launch-editor?file=a', '/__nextjs_source-map?x=1']) {
    const r = await request({ path: p, headers: { cookie: g.cookie } });
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /"url"/, 'the upstream was not reached');
  }
  assert.equal((await request({ path: '/_next/static/x.js', headers: { cookie: g.cookie } })).status, 200, 'ordinary paths still pass');
});

test('refuses requests without a valid grant, for unknown hosts, and after revocation', async () => {
  assert.equal((await request({})).status, 401);
  assert.equal((await request({ host: 'nope.localhost' })).status, 404);
  assert.equal((await request({ host: 'toy.other.test' })).status, 404);
  const g = await newGrant();
  assert.equal((await request({ headers: { cookie: g.cookie } })).status, 200);
  await grants.revokeGrant(g.id);
  assert.equal((await request({ headers: { cookie: g.cookie } })).status, 403, 'revocation is immediate for HTTP');
  assert.equal((await request({ path: '/d/' + g.token })).status, 403);
});

test("a grant for one product is refused on another product's host", async () => {
  const g = await newGrant('toy');
  assert.equal((await request({ host: 'dead.localhost', headers: { cookie: g.cookie } })).status, 403);
});

test('demoRoutes send path prefixes to the other process', async () => {
  const g = await newGrant();
  assert.equal((await request({ path: '/other/page', headers: { cookie: g.cookie } })).body, 'second:/other/page');
});

test('an unreachable demo gives 503, a silent one gives 504', async () => {
  const dead = await newGrant('dead');
  assert.equal((await request({ host: 'dead.localhost', headers: { cookie: dead.cookie } })).status, 503);
  const g = await newGrant();
  assert.equal((await request({ path: '/hang', headers: { cookie: g.cookie } })).status, 504);
});

test('uploads over the size limit are refused (declared and streamed)', async () => {
  const g = await newGrant();
  const big = 'x'.repeat(2000);
  assert.equal((await request({ method: 'POST', path: '/slow-upload', headers: { cookie: g.cookie, 'content-length': String(big.length) }, body: big })).status, 413);
  const small = await request({ method: 'POST', path: '/slow-upload', headers: { cookie: g.cookie }, body: 'x'.repeat(500) });
  assert.equal(small.status, 200);
  assert.equal(small.body, '500');
});

// ---- client address handling
test('a spoofed X-Forwarded-For from an untrusted peer is dropped', async () => {
  const g = await newGrant();
  const r = JSON.parse((await request({ headers: { cookie: g.cookie, 'x-forwarded-for': '9.9.9.9' } })).body);
  assert.equal(r.xff, '127.0.0.1');
});
test('other client-address headers a customer sends are not passed to the demo app (HTTP and WebSocket)', async () => {
  const g = await newGrant();
  const fake = { forwarded: 'for=9.9.9.9', 'x-real-ip': '9.9.9.9', 'true-client-ip': '9.9.9.9', 'cf-connecting-ip': '9.9.9.9', 'x-client-ip': '9.9.9.9' };
  const r = JSON.parse((await request({ headers: { cookie: g.cookie, ...fake } })).body);
  assert.deepEqual(r.spoof, [], 'none of them reached the app');
  const ws = new WebSocket(`ws://127.0.0.1:${gwPort}/ws`, { headers: { Host: `toy.localhost:${gwPort}`, Cookie: g.cookie, ...fake } });
  await new Promise((resolve) => ws.on('open', resolve));
  ws.close();
  for (const h of Object.keys(fake)) assert.equal(seen.wsHeaders[h], undefined, h + ' not forwarded on the upgrade');
});
test("a demo app's Set-Cookie cannot reach the parent domain or overwrite the gateway's own cookies", async () => {
  const g = await newGrant();
  const r = await request({ path: '/setcookie', headers: { cookie: g.cookie } });
  const set = [].concat(r.headers['set-cookie']);
  assert.deepEqual(set.map((c) => c.split('=')[0]), ['theme', 'plain'], 'the gateway cookies are not passed on');
  assert.ok(set.every((c) => !/domain=/i.test(c)), 'no Domain attribute: ' + set.join(' | '));
  assert.match(set[0], /theme=dark; Path=\//);
});

test('over HTTPS the gateway cookies carry the __Host- prefix and Secure', async () => {
  const sg = await createGateway({ port: 0, baseHost: 'localhost', scheme: 'https', redeemPerMinute: 1000 });
  const p = await sg.listen();
  try {
    const { link } = await grants.createGrant({ customer: 'S', app: 'toy', hours: 1, deviceLock: true });
    const r = await request({ port: p, path: '/d/' + link.split('/d/')[1], method: 'POST' });
    assert.equal(r.status, 302);
    const set = r.headers['set-cookie'];
    assert.match(set[0], /^__Host-pd_demo=[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure/);
    assert.match(set[1], /^__Host-pd_dev=[a-f0-9]{32}; .*Secure/);
    assert.equal((await request({ port: p, headers: { cookie: set[0].split(';')[0] } })).status, 200, 'and the session works');
  } finally { await sg.close(); }
});

test('X-Forwarded-For is kept and extended when the peer is a trusted proxy', async () => {
  const g = await newGrant();
  const r = JSON.parse((await request({ port: trustedPort, headers: { cookie: g.cookie, 'x-forwarded-for': '9.9.9.9' } })).body);
  assert.equal(r.xff, '9.9.9.9, 127.0.0.1');
});

// ---- WebSockets
test('WebSocket: works with a valid grant, Origin/Host point at the upstream, gateway cookie stripped', async () => {
  const g = await newGrant();
  const { ws, status } = await wsOpen({ cookie: `${g.cookie}; theme=dark`, origin: 'http://toy.localhost:' + gwPort });
  assert.equal(status, undefined);
  const reply = new Promise((r) => ws.once('message', (m) => r(String(m))));
  ws.send('hi');
  assert.equal(await reply, 'echo:hi');
  assert.equal(seen.wsHeaders.host, `127.0.0.1:${mainPort}`);
  assert.equal(seen.wsHeaders.origin, `http://127.0.0.1:${mainPort}`);
  assert.equal(seen.wsHeaders.cookie, 'theme=dark');
  ws.close();
});

test('WebSocket: refused without a grant, for a wrong host, and for a revoked grant', async () => {
  assert.equal((await wsOpen({})).status, 401);
  const g = await newGrant();
  assert.equal((await wsOpen({ cookie: g.cookie, host: 'nope.localhost' })).status, 404);
  assert.equal((await wsOpen({ cookie: g.cookie, host: 'dead.localhost' })).status, 403);
  await grants.revokeGrant(g.id);
  assert.equal((await wsOpen({ cookie: g.cookie })).status, 403);
});

test('WebSocket: an open socket is cut off soon after the grant is revoked', async () => {
  const g = await newGrant();
  const { ws } = await wsOpen({ cookie: g.cookie });
  const closed = waitClose(ws);
  await grants.revokeGrant(g.id);
  assert.equal(await closed, true, 'socket should close within a few recheck intervals');
  // audit writes are fire-and-forget (they must never slow a customer down), so wait for them to land
  let evs = [];
  for (let i = 0; i < 40; i++) {
    evs = (await gw.store.audit.list(50)).filter((e) => e.grant === g.id).map((e) => e.ev + (e.why ? ':' + e.why : ''));
    if (evs.includes('ws-open') && evs.includes('ws-closed:grant-ended')) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(evs.includes('ws-open') && evs.includes('ws-closed:grant-ended'), evs.join());
});

test('WebSocket: at most maxWsPerGrant sockets per grant', async () => {
  const g = await newGrant();
  const a = await wsOpen({ cookie: g.cookie }), b = await wsOpen({ cookie: g.cookie });
  assert.ok(a.ws && b.ws);
  assert.equal((await wsOpen({ cookie: g.cookie })).status, 429);
  a.ws.close(); await waitClose(a.ws);
  await new Promise((r) => setTimeout(r, 100));
  const c = await wsOpen({ cookie: g.cookie });
  assert.ok(c.ws, 'a slot frees up when a socket closes');
  b.ws.close(); c.ws.close();
});

// ---- link limits and abuse protection
const ua = (name) => ({ 'user-agent': name });
// A browser: keeps cookies between requests. Opens a link the way a customer does.
function browser(name = 'Browser') {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  return {
    jar, cookie,
    async open(token, { post = true } = {}) {
      const r = await request({ path: '/d/' + token, method: post ? 'POST' : 'GET', headers: { ...ua(name), ...(jar.size ? { cookie: cookie() } : {}) } });
      for (const c of r.headers['set-cookie'] || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      return r;
    },
  };
}

test('a link with a use limit stops working after that many opens', async () => {
  const { grant, link } = await grants.createGrant({ customer: 'Limited', app: 'toy', hours: 1, maxUses: 1 });
  const token = link.split('/d/')[1];
  const scanner = await request({ path: '/d/' + token, headers: ua('Mail-Scanner') });
  assert.equal(scanner.status, 200, 'a GET only shows the button');
  assert.match(scanner.body, /open the demo/i);
  assert.match(scanner.body, /do not enter real personal/i, 'the shared-demo notice is shown before entry');
  assert.equal((await grants.findGrant(token)).uses, 0, 'and does not spend a use');
  assert.equal((await request({ path: '/d/' + token, method: 'POST', headers: ua('Browser A') })).status, 302);
  const second = await request({ path: '/d/' + token, method: 'POST', headers: ua('Browser A') });
  assert.equal(second.status, 403);
  assert.equal((await request({ path: '/d/' + token, headers: ua('Browser A') })).status, 403, 'a GET of a used-up link says so at once');
  assert.match(second.body, /maximum number of times/);
  assert.equal((await grants.findGrant(token)).uses, 1);
  assert.ok(grant.id);
});

test('a device-locked link only works in the browser that first opened it', async () => {
  const { link } = await grants.createGrant({ customer: 'Locked', app: 'toy', hours: 1, deviceLock: true });
  const token = link.split('/d/')[1];
  const a = browser('Same-UA'), b = browser('Same-UA'); // identical User-Agent: only the cookie tells them apart
  assert.equal((await a.open(token)).status, 302);
  assert.ok(a.jar.has('pd_dev'), 'the first browser is given a device id');
  const other = await b.open(token);
  assert.equal(other.status, 403, 'a different browser with the SAME User-Agent is refused');
  assert.match(other.body, /tied to the browser/);
  assert.equal((await a.open(token)).status, 302, 'the original browser can return');
  assert.equal((await request({ path: '/d/' + token, method: 'POST', headers: ua('Same-UA') })).status, 403, 'and so is a client with no device id');
});

test('audit records ip and browser; a retry storm after revocation is collapsed', async () => {
  const g = await newGrant();
  await request({ path: '/d/' + g.token, method: 'POST', headers: ua('Audit-Agent/1.0') });
  await grants.revokeGrant(g.id);
  for (let i = 0; i < 12; i++) assert.equal((await request({ headers: { cookie: g.cookie } })).status, 403);
  await new Promise((r) => setTimeout(r, 50)); // audit writes are fire-and-forget
  const mine = (await gw.store.audit.list(500)).filter((e) => e.grant === g.id);
  const enter = mine.find((e) => e.ev === 'enter');
  assert.equal(enter.ua, 'Audit-Agent/1.0');
  assert.equal(enter.ip, '127.0.0.1');
  assert.ok(mine.filter((e) => e.ev === 'denied').length <= 3, 'denials: ' + mine.filter((e) => e.ev === 'denied').length);
});

test('security headers: on the gateway pages, and added to proxied responses', async () => {
  const page = await request({});
  assert.equal(page.status, 401);
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  const g = await newGrant();
  const proxied = await request({ headers: { cookie: g.cookie } });
  assert.equal(proxied.headers['x-content-type-options'], 'nosniff');
  assert.equal(proxied.headers['referrer-policy'], 'strict-origin-when-cross-origin');
});

test('repeated bad links from one address get locked out; a good link still works', async () => {
  const strict = await createGateway({ port: 0, baseHost: 'localhost', redeemFailLimit: 3, redeemPerMinute: 1000 });
  const p = await strict.listen();
  try {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await request({ port: p, path: '/d/' + String(i).repeat(48).slice(0, 48).replace(/[^a-f0-9]/g, 'a') })).status);
    // earlier tests in this file already counted a failure for this address, so the lock-out may start a little early
    assert.equal(statuses[0], 403, 'the first bad link is refused normally: ' + statuses.join());
    const firstLock = statuses.indexOf(429);
    assert.ok(firstLock > 0 && firstLock <= 3, 'lock-out starts within the limit: ' + statuses.join());
    assert.ok(statuses.slice(firstLock).every((s) => s === 429), 'and stays locked: ' + statuses.join());
    const g = await newGrant();
    assert.equal((await request({ port: p, path: '/d/' + g.token, method: 'POST' })).status, 302, 'a valid link is not blocked');
  } finally { await strict.close(); }
});

// ---- the link token must not work as a cookie (it would skip the use limit and device lock)
test('the link token itself is refused as a cookie, over HTTP and WebSocket', async () => {
  const g = await newGrant();
  assert.equal((await request({ headers: { cookie: 'pd_demo=' + g.token } })).status, 401);
  assert.equal((await wsOpen({ cookie: 'pd_demo=' + g.token })).status, 401);
  assert.equal((await request({ headers: { cookie: g.cookie } })).status, 200, 'the real session still works');
  assert.equal((await request({ headers: { cookie: 'pd_demo=' + 'a'.repeat(64) } })).status, 401, 'a guessed session value is refused');
});

test('use limit cannot be skipped by presenting the link token as a cookie', async () => {
  const { link } = await grants.createGrant({ customer: 'OnceOnly', app: 'toy', hours: 1, maxUses: 1 });
  const token = link.split('/d/')[1];
  const first = await request({ path: '/d/' + token, method: 'POST' });
  assert.equal(first.status, 302);
  const session = first.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request({ headers: { cookie: session } })).status, 200, 'the person who opened it can use the demo');
  // someone else with the forwarded link:
  assert.equal((await request({ path: '/d/' + token, method: 'POST' })).status, 403, 'opening it again is refused');
  assert.equal((await request({ headers: { cookie: 'pd_demo=' + token } })).status, 401, 'and so is sending the token as a cookie');
});

test('device lock cannot be skipped by presenting the link token as a cookie', async () => {
  const { link } = await grants.createGrant({ customer: 'Pinned', app: 'toy', hours: 1, deviceLock: true });
  const token = link.split('/d/')[1];
  assert.equal((await browser('Browser A').open(token)).status, 302);
  assert.equal((await browser('Browser B').open(token)).status, 403);
  assert.equal((await request({ headers: { cookie: 'pd_demo=' + token, ...ua('Browser B') } })).status, 401);
});

test("one grant's session does not work for another grant's product, and ends with the grant", async () => {
  const a = await newGrant('toy');
  assert.equal((await request({ host: 'dead.localhost', headers: { cookie: a.cookie } })).status, 403);
  await grants.revokeGrant(a.id);
  assert.equal((await request({ headers: { cookie: a.cookie } })).status, 403);
});

// ---- health, metrics, logging
test('/_pd/healthz answers on any host without a grant', async () => {
  for (const host of ['toy.localhost', 'anything.example', '127.0.0.1']) {
    const r = await request({ host, path: '/_pd/healthz' });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
  }
});

test('/_pd/metrics: loopback only without a token, hidden when a proxy forwarded it, counts traffic', async () => {
  const g = await newGrant();
  await request({ headers: { cookie: g.cookie } });          // a 200
  await request({ path: '/d/' + 'f'.repeat(48) });             // a denied link (403)
  const ok = await request({ path: '/_pd/metrics' });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /# TYPE pd_gateway_requests_total counter/);
  assert.match(ok.body, /pd_gateway_requests_total\{code="2xx"\} \d+/);
  assert.match(ok.body, /pd_gateway_requests_total\{code="4xx"\} \d+/);
  assert.match(ok.body, /pd_gateway_redeem_total\{result="ok"\} \d+/);
  assert.match(ok.body, /pd_gateway_redeem_total\{result="denied"\} \d+/);
  assert.match(ok.body, /pd_gateway_websockets_open \d+/);
  assert.doesNotMatch(ok.body, /127\.0\.0\.1|[a-f0-9]{48}|Customer/, 'no IPs, tokens or customer names in metrics');
  assert.equal((await request({ path: '/_pd/metrics', headers: { 'x-forwarded-for': '9.9.9.9' } })).status, 404, 'looks proxied -> hidden');
});

test('/_pd/metrics with a token: only the right bearer token is accepted', async () => {
  const withToken = await createGateway({ port: 0, baseHost: 'localhost', metricsToken: 'sekret-token-value' });
  const p = await withToken.listen();
  try {
    assert.equal((await request({ port: p, path: '/_pd/metrics' })).status, 404);
    assert.equal((await request({ port: p, path: '/_pd/metrics', headers: { authorization: 'Bearer wrong' } })).status, 404);
    assert.equal((await request({ port: p, path: '/_pd/metrics', headers: { authorization: 'Bearer sekret-token-value', 'x-forwarded-for': '9.9.9.9' } })).status, 200);
  } finally { await withToken.close(); }
});

// ---- upstream host (containers) and the TLS 'ask' endpoint
test("a registry process with a 'host' is reached at that host, and the Host header names it", async () => {
  const g = await newGrant('hosty');
  const r = await request({ host: 'hosty.localhost', headers: { cookie: g.cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.body, 'third:127.0.0.1:' + thirdPort);
});

test('an unresolvable upstream host gives 503 (proves the host field is used, not 127.0.0.1)', async () => {
  const g = await newGrant('nohost');
  assert.equal((await request({ host: 'nohost.localhost', headers: { cookie: g.cookie } })).status, 503);
});

test('/_pd/tls-ask approves only real demo addresses, and only for direct (unproxied) callers', async () => {
  const ask = (domain, headers) => request({ path: '/_pd/tls-ask?domain=' + encodeURIComponent(domain), headers }).then((r) => r.status);
  assert.equal(await ask('toy.localhost'), 200);
  assert.equal(await ask('TOY.localhost'), 200, 'case-insensitive');
  assert.equal(await ask('nope.localhost'), 404, 'unknown product');
  assert.equal(await ask('a.b.localhost'), 404, 'nested names');
  assert.equal(await ask('toy.evil.example'), 404, 'wrong base host');
  assert.equal(await ask('localhost'), 404, 'the bare base host');
  assert.equal(await ask(''), 404);
  assert.equal(await ask('toy.localhost', { 'x-forwarded-for': '9.9.9.9' }), 404, 'a public request that came through the proxy');
});

test('errors: an upstream that dies mid-response ends the customer response instead of hanging', async () => {
  const g = await newGrant();
  const outcome = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('hung'), 3000);
    const r = http.request({ host: '127.0.0.1', port: gwPort, path: '/die', headers: { host: `toy.localhost:${gwPort}`, cookie: g.cookie } }, (res) => {
      res.on('data', () => {}); res.on('end', () => { clearTimeout(t); resolve('ended'); }); res.on('error', () => { clearTimeout(t); resolve('ended'); });
      res.on('close', () => { clearTimeout(t); resolve('ended'); });
    });
    r.on('error', () => { clearTimeout(t); resolve('ended'); }); r.end();
  });
  assert.equal(outcome, 'ended');
});

test('errors: 429 answers say when to retry', async () => {
  const bad = 'a'.repeat(48);
  let last;
  for (let i = 0; i < 15; i++) last = await request({ host: 'toy.localhost', path: '/d/' + bad, headers: { 'x-forwarded-for': '9.9.9.9' }, port: trustedPort });
  assert.equal(last.status, 429);
  assert.match(last.headers['retry-after'], /^(60|600)$/);
  assert.match(last.body, /<title>Too many attempts<\/title>/);
  assert.match(last.body, last.headers['retry-after'] === '60' ? /Please wait a minute and try again\./ : /Please wait a few minutes and try again\./, 'the wording matches the wait');
});

test('security: a WebSocket from another origin is refused, even with a valid session', async () => {
  const g = await newGrant();
  assert.equal((await wsOpen({ cookie: g.cookie, origin: 'http://evil.localhost:' + gwPort })).status, 403);
  assert.equal((await wsOpen({ cookie: g.cookie, origin: 'not a url' })).status, 403);
  const ok = await wsOpen({ cookie: g.cookie, origin: 'http://toy.localhost:' + gwPort });
  assert.ok(ok.ws, 'same-origin still works'); ok.ws.close();
});

test('an Upgrade request that is not a WebSocket is refused, even with a valid session', async () => {
  const g = await newGrant();
  const status = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: gwPort, path: '/', headers: { host: `toy.localhost:${gwPort}`, cookie: g.cookie, connection: 'Upgrade', upgrade: 'h2c' } });
    r.on('response', (res) => { resolve(res.statusCode); res.resume(); });
    r.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    r.on('error', () => resolve(0));
    r.end();
  });
  assert.equal(status, 400);
});

test('requests with no valid session are limited per address; a valid session is never counted', async () => {
  const lim = await createGateway({ port: 0, baseHost: 'localhost', noSessionPerMinute: 3, redeemPerMinute: 1000 });
  const port = await lim.listen();
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await request({ port, path: '/' })).status);
    assert.deepEqual(codes, [401, 401, 401, 429, 429, 429]);
    // the same address with a real session still gets through (the grant is created through the shared store)
    const g = await newGrant();
    const opened = await request({ port, host: 'toy.localhost', path: '/d/' + g.token, method: 'POST' });
    assert.notEqual(opened.status, 429, 'link redemption has its own limits and is not counted here');
  } finally { await lim.close(); }
});
