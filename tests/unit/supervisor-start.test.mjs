// Start must be safe to press on an app that is partly running: it starts only the missing process, leaves the running one alone,
// and still refuses a port that something else (not started by the dashboard) is holding. Uses real throw-away processes.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, testEnv } from '../helpers.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'pd-start-'));
const [pa, pb, pc] = [await freePort(), await freePort(), await freePort()];

writeFileSync(join(dir, 'server.mjs'), "import http from 'node:http'; http.createServer((q, r) => r.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');\n");
const proc = (name, port) => ({ name, cmd: `node "${join(dir, 'server.mjs').split(sep).join('/')}" {port}`, cwd: '.', port, health: '/' });
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'toy', name: 'Toy', path: dir, processes: [proc('a', pa), proc('b', pb)] },
  { id: 'held', name: 'Held', path: dir, processes: [proc('c', pc)] },
] }));
const env = testEnv({ DASHBOARD_DATA: dir, DASHBOARD_REGISTRY: join(dir, 'registry.json'), PD_DRIVER: '' });
delete env.PD_DRIVER;
const sup = (...args) => new Promise((resolve) => execFile(process.execPath, [join(root, 'supervisor', 'index.mjs'), ...args], { env, timeout: 90000, windowsHide: true },
  (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: stdout + stderr })));
const up = (port) => new Promise((resolve) => { const r = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => { res.resume(); resolve(true); }); r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); }); });

after(async () => { await sup('stop', 'toy'); await sup('stop', 'held'); rmSync(dir, { recursive: true, force: true }); });

test('Start on a partly running app starts only the missing process and leaves the running one alone', async () => {
  assert.equal((await sup('start', 'toy', '--only=a')).code, 0);
  assert.ok(await up(pa) && !(await up(pb)), 'a is up, b is down');
  const r = await sup('start', 'toy');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /toy\/a is already running/);
  assert.match(r.out, /Started toy\/b/);
  assert.ok(await up(pa) && await up(pb), 'both are up now');
  const again = await sup('start', 'toy'); // pressing Start once more is harmless
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /toy\/a is already running/);
  assert.match(again.out, /toy\/b is already running/);
});

test('a port held by something the dashboard did not start is still refused', async () => {
  // something that accepts connections but never answers HTTP; its sockets are kept so they can be closed at the end
  const held = new Set();
  const blocker = net.createServer((sock) => { held.add(sock); sock.on('close', () => held.delete(sock)); }).listen(pc, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  try {
    const r = await sup('start', 'held');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /already in use\. Not starting anything/);
  } finally { for (const sock of held) sock.destroy(); await new Promise((r) => blocker.close(r)); }
});
