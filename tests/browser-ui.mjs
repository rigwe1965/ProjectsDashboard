// Front-end checks in a real Chrome: the admin console page, its sign-in, and the public showcase. Same stack as tests/browser.mjs.
//   console:  app card with its Log dialog, the Activity panel, no horizontal scroll on a phone, no page errors
//   sign-in:  password mode sends you to /login, a wrong password shows an error, the right one gets in, a lost session goes back
//             to /login on the next action, and Sign out works
//   showcase: home and a product page load, have a heading, no page errors, no horizontal scroll on desktop or phone
// Run: npm run test:browser:ui (needs Google Chrome). Everything is temporary: own data folder, own ports.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createStack, root, until } from './browser-stack.mjs';

const stack = await createStack();
const steps = [];
const step = (name) => { steps.push(name); console.log(`  ok  ${name}`); };
const PHONE = { width: 390, height: 800 }, DESKTOP = { width: 1280, height: 850 };
const hscroll = (page) => page.evaluate('document.documentElement.scrollWidth > window.innerWidth');
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

let browser, failed = null;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const newPage = async (viewport) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    return page;
  };

  // ---- console (token mode)
  const consoleUrl = await stack.startGatewayAndConsole();
  const owner = await newPage(DESKTOP);
  await owner.goto(consoleUrl);
  await owner.waitForSelector('#demopanel form.new', { timeout: 30000 });
  await owner.waitForSelector('article.card', { timeout: 15000 });
  must(/Toy/.test(await owner.locator('article.card').first().innerText()), 'the Toy app card is not shown');
  step('console: the app card is shown');

  await owner.getByRole('button', { name: 'View log of app' }).click();
  await owner.waitForSelector('#logdlg[open]', { timeout: 10000 });
  must(/Toy/.test(await owner.locator('#logtitle').innerText()), 'the log dialog has no title');
  await owner.click('#logclose');
  await owner.waitForSelector('#logdlg:not([open])', { state: 'attached', timeout: 5000 });
  step('console: the Log button opens the log dialog and Close shuts it');

  await owner.fill('input[name=customer]', 'Look test');
  await owner.selectOption('select[name=app]', 'toy');
  await owner.click('form.new button[type=submit]');
  await owner.waitForSelector('.linkbox code', { timeout: 15000 });
  await owner.click('#actrefresh');
  await until(async () => /Demo link created/.test(await owner.locator('#acttable').innerText()), 'the new link in the Activity panel');
  step('console: the Activity panel lists the link just created');
  // The customer opens the link, so the row gets a Details button; the toggle shows and hides what they did.
  const link = await owner.locator('.linkbox code').innerText();
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await customer.getByRole('button', { name: /open the demo/i }).click();
  await customer.waitForSelector('h1', { timeout: 15000 });
  await customer.context().close();
  const detailsBtn = owner.locator('#demopanel button.linkbtn', { hasText: /^Details$/ });
  await until(async () => { await owner.reload(); await owner.waitForSelector('#demopanel tbody tr', { timeout: 15000 }); return (await detailsBtn.count()) > 0; }, 'a Details button on the opened link', 30000);
  await detailsBtn.first().click();
  await owner.waitForSelector('#demopanel button.linkbtn:has-text("Hide details")', { timeout: 10000 });
  await owner.waitForSelector('#demopanel td[colspan="7"]', { timeout: 10000 });
  await owner.locator('#demopanel button.linkbtn', { hasText: /^Hide details$/ }).first().click();
  await owner.waitForSelector('#demopanel td[colspan="7"]', { state: 'detached', timeout: 10000 });
  step('console: Details opens a row for an opened link and Hide details closes it');
  must(owner.errors.length === 0, `console page errors: ${JSON.stringify(owner.errors)}`);

  const phone = await newPage(PHONE);
  await phone.goto(consoleUrl);
  await phone.waitForSelector('article.card', { timeout: 15000 });
  await phone.waitForSelector('#demopanel tbody tr', { timeout: 15000 });
  must(!(await hscroll(phone)), 'the console scrolls sideways on a phone');
  must(phone.errors.length === 0, `phone page errors: ${JSON.stringify(phone.errors)}`);
  step('console: no sideways scroll on a phone, no page errors');

  // ---- showcase
  execFileSync(process.execPath, [join(root, 'showcase/build.mjs')], { cwd: root, stdio: 'ignore' });
  const showPort = await stack.freePort();
  stack.launch('showcase/serve.mjs', { SHOWCASE_PORT: String(showPort) });
  must(await stack.waitFor(() => stack.up(showPort)), 'the showcase server did not start');
  for (const [label, vp] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    for (const path of ['', 'crm/']) {
      const page = await newPage(vp);
      await page.goto(`http://127.0.0.1:${showPort}/${path}`);
      must((await page.locator('h1').first().innerText()).length > 0, `showcase /${path} has no heading (${label})`);
      must(!(await hscroll(page)), `showcase /${path} scrolls sideways (${label})`);
      must(page.errors.length === 0, `showcase /${path} page errors (${label}): ${JSON.stringify(page.errors)}`);
      await page.context().close();
    }
  }
  step('showcase: home and CRM page load, no sideways scroll, no page errors (desktop and phone)');

  // ---- sign-in (password mode)
  const PASSWORD = 'correct horse battery staple';
  const pwFile = join(stack.dir, 'pw.txt');
  writeFileSync(pwFile, PASSWORD + '\n');
  stack.auth('set-password', '--from-file', pwFile);
  const base = await stack.startConsole(await stack.freePort());
  const me = await newPage(DESKTOP);
  await me.goto(base + '/');
  await me.waitForURL('**/login', { timeout: 15000 });
  step('sign-in: a signed-out visit goes to /login');

  await me.fill('#pw', 'not the password at all');
  await me.click('#go');
  await until(async () => (await me.locator('#err').innerText()).trim().length > 0, 'the wrong-password message');
  must(new URL(me.url()).pathname === '/login', 'a wrong password left the sign-in page');
  step('sign-in: a wrong password shows an error and stays on /login');

  await me.fill('#pw', PASSWORD);
  await me.click('#go');
  await me.waitForSelector('#demopanel form.new', { timeout: 30000 });
  await me.waitForSelector('#signout:not([hidden])', { timeout: 10000 });
  step('sign-in: the right password opens the console, with a Sign out button');

  stack.auth('sign-out-all'); // the session is lost behind the page's back
  await me.click('#actrefresh');
  await me.waitForURL('**/login', { timeout: 15000 });
  step('sign-in: after the session is ended, the next action goes back to /login');

  await me.fill('#pw', PASSWORD);
  await me.click('#go');
  await me.waitForSelector('#signout:not([hidden])', { timeout: 30000 });
  await me.click('#signout');
  await me.waitForURL('**/login', { timeout: 15000 });
  step('sign-in: Sign out returns to /login');
  must(me.errors.length === 0, `sign-in page errors: ${JSON.stringify(me.errors)}`);
} catch (e) { failed = e; } finally {
  await browser?.close().catch(() => {});
  await stack.stop();
}
if (failed) { console.error(`\nFAILED after ${steps.length} step(s): ${failed.message}`); process.exit(1); }
console.log(`\nAll ${steps.length} front-end steps passed.`);
process.exit(0);
