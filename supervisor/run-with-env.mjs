// Run a one-off command inside an app folder with an env file applied to THAT child process only.
//   node supervisor/run-with-env.mjs <envfile> <cwd> -- <command...>
// The env file is the dashboard's own (under data/), never the app's .env. Values are never printed.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnvText } from '../lib/util.mjs';
import { cleanEnv, minimalEnv } from '../lib/clean-env.mjs';

const [envFile, cwd, sep, ...cmd] = process.argv.slice(2);
if (!envFile || !cwd || sep !== '--' || !cmd.length) { console.error('Usage: run-with-env.mjs <envfile> <cwd> -- <command...>'); process.exit(2); }

// Like a supervised app, the command gets the toolchain variables (PATH, temp folders, ...) and the env file, not the owner's whole environment
// (PD_APP_ENV_PASSTHROUGH names more when one is really needed). An argument with spaces or quotes keeps its quoting.
const env = { ...cleanEnv(minimalEnv(process.env)), ...parseEnvText(readFileSync(envFile, 'utf8')) };
const quote = (a) => (/[\s"']/.test(a) ? '"' + a.replaceAll('"', '\\"') + '"' : a);
const r = spawnSync(cmd.map(quote).join(' '), { cwd, env, shell: true, stdio: 'inherit' });
process.exit(r.status ?? 1);
