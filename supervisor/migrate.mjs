// Import the old JSON data (demos.json, state.json, demo-access.log) into the database and verify the result.
//   node supervisor/migrate.mjs --dry-run   shows what would be imported, writes nothing
//   node supervisor/migrate.mjs             imports (safe to repeat), then verifies every old grant
// The old files are never modified or deleted; they stay as a backup. (The database also imports them
// automatically the first time it is opened, so running this by hand is optional.)
import { existsSync, readFileSync } from 'node:fs';
import { dataDir } from '../lib/config.mjs';
import { getStore, closeStore } from '../lib/store/index.mjs';
import { importLegacy, legacyFiles } from '../lib/store/legacy-import.mjs';

const dryRun = process.argv.includes('--dry-run');
if (dryRun) process.env.DASHBOARD_SKIP_AUTOIMPORT = '1'; // a dry run must not trigger the automatic first-open import
const store = await getStore(); // may already have auto-imported
const r = await importLegacy(store, dataDir, { dryRun });
console.log(`${dryRun ? 'Would import' : 'Imported'}: ${r.grants} grants, ${r.processes} process records, ${r.audit} audit events${r.skippedAudit ? ' (audit log was already imported earlier)' : ''}.`);

// Verify: every grant in the old file exists in the database with the same token hash and state.
if (dryRun) { console.log('Dry run: nothing was written, so nothing to verify.'); await closeStore(); process.exit(0); }
const f = legacyFiles(dataDir).grants;
let bad = 0, checked = 0;
if (existsSync(f)) {
  for (const g of JSON.parse(readFileSync(f, 'utf8'))) {
    checked++;
    const db = await store.grants.findByHash(g.tokenHash);
    const same = db && db.id === g.id && db.app === g.app && db.customer === g.customer && db.expiresAt === g.expiresAt && db.revoked === !!g.revoked;
    if (!same) { bad++; console.log(`  MISMATCH or missing: grant ${g.id} (${g.app})`); }
  }
}
console.log(`Verified ${checked - bad}/${checked} old grants match the database${bad ? ` - ${bad} PROBLEM(S)` : ''}.`);
console.log(`Database now holds ${(await store.grants.list()).length} grants and ${await store.audit.count()} audit events.`);
await closeStore();
if (bad) process.exitCode = 1;
