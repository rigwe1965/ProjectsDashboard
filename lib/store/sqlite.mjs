// SQLite store (built-in node:sqlite, no dependency). All methods are synchronous here, but callers must
// `await` them: the Postgres store (Stage 4) implements the same interface asynchronously.
//
// Interface (see lib/store/index.mjs):
//   grants:       list() findByHash(hash) findById(id) insert(grant) revoke(id) redeem(id, deviceHash)
//   grantSessions: create(idHash, grantId, expiresAt) get(idHash) prune()   (a customer's browser session, minted when a demo link is opened)
//   sessions:     create(idHash, expiresAt) get(idHash) delete(idHash) prune() clear()   (admin console logins)
//   audit:        add(event) addMany(events) list(limit) count() prune(days)
//   processState: all() set(app, proc, rec) remove(app, proc)
//   rateLimit:    hit(key, windowMs) -> number of hits in the window, including this one; count(key, windowMs) -> same, without adding a hit
//   meta:         get(key) set(key, value)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t TEXT NOT NULL,
  ev TEXT NOT NULL,
  grant_id TEXT,
  app TEXT,
  ip TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS audit_t ON audit(t);
CREATE TABLE IF NOT EXISTS process_state (
  app TEXT NOT NULL,
  proc TEXT NOT NULL,
  rec TEXT NOT NULL,
  PRIMARY KEY (app, proc)
);
CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key_t ON rate_hits(key, t);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grant_sessions (id_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS grant_sessions_grant ON grant_sessions(grant_id);
`;

const toGrant = (r) => r && ({ id: r.id, tokenHash: r.token_hash, customer: r.customer, app: r.app,
  createdAt: r.created_at, expiresAt: r.expires_at, revoked: !!r.revoked,
  uses: r.uses ?? 0, maxUses: r.max_uses ?? null, deviceLock: !!r.device_lock, lastUsedAt: r.last_used_at ?? null });

export function openSqlite(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL + busy timeout: the gateway, the console and short-lived supervisor processes all open this file.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  // Columns added after the first release (existing databases are upgraded in place, no data is touched).
  const have = new Set(db.prepare('PRAGMA table_info(grants)').all().map((c) => c.name));
  for (const [name, ddl] of [['uses', 'INTEGER NOT NULL DEFAULT 0'], ['max_uses', 'INTEGER'], ['device_lock', 'INTEGER NOT NULL DEFAULT 0'], ['device_hash', 'TEXT'], ['last_used_at', 'TEXT']]) {
    if (!have.has(name)) db.exec(`ALTER TABLE grants ADD COLUMN ${name} ${ddl}`);
  }
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const stmts = {
    gList: q('SELECT * FROM grants ORDER BY created_at, rowid'),
    gFind: q('SELECT * FROM grants WHERE token_hash = ?'),
    gInsert: q('INSERT INTO grants (id, token_hash, customer, app, created_at, expires_at, revoked, max_uses, device_lock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    gUse: q('UPDATE grants SET uses = uses + 1, last_used_at = ?, device_hash = COALESCE(device_hash, ?) WHERE id = ?'),
    gsCreate: q('INSERT INTO grant_sessions (id_hash, grant_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    gsGet: q('SELECT grant_id, expires_at FROM grant_sessions WHERE id_hash = ?'),
    gsPrune: q('DELETE FROM grant_sessions WHERE expires_at <= ?'),
    sCreate: q('INSERT INTO sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)'),
    sGet: q('SELECT expires_at FROM sessions WHERE id_hash = ?'),
    sDelete: q('DELETE FROM sessions WHERE id_hash = ?'),
    sPrune: q('DELETE FROM sessions WHERE expires_at <= ?'),
    gGet: q('SELECT * FROM grants WHERE id = ?'),
    gRevoke: q('UPDATE grants SET revoked = 1 WHERE id = ?'),
    aAdd: q('INSERT INTO audit (t, ev, grant_id, app, ip, data) VALUES (?, ?, ?, ?, ?, ?)'),
    aList: q('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
    aCount: q('SELECT COUNT(*) AS n FROM audit'),
    aPrune: q('DELETE FROM audit WHERE t < ?'),
    pAll: q('SELECT app, proc, rec FROM process_state'),
    pSet: q('INSERT INTO process_state (app, proc, rec) VALUES (?, ?, ?) ON CONFLICT(app, proc) DO UPDATE SET rec = excluded.rec'),
    pRemove: q('DELETE FROM process_state WHERE app = ? AND proc = ?'),
    rAdd: q('INSERT INTO rate_hits (key, t) VALUES (?, ?)'),
    rCount: q('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND t > ?'),
    rPrune: q('DELETE FROM rate_hits WHERE t <= ?'),
    mGet: q('SELECT v FROM meta WHERE k = ?'),
    mSet: q('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
  };

  let lastRatePrune = 0;
  return {
    kind: 'sqlite',
    file,
    grants: {
      list: () => stmts.gList.all().map(toGrant),
      findByHash: (hash) => toGrant(stmts.gFind.get(hash)) ?? null,
      findById: (id) => toGrant(stmts.gGet.get(id)) ?? null,
      insert: (g) => { stmts.gInsert.run(g.id, g.tokenHash, g.customer, g.app, g.createdAt, g.expiresAt, g.revoked ? 1 : 0, g.maxUses ?? null, g.deviceLock ? 1 : 0); return g; },
      // Counts one use of a link and enforces its limits, atomically. The caller has already checked revoked/expired.
      // deviceHash identifies the browser (hash of its User-Agent): a device-locked link is pinned to the first one that uses it.
      redeem: (id, deviceHash) => tx(() => {
        const row = stmts.gGet.get(id);
        if (!row) return { ok: false, why: 'unknown' };
        if (row.max_uses != null && row.uses >= row.max_uses) return { ok: false, why: 'max-uses' };
        if (row.device_lock && row.device_hash && row.device_hash !== deviceHash) return { ok: false, why: 'device-locked' };
        stmts.gUse.run(new Date().toISOString(), row.device_lock ? deviceHash : null, id);
        return { ok: true, grant: toGrant(stmts.gGet.get(id)) };
      }),
      revoke: (id) => tx(() => { if (!stmts.gGet.get(id)) return null; stmts.gRevoke.run(id); return toGrant(stmts.gGet.get(id)); }),
    },
    grantSessions: {
      create: (idHash, grantId, expiresAt) => void stmts.gsCreate.run(idHash, grantId, new Date().toISOString(), expiresAt),
      get: (idHash) => { const r = stmts.gsGet.get(idHash); return r && Date.parse(r.expires_at) > Date.now() ? { grantId: r.grant_id, expiresAt: r.expires_at } : null; },
      prune: () => Number(stmts.gsPrune.run(new Date().toISOString()).changes),
    },
    sessions: {
      create: (idHash, expiresAt) => void stmts.sCreate.run(idHash, new Date().toISOString(), expiresAt),
      get: (idHash) => { const r = stmts.sGet.get(idHash); return r && Date.parse(r.expires_at) > Date.now() ? { expiresAt: r.expires_at } : null; },
      delete: (idHash) => void stmts.sDelete.run(idHash),
      prune: () => Number(stmts.sPrune.run(new Date().toISOString()).changes),
      clear: () => void db.exec('DELETE FROM sessions'),
    },
    audit: {
      add: ({ t = new Date().toISOString(), ev, grant, app, ip, ...rest }) =>
        void stmts.aAdd.run(t, ev, grant ?? null, app ?? null, ip ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null),
      addMany: (events) => tx(() => { for (const { t = new Date().toISOString(), ev, grant, app, ip, ...rest } of events)
        stmts.aAdd.run(t, ev, grant ?? null, app ?? null, ip ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null); }),
      list: (limit = 100) => stmts.aList.all(limit).map((r) => ({ t: r.t, ev: r.ev, grant: r.grant_id ?? undefined, app: r.app ?? undefined, ip: r.ip ?? undefined, ...(r.data ? JSON.parse(r.data) : {}) })),
      count: () => stmts.aCount.get().n,
      prune: (days) => Number(stmts.aPrune.run(new Date(Date.now() - days * 864e5).toISOString()).changes),
    },
    processState: {
      all: () => { const out = {}; for (const r of stmts.pAll.all()) (out[r.app] ??= {})[r.proc] = JSON.parse(r.rec); return out; },
      set: (app, proc, rec) => void stmts.pSet.run(app, proc, JSON.stringify(rec)),
      remove: (app, proc) => void stmts.pRemove.run(app, proc),
    },
    rateLimit: {
      count: (key, windowMs) => stmts.rCount.get(key, Date.now() - windowMs).n, // like hit(), without recording one
      hit: (key, windowMs) => {
        const now = Date.now();
        return tx(() => {
          stmts.rAdd.run(key, now);
          if (now - lastRatePrune > 60000) { lastRatePrune = now; stmts.rPrune.run(now - Math.max(windowMs, 3600000)); } // keeps the table small
          return stmts.rCount.get(key, now - windowMs).n;
        });
      },
    },
    meta: {
      get: (k) => stmts.mGet.get(k)?.v ?? null,
      set: (k, v) => void stmts.mSet.run(k, String(v)),
    },
    close: () => db.close(),
  };
}
