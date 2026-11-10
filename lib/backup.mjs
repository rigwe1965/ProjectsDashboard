// Dated copies of the dashboard database (grants, audit log, admin password hash and 2-step secret).
// SQLite only: the Postgres store has no backup() and is backed up with pg_dump or the provider's own tools.
// Each copy is made with VACUUM INTO (consistent while the gateway and console are writing), written under a temporary name
// and renamed when complete, so a half-written file is never mistaken for a backup. Only files named like our own are ever deleted.
import { mkdirSync, renameSync, readdirSync, rmSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.mjs';
import { num } from './util.mjs';

export const backupDir = () => process.env.DASHBOARD_BACKUP_DIR || join(dataDir, 'backups');
export const backupKeep = () => Math.max(1, num(process.env.DASHBOARD_BACKUP_KEEP, 14));

const NAME = /^dashboard-\d{8}-\d{6}\.db$/;
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-'); // 20261110-153000

export function listBackups(dir = backupDir()) {
  try { return readdirSync(dir).filter((f) => NAME.test(f)).sort(); } catch { return []; }
}

// Returns { file, removed } or { skipped: reason }.
export function runBackup(store, { dir = backupDir(), keep = backupKeep(), now = new Date() } = {}) {
  if (typeof store.backup !== 'function') return { skipped: 'this database type has no built-in backup (use pg_dump)' };
  mkdirSync(dir, { recursive: true });
  const name = `dashboard-${stamp(now)}.db`;
  const final = join(dir, name);
  const tmp = join(dir, `${name}.tmp`);
  rmSync(tmp, { force: true });
  try {
    store.backup(tmp);
    try { chmodSync(tmp, 0o600); } catch { /* best effort where the system has no file modes */ }
    renameSync(tmp, final);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
  const all = listBackups(dir);
  const removed = all.slice(0, Math.max(0, all.length - keep));
  for (const f of removed) rmSync(join(dir, f), { force: true });
  return { file: final, removed };
}

// Age in ms of the newest backup, or Infinity when there is none.
export function newestBackupAge(dir = backupDir(), now = Date.now()) {
  const last = listBackups(dir).at(-1);
  if (!last) return Infinity;
  try { return now - statSync(join(dir, last)).mtimeMs; } catch { return Infinity; }
}
