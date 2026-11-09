// Starting the console as a program (admin-console/server.mjs) in token mode: where the one-time URL goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../../admin-console/server.mjs', import.meta.url));

// Starts the console on a free port with its own empty database; resolves with what it printed once `ready()` is true.
function launch(extraEnv, ready) {
  const dir = mkdtempSync(join(tmpdir(), 'pd-launch-'));
  const child = spawn(process.execPath, [server], { env: { ...process.env, DASHBOARD_DATA: dir, CONSOLE_PORT: '0', ...extraEnv(dir) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (ready(dir, out)) { clearInterval(timer); child.kill(); child.once('close', () => resolve({ dir, out })); }
      else if (Date.now() - t0 > 15000) { clearInterval(timer); child.kill(); reject(new Error('console did not start: ' + out)); }
    }, 100);
  });
}

test('token mode with ADMIN_URL_FILE: the URL goes to that file and the output (a launcher log) never holds the token', async () => {
  const { dir, out } = await launch((d) => ({ ADMIN_URL_FILE: join(d, 'url.tmp') }), (d, o) => existsSync(join(d, 'url.tmp')) && /token mode/.test(o));
  try {
    const url = readFileSync(join(dir, 'url.tmp'), 'utf8');
    const token = /\?t=([a-f0-9]{48})$/.exec(url)?.[1];
    assert.ok(token, 'the file holds the full one-time URL: ' + url);
    assert.ok(!out.includes(token), 'the token is not in what the program printed');
    assert.match(out, /written to .*url\.tmp/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('token mode without it prints the URL as before', async () => {
  const { dir, out } = await launch(() => ({}), (d, o) => /\?t=[a-f0-9]{48}/.test(o));
  try { assert.match(out, /Open this URL/); } finally { rmSync(dir, { recursive: true, force: true }); }
});
