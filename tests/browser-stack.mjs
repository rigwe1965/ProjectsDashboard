// Shared set-up for the browser tests (tests/browser.mjs, tests/browser-ui.mjs): a throw-away data folder and registry, a stand-in
// demo app, and the real gateway and admin console as child processes on random ports. Not named *.test.mjs, so `npm test` skips it.
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, testProc } from './helpers.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MARK = 'stand-in demo app is working';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Poll from Node until fn() is truthy. (page.waitForFunction cannot be used on the console: its content-security policy forbids the
// string evaluation that polling needs, which is the policy doing its job.)
export async function until(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return; } catch { /* not there yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

export async function createStack() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-browser-'));
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

  const children = [];
  const launch = (file, extraEnv = {}, args = []) => {
    const c = spawn(process.execPath, [join(root, file), ...args], { cwd: root, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; c.stdout.on('data', (d) => (log += d)); c.stderr.on('data', (d) => (log += d)); c.log = () => log; children.push(c); return c;
  };
  const waitFor = async (fn, tries = 100) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(300); } return false; };
  const up = (port, path = '/') => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' }).then(() => true, () => false);

  return {
    dir, env, gwPort, conPort, stubPort,
    // Gateway + console in token mode; resolves the console's one-time URL.
    async startGatewayAndConsole() {
      const gateway = launch('demo-gateway/server.mjs'), consoleProc = launch('admin-console/server.mjs');
      const ok = await waitFor(async () => existsSync(env.ADMIN_URL_FILE) && (await fetch(`http://127.0.0.1:${gwPort}/_pd/healthz`).then((r) => r.ok, () => false)));
      if (!ok) throw new Error(`console did not start:\n${consoleProc.log()}\n${gateway.log()}`);
      return readFileSync(env.ADMIN_URL_FILE, 'utf8').trim();
    },
    // Another console on its own port (password mode when a password has been set). Resolves its base URL.
    async startConsole(port) {
      const c = launch('admin-console/server.mjs', { CONSOLE_PORT: String(port), ADMIN_URL_FILE: join(dir, `url-${port}.txt`) });
      if (!(await waitFor(() => up(port)))) throw new Error(`console on ${port} did not start:\n${c.log()}`);
      return `http://127.0.0.1:${port}`;
    },
    // npm run console:auth -- <args>, against the same data folder.
    auth(...args) { return execFileSync(process.execPath, [join(root, 'admin-console/auth-cli.mjs'), ...args], { cwd: root, env, encoding: 'utf8' }); },
    freePort,
    launch, waitFor, up,
    async stop() {
      for (const c of children) c.kill();
      stub.close();
      await sleep(500);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
