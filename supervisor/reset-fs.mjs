// File steps for a demo reset (used from the registry's "reset" block).
//   node supervisor/reset-fs.mjs clear-dir <dir>    empty a folder (the folder itself is kept)
//   node supervisor/reset-fs.mjs delete <file>      delete one file (a missing file is fine)
// Safety: it only touches paths inside the dashboard's own data folder (<project>/data, where the demo clones live, or DASHBOARD_DATA, where
// the private copies live), below the first level, and never the demo clones' root.
import { existsSync, mkdirSync, readdirSync, rmSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute, dirname } from 'node:path';
import { root, dataDir } from '../lib/config.mjs';

// The folders a step may work in: <project>/data (demo clones, saved copies) and DASHBOARD_DATA (private copies). The same folder unless that is set.
export const dataRoots = () => [...new Set([join(root, 'data'), resolve(dataDir)])];

export function checkPath(p) {
  const abs = resolve(p);
  // isAbsolute(rel): on Windows a path on another drive or a network share has no relative form, so `relative` returns it whole
  const inside = (r) => { const rel = relative(r, abs); return !!rel && !isAbsolute(rel) && !rel.startsWith('..') && resolve(r, rel) === abs; };
  const dataRoot = dataRoots().find(inside);
  if (!dataRoot) throw new Error(`Refusing to touch ${abs}: it is not inside ${dataRoots().join(' or ')}`); // audit F-17
  const rel = relative(dataRoot, abs);
  const parts = rel.split(sep);
  if (parts.length < 2) throw new Error(`Refusing to touch ${abs}: too close to the top of ${dataRoot}`);
  if (parts[0] === 'demo-src' && parts.length < 3) throw new Error(`Refusing to touch ${abs}: that is a whole demo clone`);
  // Symlinks and junctions: the real location of the closest existing part of the path must still be inside data/
  mkdirSync(dataRoot, { recursive: true });
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const realRel = relative(realpathSync(dataRoot), realpathSync(probe));
  if (isAbsolute(realRel) || realRel === '..' || realRel.startsWith('..' + sep)) throw new Error(`Refusing to touch ${abs}: it leads outside ${dataRoot} through a link`);
  return abs;
}

export function clearDir(dir) {
  const abs = checkPath(dir);
  if (!existsSync(abs)) { mkdirSync(abs, { recursive: true }); return 0; }
  if (!lstatSync(abs).isDirectory()) throw new Error(`${abs} is not a folder`);
  let n = 0;
  for (const name of readdirSync(abs)) { rmSync(join(abs, name), { recursive: true, force: true }); n++; }
  return n;
}
export function deleteFile(file) {
  const abs = checkPath(file);
  if (!existsSync(abs)) return false;
  if (lstatSync(abs).isDirectory()) throw new Error(`${abs} is a folder, not a file`);
  rmSync(abs, { force: true });
  return true;
}

if (process.argv[1]?.endsWith('reset-fs.mjs')) {
  const [cmd, target] = process.argv.slice(2);
  try {
    if (cmd === 'clear-dir' && target) console.log(`Emptied ${target} (${clearDir(target)} items removed)`);
    else if (cmd === 'delete' && target) console.log(deleteFile(target) ? `Deleted ${target}` : `${target} was not there`);
    else { console.error('Usage: reset-fs.mjs clear-dir <dir> | delete <file>'); process.exitCode = 2; }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
