// UI check: screenshots the admin console and showcase (desktop + phone) and flags horizontal scroll / page errors.
// Run from the dashboard root: node tests/ui-check.mjs   (uses installed Google Chrome; screenshots go to data/shots)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "C:/Users/rigwe/Desktop/ProjectsDashboard/data/demo-src/reci-transport/node_modules/.pnpm/playwright-core@1.62.0/node_modules/playwright-core");
const root = 'C:/Users/rigwe/Desktop/ProjectsDashboard';

spawn('node', ['showcase/build.mjs'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const show = spawn('node', ['showcase/serve.mjs'], { cwd: root, stdio: 'ignore', env: { ...process.env, SHOWCASE_PORT: '4210' } });
const cons = spawn('node', ['admin-console/server.mjs'], { cwd: root, env: { ...process.env, CONSOLE_PORT: '4101' } });
let out = ''; cons.stdout.on('data', (d) => (out += d));
await new Promise((r) => setTimeout(r, 2500));
const url = out.match(/http:\/\/127\.0\.0\.1:4101\/\?t=[a-f0-9]+/)?.[0];

const browser = await chromium.launch({ channel: 'chrome' });
const log = [];
for (const [tag, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  await page.goto(url); await page.waitForSelector('.card', { timeout: 20000 }); await page.waitForTimeout(2500);
  await page.screenshot({ path: `data/shots/console-${tag}.png`, fullPage: true });
  log.push(`console ${tag}: cards=${await page.locator('section.card').count()} demoPanel=${await page.locator('#demopanel').innerText().then(t=>t.slice(0,60).replace(/\n/g,' | '))} errors=${JSON.stringify(errs)}`);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); if (hs) log.push('  offenders: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 6).map(e => e.tagName + '.' + (e.className || '') + ':' + Math.round(e.getBoundingClientRect().right)))));
  log.push(`console ${tag}: horizontal scroll=${hs}`);
  for (const p of ['', 'crm/']) {
    const sp = await ctx.newPage(); const se = []; sp.on('pageerror', (e) => se.push(e.message));
    await sp.goto(`http://127.0.0.1:4210/${p}`); await sp.waitForTimeout(500);
    await sp.screenshot({ path: `data/shots/showcase-${p ? 'crm' : 'home'}-${tag}.png`, fullPage: true });
    log.push(`showcase /${p} ${tag}: h1="${await sp.locator('h1').first().innerText()}" hscroll=${await sp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)} errors=${JSON.stringify(se)}`);
    await sp.close();
  }
  await ctx.close();
}
await browser.close(); cons.kill(); show.kill();
console.log(log.join('\n'));
