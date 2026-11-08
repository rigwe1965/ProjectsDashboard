// Apply a folder of .sql migrations to a DEMO Postgres (e.g. a Supabase demo project), safely.
//   node supervisor/apply-sql.mjs <envfile> <sqlDir>          dry run: checks and lists, changes nothing
//   node supervisor/apply-sql.mjs <envfile> <sqlDir> --yes    apply
// Guards: the DB user must contain the same project ref as NEXT_PUBLIC_SUPABASE_URL; the target must be empty
// (no tables in "public") or already managed by this tool; each file runs in its own transaction and is recorded.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Client } = createRequire(join(root, 'data', 'tools', 'package.json'))('pg');
const [envFile, sqlDir, flag] = process.argv.slice(2);
if (!envFile || !sqlDir) { console.error('Usage: apply-sql.mjs <envfile> <sqlDir> [--yes]'); process.exit(2); }
const apply = flag === '--yes';

const env = {};
for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const t = l.trim(), i = t.indexOf('='); if (t && !t.startsWith('#') && i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const die = (m) => { console.error('STOP: ' + m); process.exit(1); };

if (!env.DEMO_DB_URL || env.DEMO_DB_URL === 'REPLACE_ME') die('DEMO_DB_URL is not set in ' + envFile);
let db, ref;
try { db = new URL(env.DEMO_DB_URL); } catch { die('DEMO_DB_URL is not a valid URL'); }
try { ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]; } catch { die('NEXT_PUBLIC_SUPABASE_URL is not a valid URL'); }
if (!db.username.includes(ref) && !db.hostname.includes(ref)) die(`DB user/host does not contain the project ref "${ref}": refusing (wrong project?)`);
if (/[[\]<>]|YOUR/i.test(decodeURIComponent(db.password))) die('DEMO_DB_URL still contains a password placeholder');

const files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
// Verify the server certificate. DEMO_DB_CA = path to the provider's CA certificate (Supabase: Database settings > SSL).
// DEMO_DB_INSECURE_TLS=1 is an explicit, noisy opt-out for when no CA is at hand.
let ssl = { rejectUnauthorized: true };
if (env.DEMO_DB_CA) ssl = { rejectUnauthorized: true, ca: readFileSync(env.DEMO_DB_CA, 'utf8') };
else if (env.DEMO_DB_INSECURE_TLS === '1') { console.warn('WARNING: DEMO_DB_INSECURE_TLS=1, the database certificate is NOT being verified.'); ssl = { rejectUnauthorized: false }; }
const client = new Client({ connectionString: env.DEMO_DB_URL, ssl });
try { await client.connect(); } catch (e) { die('cannot connect: ' + e.message.replace(/:[^:@/]*@/, ':***@') + (/certificate|self.signed|issuer/i.test(e.message) ? ' (certificate not trusted: set DEMO_DB_CA to the provider CA file)' : '')); }

try {
  console.log(`Target: ${db.hostname} (project ref ${ref}), user ${db.username}`);
  const tracked = (await client.query(`select to_regclass('public._dashboard_migrations') as t`)).rows[0].t;
  const tables = +(await client.query(`select count(*) from pg_tables where schemaname='public'`)).rows[0].count;
  if (!tracked && tables > 0) die(`"public" already has ${tables} tables and was not set up by this tool. Refusing to touch it.`);
  const done = new Set(tracked ? (await client.query('select name from public._dashboard_migrations')).rows.map((r) => r.name) : []);
  const pending = files.filter((f) => !done.has(f));
  console.log(`Migrations: ${files.length} found, ${done.size} applied, ${pending.length} pending`);
  pending.forEach((f) => console.log('  ' + f));
  if (!apply) { console.log('Dry run only. Re-run with --yes to apply.'); process.exit(0); }
  await client.query('create table if not exists public._dashboard_migrations (name text primary key, applied_at timestamptz default now())');
  for (const f of pending) {
    try {
      await client.query('begin');
      await client.query(readFileSync(join(sqlDir, f), 'utf8'));
      await client.query('insert into public._dashboard_migrations(name) values ($1)', [f]);
      await client.query('commit');
      console.log('  applied ' + f);
    } catch (e) { await client.query('rollback'); die(`${f} failed and was rolled back: ${e.message}`); }
  }
  console.log('All migrations applied.');
} finally { await client.end().catch(() => {}); }
