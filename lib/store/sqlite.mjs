// SQLite store (built-in node:sqlite, no dependency). All methods are synchronous here, but callers must
// `await` them: the Postgres store (Stage 4) implements the same interface asynchronously.
//
// Interface (see lib/store/index.mjs):
//   grants:       list() findByHash(hash) findById(id) insert(grant) revoke(id) anonymize(id) redeem(id, deviceHash)
//   grantSessions: create(idHash, grantId, expiresAt) get(idHash) prune()   (a customer's browser session, minted when a demo link is opened)
//   sessions:     create(idHash, expiresAt) get(idHash) delete(idHash) prune() clear()   (admin console logins)
//   audit:        add(event) addMany(events) list(limit) count() prune(days, adminDays) deleteForGrant(grantId)
//   activity:     add(grantId, day, delta) forGrant(grantId) summary(sinceDay) prune(days) deleteForGrant(grantId)   (per-link rollup, see shared.mjs)
//   guideUsage:   add(grantId, day, delta) forGrant(grantId) totalForGrant(grantId) totalForDay(day) prune(days) deleteForGrant(grantId)   (AI guide counts and cost, no text)
//   processState: all() set(app, proc, rec) remove(app, proc)
//   rateLimit:    hit(key, windowMs) -> number of hits in the window, including this one; count(key, windowMs) -> same, without adding a hit
//   meta:         get(key) set(key, value) claim(key, value, staleBefore)
//   backup(file)  SQLite only: consistent copy of the database into a new file (the Postgres store has none; use pg_dump)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { GRANT_EXTRA_COLUMNS, toGrant, auditValues, auditFromRow, liveUntil, parseStored, mergeActivity, toActivity, toActivitySummary, isDay, mergeGuideUsage, toGuideUsage, toGuideTotals } from './shared.mjs';

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
CREATE TABLE IF NOT EXISTS grant_activity (
  grant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  first_at TEXT,
  last_at TEXT,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  ws_seconds INTEGER NOT NULL DEFAULT 0,
  top_paths TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (grant_id, day)
);
CREATE INDEX IF NOT EXISTS grant_activity_day ON grant_activity(day);
CREATE TABLE IF NOT EXISTS guide_usage (
  grant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (grant_id, day)
);
CREATE INDEX IF NOT EXISTS guide_usage_day ON guide_usage(day);
`;


// Run fn; while SQLite says "database is locked", wait a few milliseconds and run it again (up to about 5 seconds). Any other error, or
// the last "locked", is thrown. Used for the one-time set-up that several processes may do at the same moment.
export function retryWhileLocked(fn, { tries = 100, waitMs = 50, sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= tries || !/database is locked|SQLITE_BUSY/i.test(String(e?.message))) throw e;
      sleep(waitMs + Math.floor(Math.random() * waitMs));
    }
  }
}

// Add the columns a table does not have yet. Two processes starting at once on an old or new file (gateway and console) can both see a
// column missing; the one that loses the race gets "duplicate column name", which means the work is already done, so it is ignored.
export function addMissingColumns(db, table, columns) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, ddl] of columns) {
    if (have.has(name)) continue;
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`); }
    catch (e) { if (!/duplicate column name/i.test(String(e?.message))) throw e; }
  }
}

export function openSqlite(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL + busy timeout: the gateway, the console and short-lived supervisor processes all open this file.
  // busy_timeout comes first: switching a brand-new file to WAL needs a lock, and two processes starting together (gateway and console)
  // would otherwise fail at once with "database is locked" instead of waiting.
  // Even so, SQLite refuses the WAL switch at once (busy timeout or not) when another process is in the middle of the same switch, so the
  // whole set-up is retried briefly while the answer is "database is locked".
  retryWhileLocked(() => {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.exec(SCHEMA);
    // Columns added after the first release (existing databases are upgraded in place, no data is touched).
    addMissingColumns(db, 'grants', GRANT_EXTRA_COLUMNS);
  });
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const stmts = {
    gList: q('SELECT * FROM grants ORDER BY created_at, rowid'),
    gFind: q('SELECT * FROM grants WHERE token_hash = ?'),
    gInsert: q('INSERT INTO grants (id, token_hash, customer, app, created_at, expires_at, revoked, max_uses, device_lock, display_name, welcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
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
    aPrune: q("DELETE FROM audit WHERE t < ? AND ev NOT LIKE 'admin-%'"),
    aPruneAdmin: q("DELETE FROM audit WHERE t < ? AND ev LIKE 'admin-%'"),
    gForget: q("UPDATE grants SET customer = '(removed)', display_name = NULL, welcome = NULL WHERE id = ?"),
    aForget: q('DELETE FROM audit WHERE grant_id = ?'),
    acInit: q('INSERT INTO grant_activity (grant_id, day) VALUES (?, ?) ON CONFLICT(grant_id, day) DO NOTHING'),
    acGet: q('SELECT * FROM grant_activity WHERE grant_id = ? AND day = ?'),
    acSet: q('UPDATE grant_activity SET requests = ?, first_at = ?, last_at = ?, active_seconds = ?, ws_seconds = ?, top_paths = ? WHERE grant_id = ? AND day = ?'),
    acFor: q('SELECT * FROM grant_activity WHERE grant_id = ? ORDER BY day'),
    acSummary: q('SELECT grant_id, COUNT(*) AS days, SUM(requests) AS requests, SUM(active_seconds) AS active_seconds, SUM(ws_seconds) AS ws_seconds, MIN(first_at) AS first_at, MAX(last_at) AS last_at FROM grant_activity WHERE day >= ? GROUP BY grant_id'),
    acPrune: q('DELETE FROM grant_activity WHERE day < ?'),
    acForget: q('DELETE FROM grant_activity WHERE grant_id = ?'),
    guInit: q('INSERT INTO guide_usage (grant_id, day) VALUES (?, ?) ON CONFLICT(grant_id, day) DO NOTHING'),
    guGet: q('SELECT * FROM guide_usage WHERE grant_id = ? AND day = ?'),
    guSet: q('UPDATE guide_usage SET messages = ?, input_tokens = ?, cached_tokens = ?, output_tokens = ?, cost_micro = ? WHERE grant_id = ? AND day = ?'),
    guFor: q('SELECT * FROM guide_usage WHERE grant_id = ? ORDER BY day'),
    guTotal: q('SELECT SUM(messages) AS messages, SUM(input_tokens) AS input_tokens, SUM(cached_tokens) AS cached_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_micro) AS cost_micro FROM guide_usage WHERE grant_id = ?'),
    guDay: q('SELECT SUM(messages) AS messages, SUM(input_tokens) AS input_tokens, SUM(cached_tokens) AS cached_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_micro) AS cost_micro FROM guide_usage WHERE day = ?'),
    guPrune: q('DELETE FROM guide_usage WHERE day < ?'),
    guForget: q('DELETE FROM guide_usage WHERE grant_id = ?'),
    pAll: q('SELECT app, proc, rec FROM process_state'),
    pSet: q('INSERT INTO process_state (app, proc, rec) VALUES (?, ?, ?) ON CONFLICT(app, proc) DO UPDATE SET rec = excluded.rec'),
    pRemove: q('DELETE FROM process_state WHERE app = ? AND proc = ?'),
    rAdd: q('INSERT INTO rate_hits (key, t) VALUES (?, ?)'),
    rCount: q('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND t > ?'),
    rPrune: q('DELETE FROM rate_hits WHERE t <= ?'),
    mGet: q('SELECT v FROM meta WHERE k = ?'),
    mSet: q('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
    mClaim: q("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE meta.v = '' OR meta.v < ?"),
  };

  let lastRatePrune = 0;
  return {
    kind: 'sqlite',
    file,
    grants: {
      list: () => stmts.gList.all().map(toGrant),
      findByHash: (hash) => toGrant(stmts.gFind.get(hash)) ?? null,
      findById: (id) => toGrant(stmts.gGet.get(id)) ?? null,
      insert: (g) => { stmts.gInsert.run(g.id, g.tokenHash, g.customer, g.app, g.createdAt, g.expiresAt, g.revoked ? 1 : 0, g.maxUses ?? null, g.deviceLock ? 1 : 0, g.displayName ?? null, g.welcome ?? null); return g; },
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
      anonymize: (id) => void stmts.gForget.run(id), // replaces the customer's name on the grant and drops the name and note shown to them
      revoke: (id) => tx(() => { if (!stmts.gGet.get(id)) return null; stmts.gRevoke.run(id); return toGrant(stmts.gGet.get(id)); }),
    },
    grantSessions: {
      create: (idHash, grantId, expiresAt) => void stmts.gsCreate.run(idHash, grantId, new Date().toISOString(), expiresAt),
      get: (idHash) => liveUntil(stmts.gsGet.get(idHash), (r) => ({ grantId: r.grant_id, expiresAt: r.expires_at })),
      prune: () => Number(stmts.gsPrune.run(new Date().toISOString()).changes),
    },
    sessions: {
      create: (idHash, expiresAt) => void stmts.sCreate.run(idHash, new Date().toISOString(), expiresAt),
      get: (idHash) => liveUntil(stmts.sGet.get(idHash), (r) => ({ expiresAt: r.expires_at })),
      delete: (idHash) => void stmts.sDelete.run(idHash),
      prune: () => Number(stmts.sPrune.run(new Date().toISOString()).changes),
      clear: () => void db.exec('DELETE FROM sessions'),
    },
    audit: {
      add: (e) => void stmts.aAdd.run(...auditValues(e)),
      addMany: (events) => tx(() => { for (const e of events) stmts.aAdd.run(...auditValues(e)); }),
      list: (limit = 100) => stmts.aList.all(limit).map(auditFromRow),
      count: () => stmts.aCount.get().n,
      // Customer events go after `days`; the owner's own sign-in events (ev starting 'admin-') after `adminDays` (default: the same).
      prune: (days, adminDays = days) => Number(stmts.aPrune.run(new Date(Date.now() - days * 864e5).toISOString()).changes)
        + Number(stmts.aPruneAdmin.run(new Date(Date.now() - adminDays * 864e5).toISOString()).changes),
      deleteForGrant: (grantId) => Number(stmts.aForget.run(grantId).changes),
    },
    activity: {
      // Adds one batch to a link's row for that UTC day (day: 'YYYY-MM-DD'); see mergeActivity in shared.mjs for the batch's shape.
      add: (grantId, day, delta) => {
        if (!isDay(day)) throw new Error('activity day must be YYYY-MM-DD');
        tx(() => { stmts.acInit.run(grantId, day); stmts.acSet.run(...mergeActivity(stmts.acGet.get(grantId, day), delta), grantId, day); });
      },
      forGrant: (grantId) => stmts.acFor.all(grantId).map(toActivity),
      summary: (sinceDay = '0000-00-00') => stmts.acSummary.all(sinceDay).map(toActivitySummary), // one row per link with activity on or after sinceDay
      prune: (days) => Number(stmts.acPrune.run(new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)).changes), // rows for days before the cutoff
      deleteForGrant: (grantId) => Number(stmts.acForget.run(grantId).changes),
    },
    // AI guide usage per link per UTC day: counts and estimated cost only (see mergeGuideUsage in shared.mjs).
    guideUsage: {
      add: (grantId, day, delta) => {
        if (!isDay(day)) throw new Error('guide usage day must be YYYY-MM-DD');
        tx(() => { stmts.guInit.run(grantId, day); stmts.guSet.run(...mergeGuideUsage(stmts.guGet.get(grantId, day), delta), grantId, day); });
      },
      forGrant: (grantId) => stmts.guFor.all(grantId).map(toGuideUsage),
      totalForGrant: (grantId) => toGuideTotals(stmts.guTotal.get(grantId)), // all days: the link's allowance is for its whole life
      totalForDay: (day) => toGuideTotals(stmts.guDay.get(day)), // all links: the gateway's daily spending cap
      prune: (days) => Number(stmts.guPrune.run(new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)).changes),
      deleteForGrant: (grantId) => Number(stmts.guForget.run(grantId).changes),
    },
    processState: {
      all: () => { const out = {}; for (const r of stmts.pAll.all()) { const rec = parseStored(r.rec, `process record ${r.app}/${r.proc}`); if (rec) (out[r.app] ??= {})[r.proc] = rec; } return out; },
      set: (app, proc, rec) => void stmts.pSet.run(app, proc, JSON.stringify(rec)),
      remove: (app, proc) => void stmts.pRemove.run(app, proc),
    },
    rateLimit: {
      count: (key, windowMs) => stmts.rCount.get(key, Date.now() - windowMs).n, // like hit(), without recording one
      // max (optional): the caller's limit. Once the window already holds max hits, a further one is NOT recorded and the answer is
      // max + 1, so a flood from one key neither grows the table nor makes every later check slower.
      hit: (key, windowMs, max = Infinity) => {
        const now = Date.now();
        return tx(() => {
          if (Number.isFinite(max)) { const n = stmts.rCount.get(key, now - windowMs).n; if (n >= max) return n + 1; }
          stmts.rAdd.run(key, now);
          if (now - lastRatePrune > 60000) { lastRatePrune = now; stmts.rPrune.run(now - Math.max(windowMs, 3600000)); } // keeps the table small
          return stmts.rCount.get(key, now - windowMs).n;
        });
      },
    },
    meta: {
      get: (k) => stmts.mGet.get(k)?.v ?? null,
      set: (k, v) => void stmts.mSet.run(k, String(v)),
      // Sets the value only if the key is absent, empty, or holds a value that sorts before `staleBefore` (ISO times sort as text), in ONE
      // statement, so of two processes claiming at once exactly one wins. True when this call took it.
      claim: (k, v, staleBefore) => Number(stmts.mClaim.run(k, String(v), String(staleBefore)).changes) > 0,
    },
    // Consistent copy of the live database into a new file (safe while other processes write; the target must not exist).
    backup: (file) => void db.prepare('VACUUM INTO ?').run(file),
    close: () => db.close(),
  };
}
