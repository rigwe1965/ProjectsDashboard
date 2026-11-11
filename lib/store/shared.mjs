// The parts of the SQLite and Postgres stores that do not depend on the SQL dialect: row mapping, audit packing, expiry.
import { logger } from '../log.mjs';
// Keeping them here means a change to a stored field is made once, and tests/unit/store-contract.test.mjs checks both backends.

// Columns added to `grants` after the first release. Both stores add whichever are missing, so an older database is upgraded in
// place (SQLite: ALTER TABLE ... ADD COLUMN after a table_info check; Postgres: ADD COLUMN IF NOT EXISTS).
export const GRANT_EXTRA_COLUMNS = [
  ['uses', 'INTEGER NOT NULL DEFAULT 0'], ['max_uses', 'INTEGER'], ['device_lock', 'INTEGER NOT NULL DEFAULT 0'],
  ['device_hash', 'TEXT'], ['last_used_at', 'TEXT'],
  ['display_name', 'TEXT'], ['welcome', 'TEXT'], // what the customer sees on the page where they open the link (branded demo pages)
];

// Number() because the pg driver can hand back some integer types as strings; it changes nothing for SQLite.
export const toGrant = (r) => r && ({ id: r.id, tokenHash: r.token_hash, customer: r.customer, app: r.app,
  createdAt: r.created_at, expiresAt: r.expires_at, revoked: !!r.revoked,
  uses: Number(r.uses ?? 0), maxUses: r.max_uses == null ? null : Number(r.max_uses), deviceLock: !!r.device_lock, lastUsedAt: r.last_used_at ?? null,
  displayName: r.display_name ?? null, welcome: r.welcome ?? null });

// An audit event as the six values of `INSERT INTO audit (t, ev, grant_id, app, ip, data)`.
export const auditValues = ({ t = new Date().toISOString(), ev, grant, app, ip, ...rest }) =>
  [t, ev, grant ?? null, app ?? null, ip ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null];

// Stored JSON that cannot be read is a damaged row, not a bad request: it is logged and skipped instead of failing the whole list (audit F-15).
export function parseStored(text, what) {
  try { return JSON.parse(text); } catch (err) { logger.error('damaged stored data skipped', { what, err }); return null; }
}
export const auditFromRow = (r) => {
  const extra = r.data ? parseStored(r.data, `audit row ${r.t} ${r.ev}`) : {};
  return { t: r.t, ev: r.ev, grant: r.grant_id ?? undefined, app: r.app ?? undefined, ip: r.ip ?? undefined, ...(extra ?? { dataDamaged: true }) };
};

// `pick(row)` for a session row that has not expired yet, else null.
export const liveUntil = (r, pick) => (r && Date.parse(r.expires_at) > Date.now() ? pick(r) : null);

// ---- Per-link activity rollup (table grant_activity: one row per link per UTC day) ----
// What a customer did with a link, counted, never recorded request by request: how many requests, when first and last, how long active,
// and which pages (the first path segments only, no query string). The gateway adds to it in batches; the console reads it.
export const TOP_PATHS = 10;

const whole = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

// The stored row (or null for a link's first activity that day) plus an added batch -> the six values to store:
// requests, first_at, last_at, active_seconds, ws_seconds, top_paths (JSON, the TOP_PATHS busiest pages).
// delta: { requests, firstAt, lastAt, activeSeconds, wsSeconds, paths: { '/crm/contacts': 3 } }
export function mergeActivity(row, delta = {}) {
  const counts = new Map();
  const stored = row?.top_paths ? parseStored(row.top_paths, 'grant_activity top_paths') : null;
  if (stored && typeof stored === 'object') for (const [p, n] of Object.entries(stored)) counts.set(p, whole(n));
  for (const [path, n] of Object.entries(delta.paths ?? {})) { const p = path.slice(0, 100); counts.set(p, (counts.get(p) ?? 0) + whole(n)); }
  const top = [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_PATHS);
  const first = [row?.first_at, delta.firstAt].filter(Boolean).sort()[0] ?? null;
  const last = [row?.last_at, delta.lastAt].filter(Boolean).sort().at(-1) ?? null;
  return [whole(row?.requests) + whole(delta.requests), first, last, whole(row?.active_seconds) + whole(delta.activeSeconds),
    whole(row?.ws_seconds) + whole(delta.wsSeconds), JSON.stringify(Object.fromEntries(top))];
}

export const toActivity = (r) => ({ grantId: r.grant_id, day: r.day, requests: Number(r.requests), firstAt: r.first_at ?? null, lastAt: r.last_at ?? null,
  activeSeconds: Number(r.active_seconds), wsSeconds: Number(r.ws_seconds),
  topPaths: Object.entries(parseStored(r.top_paths ?? '{}', 'grant_activity top_paths') ?? {}).map(([path, count]) => ({ path, count: Number(count) })) });
export const toActivitySummary = (r) => ({ grantId: r.grant_id, days: Number(r.days), requests: Number(r.requests), activeSeconds: Number(r.active_seconds),
  wsSeconds: Number(r.ws_seconds), firstAt: r.first_at ?? null, lastAt: r.last_at ?? null });

export const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));

// ---- Per-link AI guide usage (table guide_usage: one row per link per UTC day) ----
// Counts only, never what anyone typed or was answered: messages, tokens, and the estimated cost in millionths of a dollar
// (whole numbers, so sums never drift). delta: { messages, inputTokens, cachedTokens, outputTokens, costMicro }
export const mergeGuideUsage = (row, delta = {}) => [whole(row?.messages) + whole(delta.messages), whole(row?.input_tokens) + whole(delta.inputTokens),
  whole(row?.cached_tokens) + whole(delta.cachedTokens), whole(row?.output_tokens) + whole(delta.outputTokens), whole(row?.cost_micro) + whole(delta.costMicro)];
export const toGuideUsage = (r) => ({ grantId: r.grant_id, day: r.day, messages: Number(r.messages), inputTokens: Number(r.input_tokens),
  cachedTokens: Number(r.cached_tokens), outputTokens: Number(r.output_tokens), costMicro: Number(r.cost_micro) });
// SUM() of nothing is NULL: a link that never used the guide reads as all zeros.
export const toGuideTotals = (r) => ({ messages: Number(r?.messages ?? 0), inputTokens: Number(r?.input_tokens ?? 0), cachedTokens: Number(r?.cached_tokens ?? 0),
  outputTokens: Number(r?.output_tokens ?? 0), costMicro: Number(r?.cost_micro ?? 0) });
