// Store entry point. One shared store per process, opened on first use.
//   DASHBOARD_DB=sqlite (default)  -> <data>/dashboard.db
//   DASHBOARD_DB=postgres          -> Stage 4, not implemented yet
// On first use of a new database, existing JSON data is imported automatically (the files are kept as a backup).
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { dataDir } from '../config.mjs';
import { openSqlite } from './sqlite.mjs';
import { openPostgres } from './postgres.mjs';
import { importLegacy, legacyFiles } from './legacy-import.mjs';

let opened; // Promise<store>

export function getStore() {
  opened ??= (async () => {
    const kind = process.env.DASHBOARD_DB || 'sqlite';
    const store = kind === 'postgres' ? await openPostgres() : kind === 'sqlite' ? openSqlite(join(dataDir, 'dashboard.db')) : null;
    if (!store) throw new Error(`Unknown DASHBOARD_DB "${kind}". Use sqlite or postgres.`);
    if (!process.env.DASHBOARD_SKIP_AUTOIMPORT && !(await store.meta.get('legacy_imported')) && Object.values(legacyFiles(dataDir)).some(existsSync)) {
      const r = await importLegacy(store, dataDir);
      if (r.grants || r.processes || r.audit) console.error(`Imported existing data into the database: ${r.grants} grants, ${r.processes} process records, ${r.audit} audit events (old files kept).`);
    }
    return store;
  })();
  return opened;
}

export async function closeStore() { if (opened) { const s = await opened; opened = undefined; s.close(); } }
