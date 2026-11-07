// Demo grants: one customer, one app, expiring. Only a SHA-256 hash of the token is stored.
// Usage:
//   node demo-gateway/grants.mjs create --customer "Acme Ltd" --app imageapp [--hours 48]
//   node demo-gateway/grants.mjs list
//   node demo-gateway/grants.mjs revoke <grantId>
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { dataDir, registryPath } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';

export { dataDir, registryPath };
const file = join(dataDir, 'demos.json');
export const MAX_HOURS = 720;

export const hashToken = (t) => createHash('sha256').update(t).digest('hex');
export const loadGrants = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
function save(g) { mkdirSync(dataDir, { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(g, null, 2)); renameSync(file + '.tmp', file); }

// product id -> demo instance entry (only instances explicitly marked demoReady)
export function demoApps() {
  const reg = loadRegistry(registryPath);
  return Object.fromEntries(reg.apps.filter((a) => a.demoOf && a.demoReady === true).map((a) => [a.demoOf, a]));
}

export function findGrant(token) {
  const h = hashToken(token);
  return loadGrants().find((g) => g.tokenHash === h) || null;
}
export const isActive = (g) => g && !g.revoked && Date.parse(g.expiresAt) > Date.now();

export function createGrant({ customer, app, hours = 48 }) {
  customer = String(customer || '').trim().slice(0, 80);
  if (!customer || !app) throw new Error('Customer and app are required');
  if (!demoApps()[app]) throw new Error('"' + app + '" has no demo-ready instance');
  hours = Number(hours);
  if (!(hours > 0 && hours <= MAX_HOURS)) throw new Error('Hours must be between 1 and ' + MAX_HOURS);
  const token = randomBytes(24).toString('hex');
  const all = loadGrants();
  const grant = { id: randomBytes(4).toString('hex'), tokenHash: hashToken(token), customer, app, createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + hours * 3600e3).toISOString(), revoked: false };
  all.push(grant); save(all);
  return { grant, link: demoLink(app, token) };
}
export function revokeGrant(id) {
  const all = loadGrants(); const t = all.find((x) => x.id === id);
  if (!t) throw new Error('No such grant');
  t.revoked = true; save(all); return t;
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
      const { grant, link } = createGrant({ customer: opt('customer'), app: opt('app'), hours: opt('hours') || 48 });
      console.log('Grant ' + grant.id + ' for "' + grant.customer + '" -> ' + grant.app + ', expires ' + grant.expiresAt + '\nSend this link (shown once):\n  ' + link);
    } else if (cmd === 'list') {
      for (const g of loadGrants().map(publicGrant)) console.log(g.id + '  ' + g.app.padEnd(12) + ' ' + g.customer.padEnd(24) + ' ' + g.state.padEnd(8) + ' until ' + g.expiresAt);
    } else if (cmd === 'revoke') { console.log('Revoked ' + revokeGrant(args[0]).id); }
    else console.log('Usage: grants.mjs create --customer "X" --app <id> [--hours N] | list | revoke <id>');
  } catch (e) { console.error(e.message); process.exit(1); }
}
