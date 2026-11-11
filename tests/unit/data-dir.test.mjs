// The snapshot and file-reset tools follow DASHBOARD_DATA like the rest of the dashboard, and the golden copy cannot be lost midway (audit F-17).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'pd-dd-'));      // DASHBOARD_DATA: somewhere other than <project>/data
const elsewhere = mkdtempSync(join(tmpdir(), 'pd-dd-other-'));
process.env.DASHBOARD_DATA = data;                       // before the tools are imported
const { checkPath, clearDir } = await import('../../supervisor/reset-fs.mjs');
const snap = await import('../../supervisor/snapshot.mjs');
const { root } = await import('../../lib/config.mjs');
after(() => { rmSync(data, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); rmSync(join(root, 'data', '_dd-test-' + process.pid), { recursive: true, force: true }); });

test('checkPath accepts DASHBOARD_DATA and <project>/data, and nothing else', () => {
  assert.doesNotThrow(() => checkPath(join(data, 'instances', 'x', '0', 'f.db')), 'a private copy folder under DASHBOARD_DATA');
  assert.doesNotThrow(() => checkPath(join(root, 'data', 'demo-src', 'crm', 'x.db')), 'a demo clone under <project>/data');
  assert.throws(() => checkPath(join(elsewhere, 'x', 'f.db')), /Refusing/);
  assert.throws(() => checkPath(join(data, 'top')), /too close to the top/, 'the first-level rule still applies in the new root');
  assert.throws(() => checkPath(join(root, 'data', 'demo-src', 'crm')), /whole demo clone/);
  assert.throws(() => checkPath(join(data, '..', 'pd-dd-other-x', 'a', 'b')), /Refusing/, 'a sibling that merely shares a prefix');
});

test('clear-dir works inside DASHBOARD_DATA', () => {
  const d = join(data, 'instances', 'x', '1'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'a.txt'), 'x');
  assert.equal(clearDir(d), 1);
});

test('the golden copy lives under DASHBOARD_DATA, and restore-to a private copy works with it', () => {
  assert.equal(snap.goldenDir('demo1'), join(data, 'demo-golden', 'demo1'));
  const work = join(root, 'data', '_dd-test-' + process.pid, 'work'); // a demo clone's files stay under <project>/data
  mkdirSync(work, { recursive: true }); writeFileSync(join(work, 'live.db'), 'GOOD');
  const app = { id: 'demo1', path: work, snapshot: { paths: ['live.db'] }, processes: [] };
  assert.equal(snap.take(app), 1);
  const dest = join(data, 'instances', 'demo1', '0');
  assert.equal(snap.restoreTo(app, dest).count, 1);
  assert.equal(readFileSync(join(dest, 'live.db'), 'utf8'), 'GOOD');
  assert.throws(() => snap.restoreTo(app, join(elsewhere, 'x')), /not inside the instances folder/);
});

test('take replaces the old copy by renaming: the previous copy survives an interruption (audit F-17)', () => {
  const work = join(root, 'data', '_dd-test-' + process.pid, 'work2'); mkdirSync(work, { recursive: true });
  const app = { id: 'demo2', path: work, snapshot: { paths: ['live.db'] }, processes: [] };
  writeFileSync(join(work, 'live.db'), 'ONE'); snap.take(app);
  writeFileSync(join(work, 'live.db'), 'TWO'); snap.take(app);
  const dir = snap.goldenDir('demo2');
  assert.equal(existsSync(dir + '.old') || existsSync(dir + '.new'), false, 'no leftovers after a normal take');
  assert.equal(snap.manifest(app).items.length, 1);
  // killed between the two renames: only <dir>.old exists. The next read puts it back instead of reporting "no saved copy".
  renameSync(dir, dir + '.old');
  assert.equal(existsSync(dir), false);
  assert.equal(snap.manifest(app).app, 'demo2');
  assert.equal(existsSync(dir), true, 'recovered');
  writeFileSync(join(work, 'live.db'), 'DIRTY');
  assert.equal(snap.restore(app).count, 1);
  assert.equal(readFileSync(join(work, 'live.db'), 'utf8'), 'TWO', 'and it restores the copy that was saved');
});

test('take refuses while the demo answers on its port', async () => {
  const srv = http.createServer((q, s) => s.end('ok'));
  const port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  try {
    await assert.rejects(() => snap.assertStopped({ id: 'x', processes: [{ name: 'app', port, health: '/' }] }), /is running .* Stop it first/);
    await assert.doesNotReject(() => snap.assertStopped({ id: 'x', processes: [{ name: 'app', port, health: '/', optional: true }] }), 'an optional process is not asked');
  } finally { await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }); }
  await assert.doesNotReject(() => snap.assertStopped({ id: 'x', processes: [{ name: 'app', port, health: '/' }] }), 'stopped: allowed');
});
