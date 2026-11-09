// Run a one-off command inside an app folder with an env file applied to THAT child process only.
//   node supervisor/run-with-env.mjs <envfile> <cwd> -- <command...>
// The env file is the dashboard's own (under data/), never the app's .env. Values are never printed.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnvText } from '../lib/util.mjs';

const [envFile, cwd, sep, ...cmd] = process.argv.slice(2);
if (!envFile || !cwd || sep !== '--' || !cmd.length) { console.error('Usage: run-with-env.mjs <envfile> <cwd> -- <command...>'); process.exit(2); }

const env = { ...process.env, ...parseEnvText(readFileSync(envFile, 'utf8')) };
const r = spawnSync(cmd.join(' '), { cwd, env, shell: true, stdio: 'inherit' });
process.exit(r.status ?? 1);
