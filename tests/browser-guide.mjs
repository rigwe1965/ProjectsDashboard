// The AI guide in a real Chrome, against the real gateway as a child process and a FAKE Claude API (nothing is spent):
//   1. the opening page offers the guide (and says it is AI and where the words go); a link without one does not
//   2. "open it with the guide" lands on the split page; the demo shows inside the frame even though the stand-in app forbids framing
//      (X-Frame-Options: DENY and CSP frame-ancestors 'none'), and a plain visit to that app is still refused to other sites' frames
//   3. a question gets a streamed answer and the count of messages left goes down; the API got the made-up key
//   4. an answer that contains HTML is shown as text, never as markup, and the page's policy raises no violation
//   5. the allowance runs out: the box is disabled
//   6. on a phone the demo and the chat both fit, with no sideways scroll; "Hide guide" returns to the plain demo
// Run: node tests/browser-guide.mjs (npm run test:browser runs it). Needs Google Chrome. Everything is temporary: own data folder and ports.
import http from 'node:http';
import { chromium } from 'playwright-core';
import { createStack, MARK, until } from './browser-stack.mjs';
import { httpRequest } from './helpers.mjs';

const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const steps = [];
const step = (name) => { steps.push(name); console.log(`  ok  ${name}`); };

// ---- a fake Claude API: answers with whatever `answer` is, in the API's streaming format, and remembers what it was sent
const seen = [];
let answer = 'Open the Toys tab.';
const api = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const half = Math.ceil(answer.length / 2);
    const ev = [
      { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.slice(0, half) } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.slice(half) } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ];
    for (const e of ev) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
  });
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));

const stack = await createStack({
  stubHeaders: { 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" },
  guide: { apiUrl: `http://127.0.0.1:${api.address().port}` },
});
const { gwPort } = stack;

let browser, failed = null, closeStore = async () => {};
try {
  await stack.startGatewayAndConsole();
  // Links are made in this process, in the same data folder the gateway reads.
  process.env.DASHBOARD_DATA = stack.dir; process.env.DASHBOARD_REGISTRY = `${stack.dir}/registry.json`; process.env.DEMO_BASE_HOST = `localhost:${gwPort}`;
  const grants = await import('../demo-gateway/grants.mjs');
  ({ closeStore } = await import('../lib/store/index.mjs'));
  const withGuide = (await grants.createGrant({ customer: 'Browser guide', app: 'toy', guideMessages: 3 })).link;
  const without = (await grants.createGrant({ customer: 'Browser plain', app: 'toy' })).link;

  browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });

  // 1. the opening page
  const plain = await (await browser.newContext()).newPage();
  await plain.goto(without);
  must(!/guide/i.test(await plain.locator('body').innerText()), 'a link without a guide shows no guide text');
  await page.goto(withGuide);
  const landing = await page.locator('body').innerText();
  must(/A demo guide is included/.test(landing) && /AI assistant/.test(landing) && /sent to Anthropic/.test(landing) && /We do not store it/.test(landing), `the opening page explains the guide: ${landing}`);
  step('the opening page offers the guide, says it is AI and where the words go; a plain link does not');

  // 2. the split page, with the demo framed although the app forbids framing
  await page.getByRole('button', { name: /open it with the guide/i }).click();
  await page.waitForURL(/\/_pd\/guide$/, { timeout: 15000 });
  await page.waitForSelector('iframe.demo');
  await until(async () => (await page.frameLocator('iframe.demo').locator('body').innerText()).includes(MARK), 'the demo to show inside the frame');
  step('the split page shows the demo in its frame, though the app sends DENY and frame-ancestors none');
  // Node cannot look up *.localhost the way Chrome does, so these calls go to 127.0.0.1 with the demo's Host header and the customer's cookie.
  const cookie = (await ctx.cookies()).find((c) => c.name === 'pd_demo');
  const raw = (path, { method = 'GET', headers = {}, body } = {}) => httpRequest({ port: gwPort, host: `toy.localhost:${gwPort}`, path, method, body, headers: { cookie: `pd_demo=${cookie.value}`, ...headers } });
  const direct = await raw('/');
  must(direct.status === 200 && direct.body.includes(MARK), `the stand-in app answered (status ${direct.status})`);
  must(direct.headers['x-frame-options'] === 'DENY', `outside the guide's frame the app's own header stands (got ${direct.headers['x-frame-options']})`);
  const foreign = await raw('/', { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' } });
  must(foreign.status === 200 && foreign.headers['x-frame-options'] === 'DENY', 'another site framing the demo is still refused');
  const own = await raw('/', { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  must(own.headers['x-frame-options'] === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(own.headers['content-security-policy']), 'the guide page\'s own frame is let through');
  step('the demo is still unframeable by any other site');

  // 3. a question
  const left = page.locator('#left'), log = page.locator('#log');
  must((await left.innerText()) === '3 messages left', `3 left at the start (got ${await left.innerText()})`);
  await page.fill('#msg', 'Where are the toys?');
  await page.press('#msg', 'Enter');
  await until(async () => (await log.innerText()).includes('Open the Toys tab.'), 'the answer');
  await until(async () => (await left.innerText()) === '2 messages left', 'the count to go down');
  must(seen.length === 1 && seen[0].url.startsWith('/v1/messages') && seen[0].auth === 'Bearer test-key-not-real', `the API got the call with the key (saw ${JSON.stringify(seen.map((s) => s.auth))})`);
  must(seen[0].body.messages.at(-1).content === 'Where are the toys?' && !seen[0].body.tools, 'the question went as the user message, with no tools');
  must(/Toys tab lists every toy/.test(seen[0].body.system[0].text), 'the product guide is in the system prompt');
  step('a question is answered in the panel and the count goes down');

  // 4. HTML in an answer stays text
  answer = '<img src=x onerror="document.title=1"> <b>bold?</b> done';
  await page.fill('#msg', 'Try markup');
  await page.click('#send');
  await until(async () => (await log.innerText()).includes('done'), 'the second answer');
  must((await log.innerText()).includes('<img src=x'), 'the markup is shown as text');
  must((await log.locator('img, b, script').count()) === 0, 'no element was made from the answer');
  must((await page.title()) !== '1', 'no handler ran');
  must(problems.length === 0, `no page errors or policy violations: ${JSON.stringify(problems)}`);
  step('markup in an answer is shown as text and the page raises no error or policy violation');

  if (process.env.GUIDE_SHOTS) await page.screenshot({ path: `${process.env.GUIDE_SHOTS}/guide-desktop.png` }); // optional: look at it
  // 5. the allowance runs out
  answer = 'Last one.';
  await page.fill('#msg', 'One more');
  await page.click('#send');
  await until(async () => (await left.innerText()) === '0 messages left', 'the count to reach zero');
  await until(async () => await page.locator('#msg').isDisabled(), 'the box to be disabled');
  must(await page.locator('#send').isDisabled(), 'the button is disabled too');
  const callsBefore = seen.length;
  const refused = await raw('/_pd/guide/chat', { method: 'POST', body: JSON.stringify({ message: 'sneak' }), headers: { 'content-type': 'application/json', origin: `http://toy.localhost:${gwPort}` } });
  must(refused.status === 429 && seen.length === callsBefore, `the server refuses a fourth message and does not call the API (status ${refused.status})`);
  step('when the allowance is used up the box is disabled and the server refuses more');

  // 6. a phone, and the way out
  await page.setViewportSize({ width: 390, height: 800 });
  const fits = await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
  must(fits, 'no sideways scroll on a phone');
  const boxes = await page.evaluate("(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, w: b.width }; }; return { demo: r('iframe.demo'), form: r('#form'), log: r('#log') }; })()");
  must(boxes.demo.w > 300 && boxes.demo.bottom <= boxes.log.top + 1, `on a phone the demo is above the chat (${JSON.stringify(boxes)})`);
  must(boxes.form.bottom <= 800 + 1, 'the chat box is on screen');
  if (process.env.GUIDE_SHOTS) await page.screenshot({ path: `${process.env.GUIDE_SHOTS}/guide-phone.png` });
  step('on a phone the demo and the chat both fit, with no sideways scroll');
  await page.click('text=Hide guide');
  await page.waitForURL(`http://toy.localhost:${gwPort}/`);
  must((await page.locator('body').innerText()).includes(MARK), 'Hide guide returns to the plain demo');
  step('"Hide guide" returns to the plain demo');
} catch (e) { failed = e; } finally {
  await browser?.close().catch(() => {});
  await closeStore().catch(() => {}); // this process opened the data folder too; it must let go before the folder is deleted
  api.close();
  await stack.stop().catch((e) => console.error('clean-up problem: ' + e.message));
}
if (failed) { console.error(`\nFAILED after ${steps.length} step(s): ${failed.message}`); process.exit(1); }
console.log(`\nAll ${steps.length} browser steps passed.`);
process.exit(0);
