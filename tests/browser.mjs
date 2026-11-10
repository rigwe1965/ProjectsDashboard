// Browser journey for the dashboard itself, in a real Chrome, against a stand-in demo app (the real apps live in other
// repositories, so CI cannot run them; tests/journeys.mjs covers those on the owner's PC).
//   1. the admin console loads with no page errors (catches a broken inline script: panels stuck on "Loading")
//   2. the owner creates a demo link in the console
//   3. a customer opens it in a second browser: shared-demo notice, click, and the stand-in app's page appears
//   4. the owner revokes the link; the customer's next load is refused
// The look and the sign-in of the console and the showcase are in tests/browser-ui.mjs.
// Everything is temporary: own data folder, own registry, random ports. Run: npm run test:browser (needs Google Chrome).
import { chromium } from 'playwright-core';
import { createStack, MARK, until } from './browser-stack.mjs';

const stack = await createStack();
const { gwPort } = stack;
const steps = [];
const step = (name) => { steps.push(name); console.log(`  ok  ${name}`); };

let browser, failed = null;
try {
  const consoleUrl = await stack.startGatewayAndConsole();
  browser = await chromium.launch({ channel: 'chrome' });
  const owner = await (await browser.newContext()).newPage();
  const errors = [];
  owner.on('pageerror', (e) => errors.push(e.message));
  owner.on('dialog', (d) => d.accept());
  await owner.goto(consoleUrl);
  await owner.waitForSelector('#demopanel form.new', { timeout: 30000 });
  await until(async () => !/Loading/.test(await owner.locator('#updated').innerText()), 'the console to finish loading');
  if (errors.length) throw new Error(`console page errors: ${JSON.stringify(errors)}`);
  step('console loads, panels filled, no page errors');

  await owner.fill('input[name=customer]', 'Browser test');
  await owner.selectOption('select[name=app]', 'toy');
  await owner.click('form.new button[type=submit]');
  const link = await owner.locator('.linkbox code').innerText({ timeout: 15000 });
  if (!link.includes(`toy.localhost:${gwPort}/d/`)) throw new Error(`unexpected link: ${link}`);
  step('owner creates a demo link in the console');

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await customer.getByRole('button', { name: /open the demo/i }).click();
  await customer.waitForSelector('h1', { timeout: 15000 });
  if (!(await customer.locator('body').innerText()).includes(MARK)) throw new Error(`customer did not reach the demo: ${await customer.locator('body').innerText()}`);
  step('customer sees the notice, clicks, and reaches the demo app');

  await owner.getByRole('button', { name: 'Revoke' }).click();
  await owner.waitForSelector('.pill:has-text("revoked")', { timeout: 15000 });
  step('owner revokes the link');

  const after = await customer.goto(`http://toy.localhost:${gwPort}/`);
  const body = await customer.locator('body').innerText();
  if (after.status() === 200 || body.includes(MARK)) throw new Error(`customer still reaches the demo after revoke (status ${after.status()})`);
  step(`customer is refused after revoke (HTTP ${after.status()})`);
  if (errors.length) throw new Error(`console page errors: ${JSON.stringify(errors)}`);
} catch (e) { failed = e; } finally {
  await browser?.close().catch(() => {});
  await stack.stop();
}
if (failed) { console.error(`\nFAILED after ${steps.length} step(s): ${failed.message}`); process.exit(1); }
console.log(`\nAll ${steps.length} browser steps passed.`);
process.exit(0);
