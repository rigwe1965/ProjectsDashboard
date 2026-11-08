// File steps for a demo reset (used from the registry's "reset" block).
//   node supervisor/reset-fs.mjs clear-dir <dir>    empty a folder (the folder itself is kept)
//   node supervisor/reset-fs.mjs delete <file>      delete one file (a missing file is fine)
// Safety: it only touches paths inside the dashboard's own data/ folder, below the first level, and never the demo clones' root.
import { existsSync, mkdirSync, readdirSync, rmSync, lstatSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { root } from '../lib/config.mjs';

const dataRoot = join(root, 'data');

export function checkPath(p) {
  const abs = resolve(p);
  const rel = relative(dataRoot, abs);
  const parts = rel.split(sep);
  if (!rel || rel.startsWith('..') || resolve(dataRoot, rel) !== abs) throw new Error(`Refusing to touch ${abs}: it is not inside ${dataRoot}`);
  if (parts.length < 2) throw new Error(`Refusing to touch ${abs}: too close to the top of ${dataRoot}`);
  if (parts[0] === 'demo-src' && parts.length < 3) throw new Error(`Refusing to touch ${abs}: that is a whole demo clone`);
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
