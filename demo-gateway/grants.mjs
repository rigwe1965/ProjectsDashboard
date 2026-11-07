// Demo grants: one customer, one app, expiring. Only a SHA-256 hash of the token is stored (in the database).
// Usage:
//   node demo-gateway/grants.mjs create --customer "Acme Ltd" --app imageapp [--hours 48]
//   node demo-gateway/grants.mjs list
//   node demo-gateway/grants.mjs revoke <grantId>
import { createHash, randomBytes } from 'node:crypto';
import { dataDir, registryPath } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { getStore, closeStore } from '../lib/store/index.mjs';

export { dataDir, registryPath };
export const MAX_HOURS = 720;

export const hashToken = (t) => createHash('sha256').update(t).digest('hex');
export const loadGrants = async () => (await getStore()).grants.list();

// product id -> demo instance entry (only instances explicitly marked demoReady)
export function demoApps() {
  const reg = loadRegistry(registryPath);
  return Object.fromEntries(reg.apps.filter((a) => a.demoOf && a.demoReady === true).map((a) => [a.demoOf, a]));
}

export async function findGrant(token) {
  return (await getStore()).grants.findByHash(hashToken(token));
}
export const isActive = (g) => g && !g.revoked && Date.parse(g.expiresAt) > Date.now();

export async function createGrant({ customer, app, hours = 48 }) {
  customer = String(customer || '').trim().slice(0, 80);
  if (!customer || !app) throw new Error('Customer and app are required');
  if (!demoApps()[app]) throw new Error('"' + app + '" has no demo-ready instance');
  hours = Number(hours);
  if (!(hours > 0 && hours <= MAX_HOURS)) throw new Error('Hours must be between 1 and ' + MAX_HOURS);
  const token = randomBytes(24).toString('hex');
  const grant = { id: randomBytes(4).toString('hex'), tokenHash: hashToken(token), customer, app, createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + hours * 3600e3).toISOString(), revoked: false };
  const store = await getStore();
  await store.grants.insert(grant);
  await store.audit.add({ ev: 'grant-created', grant: grant.id, app, customer });
  return { grant, link: demoLink(app, token) };
}
export async function revokeGrant(id) {
  const store = await getStore();
  const t = await store.grants.revoke(id);
  if (!t) throw new Error('No such grant');
  await store.audit.add({ ev: 'grant-revoked', grant: t.id, app: t.app });
  return t;
}
export const demoLink = (app, token) =>
  (process.env.DEMO_SCHEME || 'http') + '://' + app + '.' + (process.env.DEMO_BASE_HOST || 'localhost:4300') + '/d/' + token;
export const publicGrant = (g) => ({ id: g.id, customer: g.customer, app: g.app, createdAt: g.createdAt, expiresAt: g.expiresAt,
  state: g.revoked ? 'revoked' : isActive(g) ? 'active' : 'expired' });

if (process.argv[1]?.endsWith('grants.mjs')) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
  try {
    if (cmd === 'create') {
      const { grant, link } = await createGrant({ customer: opt('customer'), app: opt('app'), hours: opt('hours') || 48 });
      console.log('Grant ' + grant.id + ' for "' + grant.customer + '" -> ' + grant.app + ', expires ' + grant.expiresAt + '\nSend this link (shown once):\n  ' + link);
    } else if (cmd === 'list') {
      for (const g of (await loadGrants()).map(publicGrant)) console.log(g.id + '  ' + g.app.padEnd(12) + ' ' + g.customer.padEnd(24) + ' ' + g.state.padEnd(8) + ' until ' + g.expiresAt);
    } else if (cmd === 'revoke') { console.log('Revoked ' + (await revokeGrant(args[0])).id); }
    else console.log('Usage: grants.mjs create --customer "X" --app <id> [--hours N] | list | revoke <id>');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  await closeStore();
}
