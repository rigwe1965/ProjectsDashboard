// One-time import of the old JSON files (demos.json, state.json, demo-access.log) into the store.
// It never modifies or deletes those files: they stay as a backup. Safe to run more than once
// (grants are matched by id, process state by app+proc, and the audit log is imported only once).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };

export function legacyFiles(dataDir) {
  return { grants: join(dataDir, 'demos.json'), state: join(dataDir, 'state.json'), audit: join(dataDir, 'demo-access.log') };
}

// Returns counts. With dryRun it only reports what WOULD be imported.
export async function importLegacy(store, dataDir, { dryRun = false } = {}) {
  const f = legacyFiles(dataDir);
  const out = { grants: 0, processes: 0, audit: 0, skippedAudit: false };

  const existing = new Set((await store.grants.list()).map((g) => g.id));
  for (const g of existsSync(f.grants) ? readJson(f.grants, []) : []) {
    if (!g?.id || !g.tokenHash || existing.has(g.id)) continue;
    out.grants++;
    if (!dryRun) await store.grants.insert({ id: g.id, tokenHash: g.tokenHash, customer: g.customer, app: g.app,
      createdAt: g.createdAt, expiresAt: g.expiresAt, revoked: !!g.revoked });
  }

  const state = existsSync(f.state) ? readJson(f.state, {}) : {};
  const current = await store.processState.all();
  for (const [app, procs] of Object.entries(state)) {
    for (const [proc, rec] of Object.entries(procs ?? {})) {
      if (current[app]?.[proc]) continue;
      out.processes++;
      if (!dryRun) await store.processState.set(app, proc, rec);
    }
  }

  if (existsSync(f.audit)) {
    if (await store.meta.get('legacy_audit_imported')) out.skippedAudit = true;
    else {
      const events = [];
      for (const line of readFileSync(f.audit, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { const e = JSON.parse(line); if (e?.ev) events.push(e); } catch { /* skip a damaged line */ }
      }
      out.audit = events.length;
      if (!dryRun) {
        await store.audit.addMany(events);
        await store.meta.set('legacy_audit_imported', new Date().toISOString());
      }
    }
  }
  if (!dryRun) await store.meta.set('legacy_imported', new Date().toISOString());
  return out;
}
