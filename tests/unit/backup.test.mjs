import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite } from '../../lib/store/sqlite.mjs';
import { runBackup, listBackups, newestBackupAge } from '../../lib/backup.mjs';

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-backup-'));
  const store = openSqlite(join(dir, 'db.sqlite'));
  return { dir, store, bdir: join(dir, 'backups'), done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
};

test('backup: the copy opens as a database with the same data, and nothing is left half-written', () => {
  const { store, bdir, done } = setup();
  store.meta.set('hello', 'world');
  const r = runBackup(store, { dir: bdir, now: new Date('2026-11-10T15:30:00Z') });
  assert.match(r.file, /dashboard-20261110-153000\.db$/);
  const copy = openSqlite(r.file);
  assert.equal(copy.meta.get('hello'), 'world');
  copy.close();
  assert.deepEqual(readdirSync(bdir).filter((f) => f.endsWith('.tmp')), []);
  done();
});

test('backup: keeps the newest N, deletes only its own files, and two in one second do not collide', () => {
  const { store, bdir, done } = setup();
  const t = (s) => new Date(Date.UTC(2026, 10, 10, 12, 0, s));
  for (let s = 0; s < 4; s++) runBackup(store, { dir: bdir, keep: 3, now: t(s) });
  writeFileSync(join(bdir, 'notes.txt'), 'mine');
  const r = runBackup(store, { dir: bdir, keep: 3, now: t(5) });
  assert.equal(r.removed.length, 1);
  assert.deepEqual(listBackups(bdir).length, 3);
  assert.equal(listBackups(bdir).at(-1), 'dashboard-20261110-120005.db');
  assert.ok(existsSync(join(bdir, 'notes.txt')), 'files that are not ours stay');
  done();
});

test('backup: skipped for a store without backup(); age is Infinity with no backups and small after one', () => {
  assert.match(runBackup({}, { dir: 'unused' }).skipped, /pg_dump/);
  const { store, bdir, done } = setup();
  assert.equal(newestBackupAge(bdir), Infinity);
  runBackup(store, { dir: bdir });
  assert.ok(newestBackupAge(bdir) < 60000);
  done();
});
