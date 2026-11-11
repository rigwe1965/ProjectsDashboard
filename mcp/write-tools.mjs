// The tools that CHANGE things (analytics plan step 6). They are offered only when the owner sets MCP_WRITE=1 for the MCP server; without it
// they are not listed, and calling one answers with a sentence saying so. Every change is written to the audit log as `by: mcp`, and all of
// them together are limited to `limit` attempts per minute, so an assistant stuck in a loop cannot create or revoke links by the hundred.
// Deliberately not here: starting and stopping apps, forcing a reset while customers are in a demo, forgetting a link, passwords.
import { createGrants } from '../demo-gateway/grants.mjs';
import { demoApps } from '../lib/registry.mjs';
import { runReset, productState } from '../demo-gateway/reset.mjs';
import { EVENTS } from '../lib/events.mjs';
import { HttpError } from '../lib/errors.mjs';
import { MINUTE } from '../lib/util.mjs';
import { logger } from '../lib/log.mjs';
import { clean } from './tools.mjs';
import { guideProblem } from '../demo-gateway/guide/content.mjs';

export const OFF_MESSAGE = 'Changing things is switched off. The owner turns it on by starting the MCP server with MCP_WRITE=1.';
const LINK_ID = '^[a-f0-9]{8,16}$';
const CHANGES = { readOnlyHint: false, openWorldHint: false };

export function createWriteTools({ store, supervisor, enabled = false, demos = demoApps, limit = 20, rateKey = 'mcp-write' }) {
  const grants = createGrants(store);
  const off = enabled ? {} : { disabled: OFF_MESSAGE };

  // Counts this attempt. Past the limit: refused, and the refusal is written to the audit log (a failure to write it never hides the refusal).
  async function allowed() {
    if ((await store.rateLimit.hit(rateKey, MINUTE, limit)) <= limit) return;
    try { await store.audit.add({ ev: EVENTS.adminActionRefused, why: 'mcp-rate-limit', by: 'mcp' }); } catch (err) { logger.warn('audit write failed', { err }); }
    throw new HttpError(429, `Too many changes in one minute (limit ${limit}). Wait a minute and try again.`);
  }

  return [
    {
      name: 'create_demo_link',
      description: 'Creates a customer demo link for one product. The link is shown ONCE, in this answer, and cannot be shown again: give it to the owner and nowhere else. product is named as in demo_state (for example "crm"). Changes the dashboard.',
      inputSchema: { type: 'object', properties: {
        customer: { type: 'string', description: 'Who the link is for (shown in the console; up to 80 characters).' },
        product: { type: 'string', description: 'The demo product, as listed by demo_state.' },
        hours: { type: 'integer', minimum: 1, maximum: 720, description: 'How long the link works (default 48).' },
        maxUses: { type: 'integer', minimum: 1, maximum: 1000, description: 'How many times it may be opened (default: no limit).' },
        deviceLock: { type: 'boolean', description: 'Tie the link to the first browser that opens it (default false).' },
        displayName: { type: 'string', description: 'Optional name the CUSTOMER sees on the page where they open the link ("Prepared for ..."), up to 80 characters. Not the owner\'s own label.' },
        welcome: { type: 'string', description: 'Optional short welcome note the customer sees on that page (up to 400 characters), e.g. what to try first. Plain text only.' },
        guideMessages: { type: 'integer', minimum: 0, maximum: 200, description: 'Optional: how many questions the customer may ask the AI demo guide beside the demo (default 0: no guide). Only for a product whose guide is ready (demo_state shows guide.ready); each message costs the owner a small amount.' },
      }, required: ['customer', 'product'] },
      annotations: { ...CHANGES, destructiveHint: false, idempotentHint: false },
      ...off,
      handler: async ({ customer, product, hours, maxUses, deviceLock, displayName, welcome, guideMessages }) => {
        await allowed();
        if (Number(guideMessages) > 0) { const why = guideProblem(product, demos()[product]); if (why) throw new HttpError(400, 'This link cannot have a guide: ' + why + '.'); }
        const { grant, link } = await grants.createGrant({ customer: clean(customer), app: product, hours, maxUses, deviceLock, displayName, welcome, guideMessages }, { by: 'mcp' });
        return { id: grant.id, customer: clean(grant.customer), product: grant.app, expiresAt: grant.expiresAt, maxUses: grant.maxUses, deviceLock: !!grant.deviceLock, guideMessages: grant.guideMessages ?? 0, link,
          warning: 'This is the only time the link is shown. Give it to the owner; do not post or store it anywhere else.' };
      },
    },
    {
      name: 'revoke_demo_link',
      description: 'Revokes a demo link at once: the customer loses access, including open live connections. Cannot be undone (create a new link instead). Changes the dashboard.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: LINK_ID, description: 'The link id from list_demo_links.' } }, required: ['id'] },
      annotations: { ...CHANGES, destructiveHint: true, idempotentHint: true },
      ...off,
      handler: async ({ id }) => {
        await allowed();
        const g = await grants.revokeGrant(id, { by: 'mcp' }); // a 404 HttpError when there is no such link
        return { id: g.id, state: 'revoked' };
      },
    },
    {
      name: 'reset_demo',
      description: 'Resets a shared demo product to its seeded sample data (everything customers entered is replaced; the demo is unavailable for a minute or two). Refused while any customer link for it is still in use: the owner can force it from the console. Not for private-copy products. Changes the dashboard.',
      inputSchema: { type: 'object', properties: { product: { type: 'string', description: 'The demo product, as listed by demo_state (canReset must be true).' } }, required: ['product'] },
      annotations: { ...CHANGES, destructiveHint: true, idempotentHint: false },
      ...off,
      handler: async ({ product }) => {
        await allowed();
        const app = demos()[product];
        if (!app?.reset || app.perLink) throw new HttpError(404, 'That demo cannot be reset.');
        const inUse = productState(await store.grants.list(), product).busy;
        if (inUse) throw new HttpError(409, `${inUse} customer link${inUse === 1 ? ' is' : 's are'} still in use for this demo, and a reset would wipe what they are working on. Ask the owner to reset it from the console, or revoke the link${inUse === 1 ? '' : 's'} first.`);
        await store.audit.add({ ev: EVENTS.demoResetRequested, app: product, forced: false, by: 'mcp' });
        const r = await runReset({ store, product, app, supervisor, by: 'mcp' });
        if (r.busy) throw new HttpError(409, 'A reset of this demo is already running.');
        if (!r.ok) throw new HttpError(502, 'The reset failed. New links for this demo are held until a reset succeeds; the owner should look at the console and the logs.'); // the supervisor's own output stays in the owner's logs
        return { product, ok: true, message: 'The demo was reset to its sample data.' };
      },
    },
  ];
}
