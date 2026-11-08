// The reset steps themselves: `supervisor reset <id>` runs the registry's steps in order, and reset-fs.mjs only touches data/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPath, clearDir, deleteFile } from '../../supervisor/reset-fs.mjs';
import { root } from '../../lib/config.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-rs-'));
const scratchTop = join(root, 'data', '_reset-fs-test-' + process.pid), scratch = join(scratchTop, 'work'); // reset-fs only works inside data/
after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(scratchTop, { recursive: true, force: true }); rmSync(join(root, 'data', 'demo-golden', 'snaptest-' + process.pid), { recursive: true, force: true }); });

test('reset-fs: empties and deletes inside data/, refuses everything else', () => {
  mkdirSync(join(scratch, 'sub'), { recursive: true });
  writeFileSync(join(scratch, 'a.txt'), '1'); writeFileSync(join(scratch, 'sub', 'b.txt'), '2');
  assert.equal(clearDir(scratch), 2);
  assert.ok(existsSync(scratch) && !existsSync(join(scratch, 'a.txt')), 'the folder stays, its contents go');
  writeFileSync(join(scratch, 'c.txt'), '3');
  assert.equal(deleteFile(join(scratch, 'c.txt')), true);
  assert.equal(deleteFile(join(scratch, 'c.txt')), false, 'a missing file is fine');
  assert.equal(clearDir(join(scratch, 'new')), 0, 'a missing folder is created');
  for (const bad of [root, join(root, 'data'), join(root, 'data', 'demo-src'), join(root, 'data', 'demo-src', 'crm'), join(root, 'lib'), join(root, 'data', '..', 'lib', 'x'), tmpdir(), 'C:/', '/']) {
    assert.throws(() => checkPath(bad), /Refusing/, bad);
  }
  assert.doesNotThrow(() => checkPath(join(root, 'data', 'demo-src', 'crm', 'x.db')));
});

function supervisor(args, registry) {
  const reg = join(dir, 'registry.json'); writeFileSync(reg, JSON.stringify(registry));
  return spawnSync(process.execPath, [fileURLToPath(new URL('../../supervisor/index.mjs', import.meta.url)), ...args],
    { env: { ...process.env, DASHBOARD_DATA: join(dir, 'data'), DASHBOARD_REGISTRY: reg }, encoding: 'utf8' });
}
const node = (js) => `"${process.execPath}" -e "${js}"`;
const demo = (steps, extra = {}) => ({ apps: [
  { id: 'x', name: 'X', path: dir, processes: [{ name: 'app', cmd: 'x', port: 19201 }] },
  { id: 'x-demo', name: 'X demo', path: dir, demoOf: 'x', demoReady: true, processes: [{ name: 'app', cmd: 'x', port: 19202 }], reset: { steps }, ...extra },
] });

test('supervisor reset: runs the steps in order, with env from the registry, and logs their output', () => {
  const r = supervisor(['reset', 'x-demo'], demo([
    { cmd: node("require('fs').writeFileSync('one.txt','a')") },
    { cmd: node("require('fs').appendFileSync('one.txt',process.env.MARK+'{port:app}')"), env: { MARK: 'm' } },
  ]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(dir, 'one.txt'), 'utf8'), 'am19202', 'steps ran in order and {port:app} was filled in');
  assert.match(r.stdout, /was reset to its seeded state/);
  assert.ok(existsSync(join(dir, 'data', 'logs', 'x-demo-reset.log')));
});

test('supervisor reset: a failing step stops the sequence and the exit code says so', () => {
  rmSync(join(dir, 'two.txt'), { force: true });
  const r = supervisor(['reset', 'x-demo'], demo([
    { cmd: node('process.exit(3)') },
    { cmd: node("require('fs').writeFileSync('two.txt','no')") },
  ]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAILED \(exit 3\)/);
  assert.ok(!existsSync(join(dir, 'two.txt')), 'later steps did not run');
});

test('supervisor reset: a step that hangs is cut off; an app without a reset block is refused', () => {
  const r = supervisor(['reset', 'x-demo'], demo([{ cmd: node('setTimeout(()=>{},60000)'), timeoutSec: 1 }]));
  assert.equal(r.status, 1); assert.match(r.stdout, /timed out/);
  const none = supervisor(['reset', 'x'], demo([{ cmd: 'x' }]));
  assert.equal(none.status, 1); assert.match(none.stderr, /no "reset"/);
});

test('supervisor build: runs the build command; start refuses until what it produces exists', () => {
  const built = join(dir, 'out', 'BUILD_ID');
  rmSync(join(dir, 'out'), { recursive: true, force: true });
  const reg = demo([{ cmd: 'x' }], { build: { cmd: node("require('fs').mkdirSync('out');require('fs').writeFileSync('out/BUILD_ID','1')"), produces: 'out/BUILD_ID' } });
  const early = supervisor(['start', 'x-demo'], reg);
  assert.equal(early.status, 1); assert.match(early.stderr, /has not been built yet.*build x-demo/);
  const b = supervisor(['build', 'x-demo'], reg);
  assert.equal(b.status, 0, b.stdout + b.stderr); assert.match(b.stdout, /done/);
  assert.ok(existsSync(built));
  const none = supervisor(['build', 'x'], reg);
  assert.equal(none.status, 1); assert.match(none.stderr, /no "build"/);
  const bad = supervisor(['build', 'x-demo'], demo([{ cmd: 'x' }], { build: { cmd: node('process.exit(2)') } }));
  assert.equal(bad.status, 1); assert.match(bad.stdout, /FAILED \(exit 2\)/);
});


test('snapshot: a saved copy is restored exactly, including SQLite companions, and stray files are removed', async () => {
  const { take, restore, manifest, goldenDir } = await import('../../supervisor/snapshot.mjs');
  const app = { id: 'snaptest-' + process.pid, path: scratch, snapshot: { paths: ['live.db', 'store'] } };
  mkdirSync(join(scratch, 'store'), { recursive: true });
  writeFileSync(join(scratch, 'live.db'), 'GOOD-DB'); writeFileSync(join(scratch, 'live.db-wal'), 'GOOD-WAL');
  writeFileSync(join(scratch, 'store', 'a.txt'), 'GOOD-A');
  assert.throws(() => manifest(app), /no saved copy/);
  assert.equal(take(app), 3);
  // a customer uses the demo
  writeFileSync(join(scratch, 'live.db'), 'DIRTY'); rmSync(join(scratch, 'live.db-wal')); writeFileSync(join(scratch, 'live.db-shm'), 'STRAY-SHM');
  writeFileSync(join(scratch, 'store', 'a.txt'), 'DIRTY-A'); writeFileSync(join(scratch, 'store', 'new.txt'), 'new');
  assert.equal(restore(app).count, 3);
  assert.equal(readFileSync(join(scratch, 'live.db'), 'utf8'), 'GOOD-DB');
  assert.equal(readFileSync(join(scratch, 'live.db-wal'), 'utf8'), 'GOOD-WAL');
  assert.equal(existsSync(join(scratch, 'live.db-shm')), false, 'a companion the copy does not have is removed');
  assert.equal(readFileSync(join(scratch, 'store', 'a.txt'), 'utf8'), 'GOOD-A');
  assert.equal(existsSync(join(scratch, 'store', 'new.txt')), false, 'files added since are gone');
  // the registry decides where a copy may be written
  assert.throws(() => restore({ ...app, snapshot: { paths: ['store'] } }), /no longer lists/);
  assert.throws(() => take({ ...app, snapshot: { paths: ['../../../lib'] } }), /Refusing/);
  assert.throws(() => take({ ...app, snapshot: { paths: ['nothing-here'] } }), /nothing to save/);
  rmSync(goldenDir(app.id), { recursive: true, force: true });
});
