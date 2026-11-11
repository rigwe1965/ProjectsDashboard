// Demo grants: one customer, one app, expiring. Only a SHA-256 hash of the token is stored (in the database).
import { randomBytes } from 'node:crypto';
import { sha256 } from '../lib/auth.mjs';
import { demoApps } from '../lib/registry.mjs';
import { getStore } from '../lib/store/index.mjs';
import { HttpError } from '../lib/errors.mjs';
import { EVENTS } from '../lib/events.mjs';
import { logger } from '../lib/log.mjs';
import { oneLine, noteText } from '../lib/text.mjs';

export { demoApps }; // lives in lib/registry.mjs; still importable from here
export const MAX_HOURS = 720;
export const MAX_DISPLAY_NAME = 80, MAX_WELCOME = 400; // what the customer sees on the page where they open the link

export const hashToken = sha256;

export const isActive = (g) => g && !g.revoked && Date.parse(g.expiresAt) > Date.now();

// maxUses: how many times the link may be opened (empty = unlimited). deviceLock: pin the link to the first browser that opens it.
// displayName and welcome (both optional): the name and the short note the customer sees on the page where they open the link. `customer` stays the owner's own label.
// `who` says where the action came from ({ ip, by }); it is written to the audit trail with the event.
async function createGrantIn(store, { customer, app, hours = 48, maxUses = null, deviceLock = false, displayName = null, welcome = null }, who = {}) {
  customer = String(customer || '').trim().slice(0, 80);
  if (!customer || !app) throw new HttpError(400, 'Customer and app are required');
  if (!demoApps()[app]) throw new HttpError(400, '"' + app + '" has no demo-ready instance');
  hours = Number(hours);
  if (!(hours > 0 && hours <= MAX_HOURS)) throw new HttpError(400, 'Hours must be between 1 and ' + MAX_HOURS);
  maxUses = maxUses === null || maxUses === undefined || maxUses === '' ? null : Number(maxUses);
  if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000)) throw new HttpError(400, 'Uses must be a whole number from 1 to 1000');
  displayName = oneLine(displayName, MAX_DISPLAY_NAME) || null;
  welcome = noteText(welcome, MAX_WELCOME) || null;
  const token = randomBytes(24).toString('hex');
  const grant = { id: randomBytes(8).toString('hex'), tokenHash: hashToken(token), customer, app, createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + hours * 3600e3).toISOString(), revoked: false, uses: 0, maxUses, deviceLock: !!deviceLock, lastUsedAt: null, displayName, welcome };
  await store.grants.insert(grant);
  // The link exists now. If the audit write fails, the owner must still be shown the link (it is never shown again), so the failure is logged, not thrown.
  try { await store.audit.add({ ev: EVENTS.grantCreated, grant: grant.id, app, customer, hours, maxUses, deviceLock: !!deviceLock, branded: !!(displayName || welcome), ...who }); }
  catch (err) { logger.error('link created but its audit record could not be written', { err, grant: grant.id }); }
  return { grant, link: demoLink(app, token) };
}
async function revokeGrantIn(store, id, who = {}) {
  const t = await store.grants.revoke(id);
  if (!t) throw new HttpError(404, 'No such grant');
  await store.audit.add({ ev: EVENTS.grantRevoked, grant: t.id, app: t.app, ...who });
  return t;
}

// The grant operations on a given store, so a service can be handed its store (createGateway / createConsole take `store`).
export const createGrants = (store) => ({
  loadGrants: async () => store.grants.list(),
  findGrant: async (token) => store.grants.findByHash(hashToken(token)),
  createGrant: (args, who) => createGrantIn(store, args, who),
  revokeGrant: (id, who) => revokeGrantIn(store, id, who),
});
// The same operations on the process-wide store, for the command line and for callers that do not pass one.
const onDefault = (name) => async (...a) => createGrants(await getStore())[name](...a);
export const loadGrants = onDefault('loadGrants'), findGrant = onDefault('findGrant');
export const createGrant = onDefault('createGrant'), revokeGrant = onDefault('revokeGrant');
export const demoLink = (app, token) =>
  (process.env.DEMO_SCHEME || 'http') + '://' + app + '.' + (process.env.DEMO_BASE_HOST || 'localhost:4300') + '/d/' + token;
export const publicGrant = (g) => ({ id: g.id, customer: g.customer, app: g.app, createdAt: g.createdAt, expiresAt: g.expiresAt,
  uses: g.uses ?? 0, maxUses: g.maxUses ?? null, deviceLock: !!g.deviceLock, lastUsedAt: g.lastUsedAt ?? null,
  displayName: g.displayName ?? null, welcome: g.welcome ?? null,
  state: g.revoked ? 'revoked' : isActive(g) ? 'active' : 'expired' });
