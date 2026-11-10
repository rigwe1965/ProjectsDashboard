// The supervisor can be imported and run with its parts passed in (registry, store, driver): no command line, no real processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../supervisor/index.mjs';
import { createSupervisor, Exit } from '../../supervisor/core.mjs';

const logDir = mkdtempSync(join(tmpdir(), 'pd-sup-'));
const registry = { apps: [
  { id: 'toy', name: 'Toy', path: '.', processes: [{ name: 'app', cmd: 'x', port: 1, health: '/' }] },
] };
// Process records in memory instead of the database
const records = {};
const store = { processState: { all: async () => structuredClone(records), set: async (a, p, r) => { (records[a] ??= {})[p] = r; }, remove: async (a, p) => { delete records[a]?.[p]; } } };
const calls = [];
const driver = { name: 'fake', startTime: () => null, startTimes: () => new Map(), listenerPid: () => null, spawnApp: () => { calls.push('spawn'); return { exited: true }; }, killTree: async () => true };

// Runs one command with console output captured; resolves { code, out }.
async function run(...argv) {
  const out = [], log = console.log, err = console.error;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  try { return { code: await main(argv, { registry, store, driver, logDir }), out: out.join('\n') }; }
  finally { console.log = log; console.error = err; }
}

test('importing the supervisor does not run a command, and status reports the injected registry', async () => {
  const { code, out } = await run('status', '--json');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out).map((r) => [r.app, r.proc, r.up]), [['toy', 'app', false]]);
});

test('an unknown app ends the command with exit code 1 and a message, without killing the process', async () => {
  const { code, out } = await run('stop', 'nope');
  assert.equal(code, 1);
  assert.match(out, /Unknown app "nope"\. Known: toy/);
});

test('a copy number the registry does not allow gives exit code 2', async () => {
  const { code, out } = await run('instance-start', 'toy', '0');
  assert.equal(code, 2);
  assert.match(out, /has no instance "0"/);
});

test('no command prints the usage and succeeds; stop with nothing recorded is a clean no-op', async () => {
  assert.match((await run()).out, /^Usage: /);
  const r = await run('stop', 'toy');
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing left running/);
});

test('the pieces are separate: createSupervisor takes its parts, and Exit carries the code', async () => {
  const sup = createSupervisor({ registry, store, driver, docker: {}, logDir });
  assert.throws(() => sup.getApp('x'), (e) => e instanceof Exit && e.code === 1);
  assert.equal(sup.getApp('toy').id, 'toy');
  assert.equal(sup.failed(), false);
  assert.deepEqual(calls, []);
  rmSync(logDir, { recursive: true, force: true });
});

test('reset of a demo that needs Docker checks the engine first, and stops nothing when Docker cannot start', async () => {
  const reg = { apps: [{ id: 'dk', name: 'Dk', path: '.', requiresDocker: true, processes: [{ name: 'app', cmd: 'x', port: 1, health: '/' }], reset: { steps: [{ cmd: 'x' }] } }] };
  const stopped = [];
  const d = { ensureEngine: async () => ({ ok: false, message: 'Docker did not start' }), containerRunning: async () => false, startContainer: async () => {}, stopContainer: async (n) => { stopped.push(n); } };
  const sup = createSupervisor({ registry: reg, store, driver, docker: d, logDir });
  await assert.rejects(() => sup.reset(sup.getApp('dk')), (e) => e instanceof Exit && e.code === 1);
  assert.deepEqual(calls, [], 'no step ran and nothing was spawned');
  assert.deepEqual(stopped, []);
});
