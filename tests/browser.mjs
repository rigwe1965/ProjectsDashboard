// Browser journey for the dashboard itself, in a real Chrome, against a stand-in demo app (the real apps live in other
// repositories, so CI cannot run them; tests/journeys.mjs covers those on the owner's PC).
//   1. the admin console loads with no page errors (catches a broken inline script: panels stuck on "Loading")
//   2. the owner creates a demo link in the console
//   3. a customer opens it in a second browser: shared-demo notice, click, and the stand-in app's page appears
//   4. the owner revokes the link; the customer's next load is refused
// Everything is temporary: own data folder, own registry, random ports. Run: npm run test:browser (needs Google Chrome).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { freePort, testProc } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'pd-browser-'));
const MARK = 'stand-in demo app is working';
const children = [];
const steps = [];
const step = (name) => { steps.push(name); console.log(`  ok  ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stub = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Stand-in</title><h1>${MARK}</h1>`); });
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubPort = stub.address().port;
const [gwPort, conPort] = [await freePort(), await freePort()];

writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [testProc('app', stubPort + 1)] },
  { id: 'toy-demo', name: 'Toy demo', path: '.', demoOf: 'toy', demoReady: true, processes: [testProc('app', stubPort)] },
] }));
const env = { ...process.env, DASHBOARD_DATA: dir, DASHBOARD_REGISTRY: join(dir, 'registry.json'), GATEWAY_PORT: String(gwPort), CONSOLE_PORT: String(conPort),
  DEMO_BASE_HOST: `localhost:${gwPort}`, ADMIN_URL_FILE: join(dir, 'console-url.txt'), DEMO_AUTO_RESET: '0' };
for (const k of ['DASHBOARD_DB', 'DATABASE_URL', 'TEST_DATABASE_URL', 'ADMIN_DATA_KEY', 'ADMIN_BIND', 'DEMO_SCHEME']) delete env[k];
const launch = (file) => { const c = spawn(process.execPath, [join(root, file)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; c.stdout.on('data', (d) => (log += d)); c.stderr.on('data', (d) => (log += d)); c.log = () => log; children.push(c); return c; };

let browser, failed = null;
try {
  const gateway = launch('demo-gateway/server.mjs'), consoleProc = launch('admin-console/server.mjs');
  for (let i = 0; i < 100 && !(existsSync(env.ADMIN_URL_FILE) && (await fetch(`http://127.0.0.1:${gwPort}/_pd/healthz`).then((r) => r.ok, () => false))); i++) await sleep(300);
  if (!existsSync(env.ADMIN_URL_FILE)) throw new Error(`console did not start:\n${consoleProc.log()}\n${gateway.log()}`);
  const consoleUrl = readFileSync(env.ADMIN_URL_FILE, 'utf8').trim();

  browser = await chromium.launch({ channel: 'chrome' });
  const owner = await (await browser.newContext()).newPage();
  const errors = [];
  owner.on('pageerror', (e) => errors.push(e.message));
  owner.on('dialog', (d) => d.accept());
  await owner.goto(consoleUrl);
  await owner.waitForSelector('#demopanel form.new', { timeout: 30000 });
  await owner.waitForFunction("!/Loading/.test(document.querySelector('#updated').textContent)", null, { timeout: 15000 });
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
  for (const c of children) c.kill();
  stub.close();
  await sleep(500);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failed) { console.error(`\nFAILED after ${steps.length} step(s): ${failed.message}`); process.exit(1); }
console.log(`\nAll ${steps.length} browser steps passed.`);
process.exit(0);
