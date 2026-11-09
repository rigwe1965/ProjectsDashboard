// The parts of the SQLite and Postgres stores that do not depend on the SQL dialect: row mapping, audit packing, expiry.
// Keeping them here means a change to a stored field is made once, and tests/unit/store-contract.test.mjs checks both backends.

// Columns added to `grants` after the first release. Both stores add whichever are missing, so an older database is upgraded in
// place (SQLite: ALTER TABLE ... ADD COLUMN after a table_info check; Postgres: ADD COLUMN IF NOT EXISTS).
export const GRANT_EXTRA_COLUMNS = [
  ['uses', 'INTEGER NOT NULL DEFAULT 0'], ['max_uses', 'INTEGER'], ['device_lock', 'INTEGER NOT NULL DEFAULT 0'],
  ['device_hash', 'TEXT'], ['last_used_at', 'TEXT'],
];

// Number() because the pg driver can hand back some integer types as strings; it changes nothing for SQLite.
export const toGrant = (r) => r && ({ id: r.id, tokenHash: r.token_hash, customer: r.customer, app: r.app,
  createdAt: r.created_at, expiresAt: r.expires_at, revoked: !!r.revoked,
  uses: Number(r.uses ?? 0), maxUses: r.max_uses == null ? null : Number(r.max_uses), deviceLock: !!r.device_lock, lastUsedAt: r.last_used_at ?? null });

// An audit event as the six values of `INSERT INTO audit (t, ev, grant_id, app, ip, data)`.
export const auditValues = ({ t = new Date().toISOString(), ev, grant, app, ip, ...rest }) =>
  [t, ev, grant ?? null, app ?? null, ip ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null];

export const auditFromRow = (r) => ({ t: r.t, ev: r.ev, grant: r.grant_id ?? undefined, app: r.app ?? undefined, ip: r.ip ?? undefined,
  ...(r.data ? JSON.parse(r.data) : {}) });

// `pick(row)` for a session row that has not expired yet, else null.
export const liveUntil = (r, pick) => (r && Date.parse(r.expires_at) > Date.now() ? pick(r) : null);
