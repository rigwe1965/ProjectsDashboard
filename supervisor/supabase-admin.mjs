// Token-based setup for a Supabase DEMO project via the Supabase Management API. No DB password needed.
//   node supervisor/supabase-admin.mjs <envfile> info                         project name/status, nothing changed
//   node supervisor/supabase-admin.mjs <envfile> fetch-keys                   writes SUPABASE_SERVICE_ROLE_KEY into the env file
//   node supervisor/supabase-admin.mjs <envfile> migrate <sqlDir> [--yes]     dry run by default; --yes applies
// Needs SUPABASE_ACCESS_TOKEN (a personal access token, sbp_...) and NEXT_PUBLIC_SUPABASE_URL in the env file.
// Revoke the token at supabase.com/dashboard/account/tokens when setup is finished.
// Guards: only ever acts on the project ref in NEXT_PUBLIC_SUPABASE_URL; migrations refuse a "public" schema that
// already has tables not created by this tool; each file + its tracking row run as ONE request (atomic).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [envFile, cmd, arg, flag] = process.argv.slice(2);
if (!envFile || !cmd) { console.error('Usage: supabase-admin.mjs <envfile> info | fetch-keys | migrate <sqlDir> [--yes]'); process.exit(2); }
const die = (m) => { console.error('STOP: ' + m); process.exit(1); };

const text = readFileSync(envFile, 'utf8');
const env = {};
for (const l of text.split(/\r?\n/)) { const t = l.trim(), i = t.indexOf('='); if (t && !t.startsWith('#') && i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }

const token = env.SUPABASE_ACCESS_TOKEN;
if (!token || token === 'REPLACE_ME' || token.length < 20) die('SUPABASE_ACCESS_TOKEN is missing or too short in ' + envFile);
let ref; try { ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]; } catch { die('NEXT_PUBLIC_SUPABASE_URL is not a valid URL'); }

const api = async (method, path, body) => {
  const r = await fetch('https://api.supabase.com' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) die(`${method} ${path.split('?')[0]} -> HTTP ${r.status}: ${typeof j === 'string' ? j.slice(0, 200) : (j.message || JSON.stringify(j).slice(0, 200))}`);
  return j;
};
const sql = (query) => api('POST', `/v1/projects/${ref}/database/query`, { query });

const proj = await api('GET', `/v1/projects/${ref}`);
console.log(`Project: "${proj.name}" (ref ${ref}), status ${proj.status}, region ${proj.region}`);

if (cmd === 'info') process.exit(0);

if (cmd === 'fetch-keys') {
  const keys = await api('GET', `/v1/projects/${ref}/api-keys?reveal=true`);
  const k = keys.find((x) => x.name === 'service_role') || keys.find((x) => x.type === 'secret');
  if (!k?.api_key) die('no service-role/secret key found in the API response');
  const lines = text.split(/\r?\n/); let hit = false;
  for (let i = 0; i < lines.length; i++) if (/^SUPABASE_SERVICE_ROLE_KEY=/.test(lines[i])) { lines[i] = 'SUPABASE_SERVICE_ROLE_KEY=' + k.api_key; hit = true; }
  if (!hit) lines.push('SUPABASE_SERVICE_ROLE_KEY=' + k.api_key);
  writeFileSync(envFile, lines.join('\n'));
  console.log(`Saved SUPABASE_SERVICE_ROLE_KEY (${k.api_key.length} characters, key "${k.name}", type ${k.type}). Not printed.`);
  process.exit(0);
}

if (cmd === 'migrate') {
  if (!arg) die('migrate needs <sqlDir>');
  const apply = flag === '--yes';
  const files = readdirSync(arg).filter((f) => f.endsWith('.sql')).sort();
  const tracked = (await sql(`select to_regclass('public._dashboard_migrations') as t`))[0].t;
  const tables = +(await sql(`select count(*)::int as n from pg_tables where schemaname='public'`))[0].n;
  if (!tracked && tables > 0) die(`"public" already has ${tables} tables not created by this tool. Refusing to touch it.`);
  const done = new Set(tracked ? (await sql('select name from public._dashboard_migrations')).map((r) => r.name) : []);
  const pending = files.filter((f) => !done.has(f));
  console.log(`Migrations: ${files.length} found, ${done.size} applied, ${pending.length} pending`);
  pending.forEach((f) => console.log('  ' + f));
  if (!apply) { console.log('Dry run only. Re-run with --yes to apply.'); process.exit(0); }
  await sql('create table if not exists public._dashboard_migrations (name text primary key, applied_at timestamptz default now())');
  for (const f of pending) {
    const body = readFileSync(join(arg, f), 'utf8').replace(/;?\s*$/, ';');
    await sql(`${body}\ninsert into public._dashboard_migrations(name) values ('${f.replace(/'/g, "''")}');`);
    console.log('  applied ' + f);
  }
  console.log('All migrations applied.');
  process.exit(0);
}
die('unknown command ' + cmd);
