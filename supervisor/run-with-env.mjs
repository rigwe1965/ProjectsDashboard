// Run a one-off command inside an app folder with an env file applied to THAT child process only.
//   node supervisor/run-with-env.mjs <envfile> <cwd> -- <command...>
// The env file is the dashboard's own (under data/), never the app's .env. Values are never printed.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [envFile, cwd, sep, ...cmd] = process.argv.slice(2);
if (!envFile || !cwd || sep !== '--' || !cmd.length) { console.error('Usage: run-with-env.mjs <envfile> <cwd> -- <command...>'); process.exit(2); }

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1);
  }
  return out;
}

const env = { ...process.env, ...parseEnv(readFileSync(envFile, 'utf8')) };
const r = spawnSync(cmd.join(' '), { cwd, env, shell: true, stdio: 'inherit' });
process.exit(r.status ?? 1);
