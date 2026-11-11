// Logs must not grow without limit (audit F-09).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnv } from '../helpers.mjs';
import { rotateLog, LOG_MAX_BYTES } from '../../lib/log-rotate.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-rot-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('rotateLog: a log over the limit moves to .1 (replacing the old .1); a small or missing one is left alone', () => {
  const f = join(dir, 'a.log');
  assert.equal(rotateLog(f, 10), false, 'missing file: nothing to do');
  writeFileSync(f, '12345');
  assert.equal(rotateLog(f, 10), false); assert.equal(readFileSync(f, 'utf8'), '12345');
  writeFileSync(f, 'first-big-log'); assert.equal(rotateLog(f, 10), true);
  assert.equal(existsSync(f), false); assert.equal(readFileSync(f + '.1', 'utf8'), 'first-big-log');
  writeFileSync(f, 'second-big-log'); assert.equal(rotateLog(f, 10), true);
  assert.equal(readFileSync(f + '.1', 'utf8'), 'second-big-log', 'only one old copy is kept');
  assert.equal(existsSync(f + '.2'), false);
});

test('the default limit is 5 MB', () => assert.equal(LOG_MAX_BYTES, 5 * 1024 * 1024));

test('the supervisor rotates a step log before it appends to it (audit F-09)', () => {
  const reg = join(dir, 'registry.json'), data = join(dir, 'data'), logs = join(data, 'logs');
  mkdirSync(logs, { recursive: true });
  const node = (js) => `"${process.execPath}" -e "${js}"`;
  writeFileSync(reg, JSON.stringify({ apps: [{ id: 'x', name: 'X', path: dir, build: { cmd: node("console.log('built')") }, processes: [{ name: 'app', cmd: node('setTimeout(()=>{},1000)'), port: 19391, health: '/' }] }] }));
  const big = 'x'.repeat(6 * 1024 * 1024);
  writeFileSync(join(logs, 'x-build.log'), big);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../supervisor/index.mjs', import.meta.url)), 'build', 'x'], { env: testEnv({ DASHBOARD_DATA: data, DASHBOARD_REGISTRY: reg }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(logs, 'x-build.log.1'), 'utf8'), big, 'the big log was kept as .1');
  assert.match(readFileSync(join(logs, 'x-build.log'), 'utf8'), /^\r?\n--- .* build: exit 0\r?\nbuilt/, 'the new log starts fresh');
});

test('the supervisor rotates the log of an app it starts (audit F-09)', () => {
  const reg = join(dir, 'registry2.json'), data = join(dir, 'data2'), logs = join(data, 'logs');
  mkdirSync(logs, { recursive: true });
  const serve = `"${process.execPath}" -e "require('http').createServer((q,s)=>s.end('ok')).listen(19392,'127.0.0.1');console.log('hello from the app')"`;
  writeFileSync(reg, JSON.stringify({ apps: [{ id: 'y', name: 'Y', path: dir, processes: [{ name: 'app', cmd: serve, port: 19392, health: '/' }] }] }));
  const big = 'y'.repeat(6 * 1024 * 1024);
  writeFileSync(join(logs, 'y-app.log'), big);
  const run = (cmd) => spawnSync(process.execPath, [fileURLToPath(new URL('../../supervisor/index.mjs', import.meta.url)), cmd, 'y'], { env: testEnv({ DASHBOARD_DATA: data, DASHBOARD_REGISTRY: reg }), encoding: 'utf8', timeout: 90000 });
  try {
    const r = run('start');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(join(logs, 'y-app.log.1'), 'utf8'), big);
    assert.ok(readFileSync(join(logs, 'y-app.log'), 'utf8').length < 1000, 'the app writes into a fresh log');
  } finally { run('stop'); }
});
