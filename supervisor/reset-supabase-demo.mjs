// Puts the ClaudeWorkspace DEMO Supabase project back to a clean customer-data state (a reset step; seed_demo.mjs then restores
// the vehicles, categories and prices).
//   node supervisor/reset-supabase-demo.mjs <envfile>          dry run: counts what would be removed, changes nothing
//   node supervisor/reset-supabase-demo.mjs <envfile> --yes    do it
// What it removes: bookings and everything attached to them, payments, e-mail log, AI conversations, licence checks,
// loyalty accounts, maintenance alerts, the admin audit log and every sign-in account EXCEPT the two demo accounts
// (ADMIN_EMAIL, CUSTOMER_EMAIL). It sets those two accounts' passwords back to ADMIN_PASSWORD / CUSTOMER_PASSWORD.
// It only talks to the project named in the env file, which is the dashboard's own demo env (never the app's real .env).
// Keys are never printed.
import { readFileSync } from 'node:fs';

const [envFile, flag] = process.argv.slice(2);
if (!envFile) { console.error('Usage: reset-supabase-demo.mjs <envfile> [--yes]'); process.exit(2); }
const apply = flag === '--yes';
const env = {};
for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const t = l.trim(), i = t.indexOf('='); if (t && !t.startsWith('#') && i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'CUSTOMER_EMAIL', 'CUSTOMER_PASSWORD'])
  if (!env[k] || env[k] === 'REPLACE_ME') { console.error('STOP: missing ' + k); process.exit(1); }

const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json' };
const keep = new Set([env.ADMIN_EMAIL.toLowerCase(), env.CUSTOMER_EMAIL.toLowerCase()]);
const fail = (m) => { console.error('STOP: ' + m); process.exit(1); };

// children first, so no row is blocked by one that still points at it
const TABLES = ['payments', 'email_logs', 'booking_extras', 'vehicle_inspections', 'licence_verifications', 'ai_conversations',
  'loyalty_transactions', 'loyalty_accounts', 'maintenance_alerts', 'admin_audit_log', 'bookings'];

async function count(table) {
  const r = await fetch(`${base}/rest/v1/${table}?select=id`, { headers: { ...h, prefer: 'count=exact', range: '0-0' } });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  return { n: Number((r.headers.get('content-range') || '').split('/')[1]) || 0 };
}
async function listUsers() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const r = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: h });
    if (!r.ok) fail(`could not list users (HTTP ${r.status})`);
    const j = await r.json(); const users = j.users ?? [];
    out.push(...users); if (users.length < 200) break;
  }
  return out;
}

let problems = 0;
for (const t of TABLES) {
  const c = await count(t);
  if (c.error) { console.log(`${t.padEnd(22)} cannot read (${c.error})`); problems++; continue; }
  if (!apply) { console.log(`${t.padEnd(22)} ${c.n} row(s) would be removed`); continue; }
  if (c.n) {
    const r = await fetch(`${base}/rest/v1/${t}?id=not.is.null`, { method: 'DELETE', headers: h });
    if (!r.ok) { console.log(`${t.padEnd(22)} DELETE failed (HTTP ${r.status})`); problems++; continue; }
  }
  console.log(`${t.padEnd(22)} ${c.n} row(s) removed`);
}

const users = await listUsers();
const extra = users.filter((u) => !keep.has(String(u.email || '').toLowerCase()));
console.log(`accounts: ${users.length} in total, ${extra.length} ${apply ? 'to remove' : 'would be removed'}`);
if (apply) {
  for (const u of extra) {
    const r = await fetch(`${base}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: h });
    if (!r.ok) { console.log(`  could not remove an account (HTTP ${r.status})`); problems++; }
  }
  for (const [email, password, role] of [[env.ADMIN_EMAIL, env.ADMIN_PASSWORD, 'admin'], [env.CUSTOMER_EMAIL, env.CUSTOMER_PASSWORD, 'customer']]) {
    const u = users.find((x) => String(x.email || '').toLowerCase() === email.toLowerCase());
    if (!u) { console.log(`${role} demo account is missing: run supervisor/create-demo-users.mjs`); problems++; continue; }
    const r = await fetch(`${base}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ password, email_confirm: true }) });
    const p = await fetch(`${base}/rest/v1/user_profiles?id=eq.${u.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ role }) });
    console.log(`${role} account: password ${r.ok ? 'reset' : 'NOT reset (HTTP ' + r.status + ')'}, role ${p.ok ? 'ok' : 'NOT set (HTTP ' + p.status + ')'}`);
    if (!r.ok || !p.ok) problems++;
  }
}
console.log(apply ? (problems ? `Finished with ${problems} problem(s).` : 'Done.') : 'Dry run: nothing was changed. Add --yes to apply.');
process.exit(problems ? 1 : 0);
