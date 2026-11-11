// Postgres store: the same interface as lib/store/sqlite.mjs, every method returns a Promise.
//   DASHBOARD_DB=postgres  DATABASE_URL=postgres://user:pass@host:5432/dbname   (add ?sslmode=require for managed databases)
//   DATABASE_SCHEMA=public (optional) keeps the dashboard's tables in their own schema.
// The `pg` package is loaded only when this store is used, so SQLite-only installs never need it.
import { GRANT_EXTRA_COLUMNS, toGrant, auditValues, auditFromRow, liveUntil, parseStored } from './shared.mjs';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  customer TEXT NOT NULL,
  app TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS grants_app ON grants(app);
CREATE TABLE IF NOT EXISTS audit (
  id BIGSERIAL PRIMARY KEY,
  t TEXT NOT NULL,
  ev TEXT NOT NULL,
  grant_id TEXT,
  app TEXT,
  ip TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS audit_t ON audit(t);
CREATE TABLE IF NOT EXISTS process_state (app TEXT NOT NULL, proc TEXT NOT NULL, rec TEXT NOT NULL, PRIMARY KEY (app, proc));
CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, t BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key_t ON rate_hits(key, t);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grant_sessions (id_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS grant_sessions_grant ON grant_sessions(grant_id);
`;

export async function openPostgres({ url = process.env.DATABASE_URL, schema = process.env.DATABASE_SCHEMA } = {}) {
  if (!url) throw new Error('DASHBOARD_DB=postgres needs DATABASE_URL (postgres://user:password@host:5432/dbname).');
  if (schema && !/^[a-z_][a-z0-9_]{0,62}$/i.test(schema)) throw new Error('DATABASE_SCHEMA must be a plain identifier.');
  let pg;
  try { pg = (await import('pg')).default; } catch { throw new Error('The Postgres store needs the "pg" package. Run: npm install pg'); }
  if (schema) { // create it first with a throwaway connection, then every pooled connection gets it as its search_path
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    try { await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); } finally { await admin.end(); }
  }
  // Timeouts: without them a database outage makes every request (and the health check) wait forever.
  const pool = new pg.Pool({
    connectionString: url, max: Number(process.env.DATABASE_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5000),
    idleTimeoutMillis: 30000,
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 10000),
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  return openWithPool(pool, url);
}

async function openWithPool(pool, url) {
  pool.on('error', (e) => console.error('postgres pool error:', e.message));
  // The database may still be starting (docker compose starts both together): retry with a growing pause before giving up.
  for (let i = 1; ; i++) {
    try { await pool.query(SCHEMA_SQL); break; } catch (e) {
      if (i >= 10) throw e;
      console.error(`postgres not ready (attempt ${i}/10): ${e.message}`);
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** i, 8000)));
    }
  }
  // Columns added after the first release come from the list both stores share (a no-op when they already exist).
  for (const [name, ddl] of GRANT_EXTRA_COLUMNS) await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS ${name} ${ddl}`);
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  const tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const r = await fn((sql, p = []) => c.query(sql, p).then((x) => x.rows)); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  };
  const AUDIT_INSERT = 'INSERT INTO audit (t, ev, grant_id, app, ip, data) VALUES ($1, $2, $3, $4, $5, $6)';

  let lastRatePrune = 0;
  return {
    kind: 'postgres',
    url: url.replace(/:\/\/[^@]*@/, '://***@'), // never keep the password around
    grants: {
      list: async () => (await q('SELECT * FROM grants ORDER BY created_at, id')).map(toGrant),
      findByHash: async (hash) => toGrant(await one('SELECT * FROM grants WHERE token_hash = $1', [hash])) ?? null,
      findById: async (id) => toGrant(await one('SELECT * FROM grants WHERE id = $1', [id])) ?? null,
      insert: async (g) => {
        await q('INSERT INTO grants (id, token_hash, customer, app, created_at, expires_at, revoked, max_uses, device_lock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [g.id, g.tokenHash, g.customer, g.app, g.createdAt, g.expiresAt, g.revoked ? 1 : 0, g.maxUses ?? null, g.deviceLock ? 1 : 0]);
        return g;
      },
      anonymize: async (id) => void await q("UPDATE grants SET customer = '(removed)' WHERE id = $1", [id]),
      revoke: async (id) => toGrant(await one('UPDATE grants SET revoked = 1 WHERE id = $1 RETURNING *', [id])) ?? null,
      // counts one use and enforces the limits atomically: the row is locked for the duration, so two simultaneous
      // opens of a one-use link cannot both succeed
      redeem: (id, deviceHash) => tx(async (x) => {
        const row = (await x('SELECT * FROM grants WHERE id = $1 FOR UPDATE', [id]))[0];
        if (!row) return { ok: false, why: 'unknown' };
        if (row.max_uses != null && row.uses >= row.max_uses) return { ok: false, why: 'max-uses' };
        if (row.device_lock && row.device_hash && row.device_hash !== deviceHash) return { ok: false, why: 'device-locked' };
        const upd = await x('UPDATE grants SET uses = uses + 1, last_used_at = $1, device_hash = COALESCE(device_hash, $2) WHERE id = $3 RETURNING *',
          [new Date().toISOString(), row.device_lock ? deviceHash : null, id]);
        return { ok: true, grant: toGrant(upd[0]) };
      }),
    },
    grantSessions: {
      create: async (idHash, grantId, expiresAt) => void await q('INSERT INTO grant_sessions (id_hash, grant_id, created_at, expires_at) VALUES ($1,$2,$3,$4)', [idHash, grantId, new Date().toISOString(), expiresAt]),
      get: async (idHash) => liveUntil(await one('SELECT grant_id, expires_at FROM grant_sessions WHERE id_hash = $1', [idHash]), (r) => ({ grantId: r.grant_id, expiresAt: r.expires_at })),
      prune: async () => (await pool.query('DELETE FROM grant_sessions WHERE expires_at <= $1', [new Date().toISOString()])).rowCount,
    },
    sessions: {
      create: async (idHash, expiresAt) => void await q('INSERT INTO sessions (id_hash, created_at, expires_at) VALUES ($1,$2,$3)', [idHash, new Date().toISOString(), expiresAt]),
      get: async (idHash) => liveUntil(await one('SELECT expires_at FROM sessions WHERE id_hash = $1', [idHash]), (r) => ({ expiresAt: r.expires_at })),
      delete: async (idHash) => void await q('DELETE FROM sessions WHERE id_hash = $1', [idHash]),
      prune: async () => (await pool.query('DELETE FROM sessions WHERE expires_at <= $1', [new Date().toISOString()])).rowCount,
      clear: async () => void await q('DELETE FROM sessions'),
    },
    audit: {
      add: async (e) => void await q(AUDIT_INSERT, auditValues(e)),
      addMany: (events) => tx(async (x) => { for (const e of events) await x(AUDIT_INSERT, auditValues(e)); }),
      list: async (limit = 100) => (await q('SELECT * FROM audit ORDER BY id DESC LIMIT $1', [limit])).map(auditFromRow),
      count: async () => Number((await one('SELECT COUNT(*) AS n FROM audit')).n),
      prune: async (days, adminDays = days) => (await pool.query("DELETE FROM audit WHERE t < $1 AND ev NOT LIKE 'admin-%'", [new Date(Date.now() - days * 864e5).toISOString()])).rowCount
        + (await pool.query("DELETE FROM audit WHERE t < $1 AND ev LIKE 'admin-%'", [new Date(Date.now() - adminDays * 864e5).toISOString()])).rowCount,
      deleteForGrant: async (grantId) => (await pool.query('DELETE FROM audit WHERE grant_id = $1', [grantId])).rowCount,
    },
    processState: {
      all: async () => { const out = {}; for (const r of await q('SELECT app, proc, rec FROM process_state')) { const rec = parseStored(r.rec, `process record ${r.app}/${r.proc}`); if (rec) (out[r.app] ??= {})[r.proc] = rec; } return out; },
      set: async (app, proc, rec) => void await q('INSERT INTO process_state (app, proc, rec) VALUES ($1,$2,$3) ON CONFLICT (app, proc) DO UPDATE SET rec = EXCLUDED.rec', [app, proc, JSON.stringify(rec)]),
      remove: async (app, proc) => void await q('DELETE FROM process_state WHERE app = $1 AND proc = $2', [app, proc]),
    },
    rateLimit: {
      count: async (key, windowMs) => Number((await one('SELECT COUNT(*) AS n FROM rate_hits WHERE key = $1 AND t > $2', [key, Date.now() - windowMs])).n),
      // max (optional): see sqlite.mjs. At the limit nothing is recorded and the answer is max + 1.
      hit: async (key, windowMs, max = Infinity) => {
        const now = Date.now();
        if (now - lastRatePrune > 60000) { lastRatePrune = now; await q('DELETE FROM rate_hits WHERE t <= $1', [now - Math.max(windowMs, 3600000)]); }
        if (Number.isFinite(max)) { const n = Number((await one('SELECT COUNT(*) AS n FROM rate_hits WHERE key = $1 AND t > $2', [key, now - windowMs])).n); if (n >= max) return n + 1; }
        await q('INSERT INTO rate_hits (key, t) VALUES ($1,$2)', [key, now]);
        return Number((await one('SELECT COUNT(*) AS n FROM rate_hits WHERE key = $1 AND t > $2', [key, now - windowMs])).n);
      },
    },
    meta: {
      get: async (k) => (await one('SELECT v FROM meta WHERE k = $1', [k]))?.v ?? null,
      set: async (k, v) => void await q('INSERT INTO meta (k, v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', [k, String(v)]),
      claim: async (k, v, staleBefore) => (await pool.query("INSERT INTO meta (k, v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v WHERE meta.v = '' OR meta.v < $3", [k, String(v), String(staleBefore)])).rowCount > 0,
    },
    close: () => pool.end(),
  };
}
