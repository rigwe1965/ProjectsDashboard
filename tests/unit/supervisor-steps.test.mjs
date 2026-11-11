// Failure paths of the supervisor's three step runners: `build`, `reset` and `instance-start` (the prepare steps).
// These pin today's behaviour (messages, exit codes, log lines) so the three loops can be merged into one runner (audit D-03)
// without changing what an operator sees. tests/unit/reset-steps.test.mjs covers the happy paths and a failing or hanging reset step.
import { test, after } from 'node:test';
import { testEnv } from '../helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pd-steps-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const node = (js) => `"${process.execPath}" -e "${js}"`;
const sh = (args, registry) => {
  const reg = join(dir, 'registry.json'); writeFileSync(reg, JSON.stringify(registry));
  return spawnSync(process.execPath, [fileURLToPath(new URL('../../supervisor/index.mjs', import.meta.url)), ...args],
    { env: testEnv({ DASHBOARD_DATA: join(dir, 'data'), DASHBOARD_REGISTRY: reg }), encoding: 'utf8' });
};
const log = (name) => readFileSync(join(dir, 'data', 'logs', name), 'utf8');
const base = { id: 'x', name: 'X', path: dir, processes: [{ name: 'app', cmd: 'x', port: 19301 }] };
// a demo with a build block, a reset block and per-link copies; each test passes only the part it is about
const registry = ({ build, reset, perLink, processes } = {}) => ({ apps: [base, {
  id: 'x-demo', name: 'X demo', path: dir, demoOf: 'x', demoReady: true, processes: processes ?? [{ name: 'app', cmd: 'x', port: 19302 }],
  ...(build ? { build } : {}), ...(reset ? { reset: { steps: reset } } : {}), ...(perLink ? { perLink: { max: 2, portBase: 19400, prepare: [], ...perLink } } : {}),
}] });

// ---- build
test('build: a command that exits non-zero fails, and the log records the exit code', () => {
  const r = sh(['build', 'x-demo'], registry({ build: { cmd: node("console.log('compiling');process.exit(2)") } }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Building x-demo/); assert.match(r.stdout, /FAILED \(exit 2\); see data\/logs\/x-demo-build\.log/);
  assert.match(log('x-demo-build.log'), /build: exit 2\r?\ncompiling/);
});

test('build: a command that outlives its timeout is stopped and reported as timed out', () => {
  const r = sh(['build', 'x-demo'], registry({ build: { cmd: node('setTimeout(()=>{},60000)'), timeoutSec: 1 } }));
  assert.equal(r.status, 1); assert.match(r.stdout, /FAILED \(timed out\)/);
  assert.match(log('x-demo-build.log'), /build: exit timed out/);
});

test('build: a missing working folder or env file is reported before anything runs', () => {
  const cwd = sh(['build', 'x-demo'], registry({ build: { cmd: node('0'), cwd: 'no-such-folder' } }));
  assert.equal(cwd.status, 1); assert.match(cwd.stderr, /Working directory not found: .*no-such-folder/);
  const env = sh(['build', 'x-demo'], registry({ build: { cmd: node('0'), envFile: 'data/no-such.env' } }));
  assert.equal(env.status, 1); assert.match(env.stderr, /Env file missing for x-demo: data\/no-such\.env/);
});

test('build: a successful build gets the registry env and logs exit 0', () => {
  rmSync(join(dir, 'built.txt'), { force: true });
  const r = sh(['build', 'x-demo'], registry({ build: { cmd: node("require('fs').writeFileSync('built.txt',process.env.MARK)"), env: { MARK: 'yes' } } }));
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, / done/);
  assert.equal(readFileSync(join(dir, 'built.txt'), 'utf8'), 'yes');
  assert.match(log('x-demo-build.log'), /build: exit 0/);
});

// ---- reset (the paths the other file does not cover)
test('reset: a missing working folder or env file stops the sequence and fails', () => {
  rmSync(join(dir, 'after.txt'), { force: true });
  const cwd = sh(['reset', 'x-demo'], registry({ reset: [{ cmd: node('0'), cwd: 'no-such-folder' }, { cmd: node("require('fs').writeFileSync('after.txt','x')") }] }));
  assert.equal(cwd.status, 1); assert.match(cwd.stderr, /Reset step 1: working directory not found: .*no-such-folder/);
  const env = sh(['reset', 'x-demo'], registry({ reset: [{ cmd: node('0'), envFile: 'data/no-such.env' }] }));
  assert.equal(env.status, 1); assert.match(env.stderr, /Reset step 1: Env file missing for x-demo: data\/no-such\.env/);
  assert.ok(!existsSync(join(dir, 'after.txt')), 'the second step never ran');
});

test('reset: each step is logged with its number and exit code', () => {
  const r = sh(['reset', 'x-demo'], registry({ reset: [{ cmd: node('0') }, { cmd: node('process.exit(5)') }] }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Reset x-demo step 1\/2\.\.\. ok/); assert.match(r.stdout, /Reset x-demo step 2\/2\.\.\. FAILED \(exit 5\); see data\/logs\/x-demo-reset\.log/);
  const text = log('x-demo-reset.log');
  assert.match(text, /step 1: exit 0/); assert.match(text, /step 2: exit 5/);
});

// ---- instance-start / instance-stop
test('instance-start: a slot that does not exist, or an app without perLink, is refused with exit code 2', () => {
  const reg = registry({ perLink: {} });
  const slot = sh(['instance-start', 'x-demo', '7'], reg);
  assert.equal(slot.status, 2); assert.match(slot.stderr, /x-demo has no instance "7"/);
  const plain = sh(['instance-start', 'x', '0'], reg);
  assert.equal(plain.status, 2); assert.match(plain.stderr, /x has no instance "0"/);
  const stop = sh(['instance-stop', 'x-demo', '9'], reg);
  assert.equal(stop.status, 2);
});

test('instance-start: a failing prepare step stops there, is logged, and the next step does not run', () => {
  const reg = registry({ perLink: { prepare: [{ cmd: node('process.exit(4)') }, { cmd: node("require('fs').writeFileSync('p2.txt','x')") }] } });
  rmSync(join(dir, 'p2.txt'), { force: true });
  const r = sh(['instance-start', 'x-demo', '0'], reg);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Prepare step 1\/2 FAILED \(exit 4\); see data\/logs\/x-demo\.i0-prepare\.log/);
  assert.ok(!existsSync(join(dir, 'p2.txt')), 'step 2 did not run');
  assert.match(log('x-demo.i0-prepare.log'), /prepare 1: exit 4/);
  assert.ok(existsSync(join(dir, 'data', 'instances', 'x-demo', '0')), 'the fresh data folder was made before the steps');
});

test('instance-start: a prepare step that hangs is cut off', () => {
  const r = sh(['instance-start', 'x-demo', '0'], registry({ perLink: { prepare: [{ cmd: node('setTimeout(()=>{},60000)'), timeoutSec: 1 }] } }));
  assert.equal(r.status, 1); assert.match(r.stdout, /Prepare step 1\/1 FAILED \(timed out\)/);
  assert.match(log('x-demo.i0-prepare.log'), /prepare 1: exit timed out/);
});

test('instance-start: a missing working folder or env file in a prepare step fails with the step number', () => {
  const cwd = sh(['instance-start', 'x-demo', '0'], registry({ perLink: { prepare: [{ cmd: node('0'), cwd: 'no-such-folder' }] } }));
  assert.equal(cwd.status, 1); assert.match(cwd.stderr, /Prepare step 1: working directory not found: .*no-such-folder/);
  const env = sh(['instance-start', 'x-demo', '0'], registry({ perLink: { prepare: [{ cmd: node('0'), envFile: 'data/no-such.env' }] } }));
  assert.equal(env.status, 1); assert.match(env.stderr, /Prepare step 1: Env file missing for x-demo\.i0: data\/no-such\.env/);
});

test('instance-start: prepare steps get {inst}, {port:name} and the merged perLink and step env; instance-stop removes the folder', () => {
  const out = join(dir, 'prep.txt').split('\\').join('/');
  const reg = registry({
    perLink: { env: { A: 'a' }, prepare: [{ cmd: node(`require('fs').appendFileSync('${out}',process.env.A+process.env.B+'|{inst}|')`), env: { B: 'b{port:app}' } }] },
    processes: [{ name: 'app', cmd: node('process.exit(0)'), port: 19302 }],
  });
  rmSync(join(dir, 'prep.txt'), { force: true });
  const r = sh(['instance-start', 'x-demo', '1'], reg);
  // the copy's own process exits at once, so the command as a whole reports a failed start, but the prepare step has already run
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const inst = join(dir, 'data', 'instances', 'x-demo', '1').split('\\').join('/');
  assert.equal(readFileSync(join(dir, 'prep.txt'), 'utf8'), `ab19410|${inst}|`, 'port is portBase + slot*10 + process index');
  assert.match(log('x-demo.i1-prepare.log'), /prepare 1: exit 0/);
  const stop = sh(['instance-stop', 'x-demo', '1'], reg);
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  assert.ok(!existsSync(join(dir, 'data', 'instances', 'x-demo', '1')), 'the copy\'s folder is deleted');
});
