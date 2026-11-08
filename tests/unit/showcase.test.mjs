// The local showcase preview must survive malformed requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const get = (port, path) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  r.on('error', () => resolve(0)); r.end();
});

test('showcase server: a malformed URL gets 400 and the server keeps running', async () => {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../showcase/serve.mjs', import.meta.url))], { env: { ...process.env, SHOWCASE_PORT: String(port) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 30 && !(await get(port, '/x')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await get(port, '/%E0%A4%A'), 400);
    assert.equal(await get(port, '/nope.html'), 404);
    assert.equal(await get(port, '/../package.json'), 404);
  } finally { child.kill(); }
});
