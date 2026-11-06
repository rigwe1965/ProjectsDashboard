// Creates neutral demo accounts in a Supabase DEMO project (admin + customer) via the Auth admin REST API.
//   node supervisor/create-demo-users.mjs <envfile>
// Env file keys: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, CUSTOMER_EMAIL, CUSTOMER_PASSWORD
// Idempotent: an existing email is reported and left alone. Passwords are never printed.
import { readFileSync } from 'node:fs';

const envFile = process.argv[2];
if (!envFile) { console.error('Usage: create-demo-users.mjs <envfile>'); process.exit(2); }
const env = {};
for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const t = l.trim(), i = t.indexOf('='); if (t && !t.startsWith('#') && i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'CUSTOMER_EMAIL', 'CUSTOMER_PASSWORD'])
  if (!env[k] || env[k] === 'REPLACE_ME') { console.error('STOP: missing ' + k); process.exit(1); }

const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json' };

async function make(email, password, first, last, role) {
  const r = await fetch(`${base}/auth/v1/admin/users`, { method: 'POST', headers: h, body: JSON.stringify({
    email, password, email_confirm: true,
    user_metadata: { first_name: first, last_name: last },
    ...(role === 'admin' ? { app_metadata: { role: 'admin' } } : {}),
  }) });
  const j = await r.json();
  if (r.status === 422 || /already|exists|registered/i.test(JSON.stringify(j))) { console.log(`${email}: already exists, left unchanged`); return null; }
  if (!r.ok) { console.error(`${email}: failed HTTP ${r.status}: ${j.msg || j.message || JSON.stringify(j).slice(0, 160)}`); process.exit(1); }
  console.log(`${email}: created (${role})`);
  if (role === 'admin') {
    const p = await fetch(`${base}/rest/v1/user_profiles?id=eq.${j.id}`, { method: 'PATCH', headers: { ...h, prefer: 'return=representation' }, body: JSON.stringify({ role: 'admin' }) });
    const pj = await p.json();
    console.log(p.ok && pj.length ? '  profile role set to admin' : `  WARNING: could not set profile role (HTTP ${p.status}): ${JSON.stringify(pj).slice(0, 160)}`);
  }
  return j.id;
}

await make(env.ADMIN_EMAIL, env.ADMIN_PASSWORD, 'Demo', 'Admin', 'admin');
await make(env.CUSTOMER_EMAIL, env.CUSTOMER_PASSWORD, 'Demo', 'Customer', 'customer');
