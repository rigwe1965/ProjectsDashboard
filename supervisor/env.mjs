// What a started command looks like: placeholders filled in, and the environment it runs with. Pure helpers, no state.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanEnv, minimalEnv } from '../lib/clean-env.mjs';
import { parseEnvText } from '../lib/util.mjs';
import { root } from '../lib/config.mjs';

// {port:name} -> the port of that process of the app. Every kind of command (start, prepare, reset) goes through this.
export const portRefs = (app) => (str) => str.replace(/\{port:(\w+)\}/g, (_, n) => String(app.processes.find((p) => p.name === n).port));

export function fill(str, proc, app) {
  return portRefs(app)(str
    .replaceAll('{url}', `http://localhost:${proc.port}`)
    .replaceAll('{port}', String(proc.port))
    .replaceAll('{inst}', app.inst ?? ''));
}

// The environment for a child: a minimal base, the dashboard's own env file (under data/, never the app's .env), then the
// registry's env values. `source` is the environment to take the base from (the real one by default).
export function childEnv(app, p, fillStr, source = process.env) {
  const env = cleanEnv(minimalEnv(source));
  if (p.envFile) {
    const f = join(root, p.envFile);
    if (!existsSync(f)) throw new Error(`Env file missing for ${app.id}: ${p.envFile}`);
    Object.assign(env, parseEnvText(readFileSync(f, 'utf8')));
  }
  for (const [k, v] of Object.entries(p.env ?? {})) env[k] = fillStr(v);
  return env;
}
