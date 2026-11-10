// Make a backup of the dashboard database now.   npm run backup
// Folder: DASHBOARD_BACKUP_DIR (default data/backups). Keeps the newest DASHBOARD_BACKUP_KEEP copies (default 14).
// To restore: stop the console and gateway, copy a backup over data/dashboard.db and delete data/dashboard.db-wal and -shm.
import { getStore, closeStore } from '../lib/store/index.mjs';
import { runBackup, listBackups, backupDir } from '../lib/backup.mjs';

try {
  const r = runBackup(await getStore());
  if (r.skipped) console.log(`No backup made: ${r.skipped}.`);
  else console.log(`Backup written: ${r.file}\n${listBackups().length} kept in ${backupDir()}${r.removed.length ? ` (${r.removed.length} older removed)` : ''}.`);
} catch (e) {
  console.error(`Backup failed: ${e.message}`);
  process.exitCode = 1;
} finally { await closeStore(); }
