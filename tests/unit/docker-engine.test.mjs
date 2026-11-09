import test from 'node:test';
import assert from 'node:assert/strict';
import { engineUp, ensureEngine, launchDockerDesktop } from '../../lib/docker.mjs';
import { validate } from '../../lib/registry.mjs';

// a fake clock, so no test really waits
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };

test('engineUp: true when `docker info` works, false when it fails', async () => {
  assert.equal(await engineUp(async () => '29.0'), true);
  assert.equal(await engineUp(async () => { throw new Error('daemon not running'); }), false);
});

test('ensureEngine: does nothing when the engine is already up', async () => {
  let launched = false;
  const r = await ensureEngine({ up: async () => true, launch: () => { launched = true; return { ok: true }; } });
  assert.deepEqual(r, { ok: true, started: false });
  assert.equal(launched, false);
});

test('ensureEngine: starts Docker and waits until the engine answers', async () => {
  const c = clock(); let calls = 0, launched = 0;
  const r = await ensureEngine({ ...c, up: async () => ++calls > 4, launch: () => { launched++; return { ok: true }; } });
  assert.deepEqual(r, { ok: true, started: true });
  assert.equal(launched, 1, 'Docker is launched once, not on every poll');
});

test('ensureEngine: gives up after the timeout with a clear message', async () => {
  const c = clock();
  const r = await ensureEngine({ ...c, timeoutMs: 9000, intervalMs: 3000, up: async () => false, launch: () => ({ ok: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.started, true);
  assert.match(r.message, /did not start within 9 s/);
});

test('ensureEngine: reports it when Docker cannot be launched at all', async () => {
  const r = await ensureEngine({ up: async () => false, launch: () => ({ ok: false, message: 'cannot start here' }) });
  assert.deepEqual(r, { ok: false, started: false, message: 'cannot start here' });
});

test('launchDockerDesktop: refuses on platforms where it cannot start Docker', () => {
  assert.equal(launchDockerDesktop('linux').ok, false);
});

test('registry: requiresDocker must be a boolean', () => {
  const app = (v) => ({ apps: [{ id: 'x', name: 'X', path: '.', requiresDocker: v, processes: [{ name: 'p', cmd: 'x', port: 5000 }] }] });
  assert.deepEqual(validate(app(true)), []);
  assert.match(validate(app('yes'))[0], /requiresDocker must be true or false/);
});
