// The tools the MCP server offers. These are the read-only ones: they look at the dashboard, they change nothing.
// What they never return: link tokens (only a hash is stored, and a link is shown once at creation), IP addresses, browser strings, env values.
// Free text that other people typed (customer names, page paths) is shortened and stripped of control characters, so it stays a short label.
import { loadRegistry, demoApps } from '../lib/registry.mjs';
import { EVENT_FILTERS } from '../lib/events.mjs';
import { HttpError } from '../lib/errors.mjs';
import { isActive } from '../demo-gateway/grants.mjs';
import { activityView, mergeTopPages, guideView } from '../lib/engagement.mjs';
import { guideProblem } from '../demo-gateway/guide/content.mjs';
import { isResetting, lastResetAt, holdReason, productState } from '../demo-gateway/reset.mjs';
import { listInstances } from '../demo-gateway/instances.mjs';
import { createStatusCache } from '../admin-console/status-cache.mjs';

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\u0000-\u001f\u007f-\u009f\u2028\u2029]', 'g');
export const clean = (s, max = 80) => String(s ?? '').replace(CONTROL, ' ').trim().slice(0, max);

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const LINK_ID = '^[a-f0-9]{8,16}$';
const stateOf = (g) => (g.revoked ? 'revoked' : isActive(g) ? 'active' : 'expired');

// deps: store, supervisor (runs `status --json`), registry (a function returning the registry; default the real one).
export function createTools({ store, supervisor, registry = loadRegistry, demos = demoApps }) {
  const status = createStatusCache({ supervisor, reuseMs: 2000 });
  const sumsOf = async () => new Map((await store.activity.summary()).map((s) => [s.grantId, s]));
  const guideSumsOf = async () => new Map((await store.guideUsage.summary()).map((s) => [s.grantId, s]));
  const linkView = (g, sums, guideSums) => ({ id: g.id, customer: clean(g.customer), app: g.app, state: stateOf(g), createdAt: g.createdAt, expiresAt: g.expiresAt,
    uses: g.uses ?? 0, maxUses: g.maxUses ?? null, deviceLock: !!g.deviceLock, lastUsedAt: g.lastUsedAt ?? null, activity: activityView(g, sums.get(g.id)), guide: guideView(g, guideSums.get(g.id)) });

  return [
    {
      name: 'list_apps',
      description: 'The owner\'s apps and whether each of their processes is running. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
      handler: async () => {
        const { rows, statusError } = await status.get();
        return {
          ...(statusError ? { statusError: `The status check ${statusError}; "up" is unknown below.` } : {}),
          apps: registry().apps.filter((a) => !a.hidden).map((a) => ({ id: a.id, name: a.name, tagline: a.tagline ?? null,
            processes: a.processes.map((p) => { const r = rows.find((x) => x.app === a.id && x.proc === p.name); return { name: p.name, port: p.port, up: statusError ? null : !!r?.up, managedByDashboard: !!r?.managed }; }) })),
        };
      },
    },
    {
      name: 'list_demo_links',
      description: 'Customer demo links, newest first: customer, product, state (active, expired, revoked), expiry, how often it was opened, and how much the customer used it (engagement: none, opened, engaged, came back). Never shows the link address itself: it exists only when it is created. Read-only.',
      inputSchema: { type: 'object', properties: {
        app: { type: 'string', description: 'Only links for this demo product, named as in demo_state (for example "crm").' },
        state: { type: 'string', enum: ['active', 'expired', 'revoked'], description: 'Only links in this state.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'How many to return (default 50).' },
      } },
      annotations: READ_ONLY,
      handler: async ({ app, state, limit = 50 }) => {
        const sums = await sumsOf(), guideSums = await guideSumsOf();
        const all = (await store.grants.list()).reverse().filter((g) => (!app || g.app === app) && (!state || stateOf(g) === state));
        return { total: all.length, shown: Math.min(all.length, limit), links: all.slice(0, limit).map((g) => linkView(g, sums, guideSums)) };
      },
    },
    {
      name: 'link_activity',
      description: 'What one customer did with one demo link: day by day (requests, active time) and the busiest pages. Counted by the gateway; never includes the customer\'s address, browser, search text or anything they typed. Read-only.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: LINK_ID, description: 'The link id from list_demo_links.' } }, required: ['id'] },
      annotations: READ_ONLY,
      handler: async ({ id }) => {
        const g = await store.grants.findById(id);
        if (!g) throw new HttpError(404, 'No such demo link.');
        const days = await store.activity.forGrant(id);
        return { link: linkView(g, await sumsOf(), await guideSumsOf()), days: days.map(({ day, requests, firstAt, lastAt, activeSeconds, wsSeconds }) => ({ day, requests, firstAt, lastAt, activeSeconds, wsSeconds })),
          topPages: mergeTopPages(days).map((p) => ({ path: clean(p.path, 100), count: p.count })) };
      },
    },
    {
      name: 'recent_events',
      description: 'The newest entries of the audit log, without addresses or browser strings. kind: all, admin (the owner\'s own sign-ins and changes), demos (what customers did), problems (failed sign-ins and refused requests). Read-only.',
      inputSchema: { type: 'object', properties: {
        kind: { type: 'string', enum: Object.keys(EVENT_FILTERS), description: 'Which events (default all).' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many to return (default 30).' },
      } },
      annotations: READ_ONLY,
      handler: async ({ kind = 'all', limit = 30 }) => {
        const events = (await store.audit.list(1000)).filter(EVENT_FILTERS[kind]).slice(0, limit)
          .map((e) => ({ t: e.t, event: e.ev, app: e.app ?? null, link: e.grant ?? null, customer: e.customer ? clean(e.customer) : undefined, why: e.why ? clean(e.why, 60) : undefined, by: e.by ? clean(e.by, 30) : undefined }));
        return { events };
      },
    },
    {
      name: 'demo_state',
      description: 'The state of each demo product: running, being reset (or held after a failed reset), last reset, how many links are in use, and for private-copy products how many copies run or are stuck. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
      handler: async () => {
        const { rows } = await status.get();
        const grants = await store.grants.list();
        const out = [];
        for (const [product, a] of Object.entries(demos())) {
          const copies = a.perLink ? Object.values(await listInstances(store, product)) : [];
          out.push({ product, name: a.name, up: rows.some((r) => r.app === a.id && r.up), perLink: !!a.perLink, seats: a.perLink?.max ?? null,
            canReset: !!a.reset && !a.perLink, guide: guideProblem(product, a) === null ? { ready: true } : { ready: false, why: guideProblem(product, a) },
            ...(a.reset && !a.perLink ? { resetting: await isResetting(store, product), hold: await holdReason(store, product), lastReset: await lastResetAt(store, product), linksInUse: productState(grants, product).busy } : {}),
            ...(a.perLink ? { copiesRunning: copies.filter((c) => c.state === 'ready' || c.state === 'starting').length, copiesStuck: copies.filter((c) => c.state === 'stopping' || c.state === 'failed').length } : {}) });
        }
        return { products: out };
      },
    },
  ];
}
