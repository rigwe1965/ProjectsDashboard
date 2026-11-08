// Customer journeys through the gateway for all four demos (ImageApp, Airfinder, CRM, ClaudeWorkspace).
// Start first: gateway, imageapp-demo, airfinder-demo, crm-demo, claudeworkspace-demo (node supervisor/index.mjs start <id>).
// CRM admin sign-in uses CRM_ADMIN_PASSWORD from data/crm-demo.env when set, else SEED_USER_PASSWORD.
// Run from the dashboard root: node tests/journeys.mjs   (creates and then revokes its own demo links; screenshots in data/shots)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createGrant, revokeGrant } from '../demo-gateway/grants.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "C:/Users/rigwe/Desktop/ProjectsDashboard/data/demo-src/reci-transport/node_modules/.pnpm/playwright-core@1.62.0/node_modules/playwright-core");
const env = (f) => Object.fromEntries(readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const cw = env('data/claudeworkspace-demo.env'), af = env('data/airfinder-demo.env'), crm = env('data/crm-demo.env');
const shots = 'data/shots';
// demo customer password comes from Airfinder's own seed script (in the demo clone), not hard-coded here
const afCustomerPw = readFileSync('data/demo-src/airfinder/seed_demo.py', 'utf8').match(/hashpw\(b'([^']+)'/)?.[1];
const results = [];
const note = (p, s, ok, d = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${p.padEnd(15)} ${s}${d ? '  -> ' + d : ''}`); };

const browser = await chromium.launch({ channel: 'chrome' });
const granted = [];
async function open(product, who) {
  const { grant, link } = await createGrant({ customer: `UI test ${who}`, app: product, hours: 1 });
  granted.push(grant.id);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: /open the demo/i }).click(); // the shared-demo notice
  await page.waitForLoadState('domcontentloaded', { timeout: 120000 });
  return { ctx, page, errs };
}
async function login(page, email, password, submitRe = /sign in|log in|login|anmelden|submit/i) {
  await page.locator('input[type=email], input[name=email], input[id*=email i]').first().fill(email, { timeout: 30000 });
  await page.locator('input[type=password]').first().fill(password);
  const btn = page.locator('button[type=submit], button, input[type=submit]').filter({ hasText: submitRe }).first();
  (await btn.count()) ? await btn.click() : await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
const text = async (page) => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140);

// ---- ImageApp
try {
  const { ctx, page, errs } = await open('imageapp', 'imageapp');
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
  note('ImageApp', 'landing loads with upload control', true, await page.title());
  const tmp = await ctx.newPage(); await tmp.setContent('<body style="margin:0"><div style="width:800px;height:500px;background:linear-gradient(135deg,#e33,#38f)"></div></body>', { waitUntil: 'load' });
  const buf = await tmp.locator('div').screenshot({ type: 'png' }); await tmp.close();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: buf });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${shots}/j-imageapp.png`, fullPage: true });
  const t = await text(page); const imgs = await page.locator('img').count();
  note('ImageApp', 'upload an image and see it processed', imgs > 0 && !/error|failed/i.test(t), `images on page=${imgs}; errors=${JSON.stringify(errs)}`);
  await ctx.close();
} catch (e) { note('ImageApp', 'journey', false, e.message.split('\n')[0]); }

// ---- Airfinder
try {
  const { ctx, page, errs } = await open('airfinder', 'airfinder');
  await page.waitForLoadState('load'); await page.screenshot({ path: `${shots}/j-airfinder-home.png`, fullPage: true });
  note('Airfinder', 'home page loads', /airfinder/i.test(await page.title()), await page.title());
  await page.goto('http://airfinder.localhost:4300/auth/login.html'); await login(page, 'emeka.okafor@techcorp.ng', afCustomerPw);
  await page.screenshot({ path: `${shots}/j-airfinder-customer.png`, fullPage: true });
  note('Airfinder', 'customer sign-in', /account|dashboard/i.test(page.url()), page.url().replace('http://airfinder.localhost:4300', '') + ' | ' + await text(page));
  await page.goto('http://airfinder.localhost:4300/admin/login.html'); await login(page, af.SUPER_ADMIN_EMAIL, af.SUPER_ADMIN_PASSWORD);
  await page.screenshot({ path: `${shots}/j-airfinder-staff.png`, fullPage: true });
  note('Airfinder', 'staff portal sign-in', !/login/i.test(page.url()), page.url().replace('http://airfinder.localhost:4300', '') + ' | ' + await text(page));
  note('Airfinder', 'no page errors', errs.length === 0, JSON.stringify(errs));
  await ctx.close();
} catch (e) { note('Airfinder', 'journey', false, e.message.split('\n')[0]); }

// ---- CRM
try {
  const { ctx, page, errs } = await open('crm', 'crm');
  await page.goto('http://crm.localhost:4300/sign-in', { timeout: 180000 });
  await page.screenshot({ path: `${shots}/j-crm-signin.png` });
  await login(page, 'admin@crm.test', crm.CRM_ADMIN_PASSWORD || crm.SEED_USER_PASSWORD, /sign in|log in|login/i);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shots}/j-crm-dashboard.png`, fullPage: true });
  note('CRM', 'sign in as admin and reach the dashboard', /dashboard/i.test(page.url()), page.url().replace('http://crm.localhost:4300', '') + ' | ' + await text(page));
  await page.goto('http://crm.localhost:4300/deals', { timeout: 120000 }); await page.waitForTimeout(3000);
  await page.screenshot({ path: `${shots}/j-crm-deals.png`, fullPage: true });
  note('CRM', 'deals board loads', /deal|pipeline|lead|qualif/i.test(await text(page)) , await text(page));
  note('CRM', 'no page errors', errs.length === 0, JSON.stringify(errs));
  await ctx.close();
} catch (e) { note('CRM', 'journey', false, e.message.split('\n')[0]); }

// ---- ClaudeWorkspace
try {
  const { ctx, page, errs } = await open('claudeworkspace', 'cw');
  await page.waitForLoadState('load', { timeout: 180000 }); await page.waitForTimeout(3000);
  await page.screenshot({ path: `${shots}/j-cw-home.png`, fullPage: true });
  note('ClaudeWorkspace', 'customer site loads', /reci/i.test(await page.title()), await page.title());
  const adm = await ctx.newPage(); await adm.goto('http://claudeworkspace.localhost:4300/admin/auth/login', { timeout: 180000 });
  await login(adm, cw.ADMIN_EMAIL, cw.ADMIN_PASSWORD, /sign in|log in|login/i); await adm.waitForTimeout(4000);
  await adm.screenshot({ path: `${shots}/j-cw-admin.png`, fullPage: true });
  note('ClaudeWorkspace', 'admin portal sign-in', /dashboard/i.test(adm.url()), adm.url().replace('http://claudeworkspace.localhost:4300', '') + ' | ' + await text(adm));
  note('ClaudeWorkspace', 'no page errors (site)', errs.length === 0, JSON.stringify(errs));
  await ctx.close();
} catch (e) { note('ClaudeWorkspace', 'journey', false, e.message.split('\n')[0]); }

await browser.close();
for (const id of granted) { try { await revokeGrant(id); } catch { /* already revoked */ } }
console.log(results.join('\n'));
