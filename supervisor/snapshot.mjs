// A "golden copy" of a demo instance's data files, and putting it back. For demos that keep their state in local files (SQLite,
// a vector store folder), where the seed procedure is not something to re-run: save the demo once, in the state customers
// should always start from, and a reset restores exactly that.
//   node supervisor/snapshot.mjs take <app-id>       save the registry's "snapshot.paths" (the demo must be stopped)
//   node supervisor/snapshot.mjs restore <app-id>    replace the live files with the saved copy
//   node supervisor/snapshot.mjs info <app-id>       when the copy was taken and what it holds
// The copy lives in data/demo-golden/<app-id>/. Every path (live and saved) must be inside the dashboard's data/ folder.
// A SQLite file's -wal and -shm companions are saved and restored with it, so no half-written state survives a restore.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { root, dataDir } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { checkPath } from './reset-fs.mjs';

const goldenRoot = join(root, 'data', 'demo-golden');
const withCompanions = (p) => /\.(db|sqlite3?)$/i.test(p) ? [p, p + '-wal', p + '-shm'] : [p];

export function goldenDir(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid app id');
  return join(goldenRoot, id);
}
export function targets(app) {
  const paths = app.snapshot?.paths;
  if (!Array.isArray(paths) || !paths.length) throw new Error(`${app.id} has no "snapshot.paths" in the registry`);
  return paths.map((p) => checkPath(resolve(app.path, p)));
}

export function take(app) {
  const dir = goldenDir(app.id);
  const next = dir + '.new'; // built aside, so a failure never destroys the previous copy
  rmSync(next, { recursive: true, force: true }); mkdirSync(next, { recursive: true });
  const items = [];
  for (const [i, target] of targets(app).entries()) {
    for (const src of withCompanions(target)) {
      if (!existsSync(src)) continue;
      const stored = `${items.length}-${basename(src)}`;
      cpSync(src, join(next, stored), { recursive: true });
      items.push({ target: src, stored, dir: lstatSync(src).isDirectory(), group: i });
    }
  }
  if (!items.length) { rmSync(next, { recursive: true, force: true }); throw new Error('None of the snapshot paths exist, so there is nothing to save'); }
  writeFileSync(join(next, 'manifest.json'), JSON.stringify({ app: app.id, takenAt: new Date().toISOString(), declared: targets(app), items }, null, 2));
  rmSync(dir, { recursive: true, force: true });
  cpSync(next, dir, { recursive: true }); rmSync(next, { recursive: true, force: true });
  return items.length;
}

export function manifest(app) {
  const f = join(goldenDir(app.id), 'manifest.json');
  if (!existsSync(f)) throw new Error(`There is no saved copy of ${app.id}. Save one when the demo is in the state customers should start from: node supervisor/snapshot.mjs take ${app.id}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

export function restore(app) {
  const m = manifest(app);
  const dir = goldenDir(app.id);
  const allowed = new Set(targets(app).flatMap(withCompanions)); // the saved copy may only write where the registry says
  for (const it of m.items) if (!allowed.has(it.target)) throw new Error(`The saved copy wants to write ${it.target}, which the registry no longer lists. Take a new copy.`);
  for (const d of targets(app)) for (const f of withCompanions(d)) rmSync(f, { recursive: true, force: true }); // including companions the copy does not have
  for (const it of m.items) cpSync(join(dir, it.stored), it.target, { recursive: true });
  return { count: m.items.length, takenAt: m.takenAt };
}

// Copy the saved data into a folder of its own (a per-customer copy of the demo), under the same file names. Only folders inside
// data/instances/ are accepted; the live demo's files are not touched.
export function restoreTo(app, dest) {
  const abs = resolve(dest);
  if (!abs.startsWith(resolve(dataDir, 'instances') + sep)) throw new Error(`Refusing to write ${abs}: it is not inside the instances folder`);
  const m = manifest(app);
  const dir = goldenDir(app.id);
  const allowed = new Set(targets(app).flatMap(withCompanions));
  for (const it of m.items) if (!allowed.has(it.target)) throw new Error(`The saved copy wants ${it.target}, which the registry no longer lists. Take a new copy.`);
  mkdirSync(abs, { recursive: true });
  for (const it of m.items) cpSync(join(dir, it.stored), join(abs, basename(it.target)), { recursive: true });
  return { count: m.items.length, takenAt: m.takenAt };
}

if (process.argv[1]?.endsWith('snapshot.mjs')) {
  const [cmd, id, dest] = process.argv.slice(2);
  try {
    const app = loadRegistry().apps.find((a) => a.id === id);
    if (!app) throw new Error(`Unknown app "${id ?? ''}"`);
    if (cmd === 'take') console.log(`Saved ${take(app)} item(s) as the golden copy of ${id}.`);
    else if (cmd === 'restore') { const r = restore(app); console.log(`Restored ${r.count} item(s) from the copy taken ${r.takenAt}.`); }
    else if (cmd === 'restore-to' && dest) { const r = restoreTo(app, dest); console.log(`Copied ${r.count} item(s) from the copy taken ${r.takenAt} into ${dest}.`); }
    else if (cmd === 'info') { const m = manifest(app); console.log(`${id}: copy taken ${m.takenAt}, ${m.items.length} item(s).`); }
    else { console.error('Usage: snapshot.mjs take|restore|restore-to|info <app-id> [folder]'); process.exitCode = 2; }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
