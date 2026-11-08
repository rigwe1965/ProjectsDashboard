# Error Handling Review: ProjectsDashboard

Date: 2026-11-08 · Scope: all runtime code in `admin-console/`, `demo-gateway/`, `lib/`, `lib/store/`, `supervisor/`, `showcase/serve.mjs`, plus the error paths in `admin-console/index.html`. Reviewed at commit `0e9033c`.

Method: full read of the files above. Finding EH-01 was reproduced by running the code; every other finding is from reading it, and I say so where something needs a runtime test to prove it. Importance is on a 1–10 scale (10 = fix first). Line numbers refer to the current tree.

---

## Remediation status (2026-11-08)

All 20 findings were addressed in the working tree (not committed). Tests: 98 pass, lint clean. Changes beyond the snippets below:
- The `/api/apps` response keeps its array shape; a failed status check is signalled with an `x-status-error` response header, which the UI shows.
- `demoApps()` falls back to the last valid registry (and logs) if `apps.json` breaks while running.
- Registry validation now rejects `{port:name}` references to unknown processes.
- EH-20 (client abort) was handled defensively with `req.on('error')`; it was never proven to be a bug.
- New tests: `tests/unit/showcase.test.mjs`, plus "errors:" tests in `console.test.mjs` and `gateway.test.mjs`.
- Not covered by tests: the WebSocket fail-closed re-check (EH-03), the Postgres timeouts/retry (EH-11, needs `TEST_DATABASE_URL`), and the supervisor changes (EH-02/12/14, need a real process).

## 1. Summary

The project handles errors better than most small Node codebases. The pieces that are done well:

- **Last-resort catches.** The console and gateway each wrap `handle()` in a catch that logs the error and returns a generic page (`console.mjs:233-235`, `gateway.mjs:286-289`). A `.catch` also covers the WebSocket `upgrade()` handler (`gateway.mjs:291-293`).
- **No stack traces to clients.** The browser only sees "Error" or a friendly page.
- **Audit and prune failures never break a customer request.** Audit writes are fire-and-forget with a warning logged (`audit` helper, `console.mjs:67`, `gateway.mjs:54`).
- **Upstream failures are mapped correctly.** The gateway returns 504 on timeout and 503 when unreachable (`gateway.mjs:198-204`).
- **Resource cleanup.** WebSocket sockets are cleaned up in one idempotent `close()`, and shutdown has a hard 10-second force-exit.
- **Pool errors.** `pool.on('error')` is handled in `postgres.mjs:58`.
- **Rollbacks.** Transactions roll back (`postgres.mjs:62-67`, `sqlite.mjs:67`).
- **Status codes are mostly right.** 400/401/403/404/413/429/503/504 are used correctly in the common cases.

What is missing is consistency and a safety net:

- There is no central error layer and no error classes.
- There are no process-level `unhandledRejection` or `uncaughtException` handlers.
- Several endpoints turn every failure into one status code (any error becomes 400 or 404), including database failures.
- The supervisor reports success when it failed.
- There are no retries, timeouts or fallbacks around the database, subprocesses or upstreams.

| ID | Finding | Importance |
|---|---|---|
| EH-01 | `showcase/serve.mjs`: malformed URL crashes the server (reproduced) | **7** |
| EH-02 | Supervisor reports `ok:true` / HTTP 200 for failed or unresponsive starts | **7** |
| EH-03 | Open WebSockets are not closed when the grant re-check fails (fails open) | **7** |
| EH-04 | No process-level `unhandledRejection` / `uncaughtException` handlers | **6** |
| EH-05 | Console supervisor timeout (120 s) is shorter than a worst-case start (~122 s) | **6** |
| EH-06 | Demo POST/revoke: every error becomes 400/404, and raw `e.message` reaches the client | **6** |
| EH-07 | Login with JSON body `null` gives a 500 | **5** |
| EH-08 | `pipe()` from upstream response leaves the browser hanging on upstream abort | **5** |
| EH-09 | UI ignores failed revoke, log-load and session-expiry responses | **5** |
| EH-10 | No central error handler or custom error classes | **5** |
| EH-11 | Postgres pool has no connect/statement timeouts; DB outage hangs requests | **5** |
| EH-12 | `spawnApp` child `'error'` event is unhandled; `p.cwd` is not validated | **5** |
| EH-13 | Gateway startup fails if audit pruning fails | **4** |
| EH-14 | `execFileSync` calls in drivers have no timeout | **4** |
| EH-15 | No `Retry-After` on 429 responses; no 405 handling | **3** |
| EH-16 | Silent `.catch(() => {})` blocks (prune timers, `/api/apps` JSON parse) | **3** |
| EH-17 | Logging lacks request context, `cause`, and DB-error metrics | **3** |
| EH-18 | `getStore()` caches a rejected promise forever | **2** |
| EH-19 | No server `'error'` handler on `listen()` (EADDRINUSE) | **2** |
| EH-20 | Unable to verify: client abort mid-request-body (`req` has no `'error'` listener) | **3** |

---

## 2. Findings

### EH-01: Showcase server crashes on a malformed URL · Importance 7/10

**Where:** `showcase/serve.mjs:12`
```js
let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
```
**Reproduced:** with `SHOWCASE_PORT=4299 node showcase/serve.mjs`, `GET /` returned 200. `GET /%E0%A4%A` then made the process exit with `URIError: URI malformed`, and every later request failed to connect. Anything that reaches the port can do this, and the server is bound to 127.0.0.1 only, so the impact is limited to local processes today. If the showcase is ever hosted from this file, that limit goes away. `statSync` and `readFileSync` on lines 15 and 21 can also throw (file deleted between the check and the read) and would crash the process the same way.

**Fix** (replace the handler body):
```js
http.createServer((req, res) => {
  try {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { res.writeHead(400); return res.end('Bad request'); }
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(dist, p));
    let body;
    try {
      if (!file.startsWith(dist + sep) || !statSync(file).isFile()) throw Object.assign(new Error(), { code: 'ENOENT' });
      body = readFileSync(file);
    } catch { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { /* ...existing headers... */ });
    res.end(body);
  } catch (e) {
    console.error('showcase error:', e);
    if (!res.headersSent) res.writeHead(500);
    res.end('Error');
  }
})
```

---

### EH-02: Supervisor reports success for failed or unresponsive starts · Importance 7/10

**Where:**
- `admin-console/console.mjs:31-36` (`defaultSupervisor`): `ok: !err` is based only on the exit code.
- `admin-console/console.mjs:204`: the route always answers `json(res, 200, …)`.
- `supervisor/index.mjs:82`, `:104`: a start that never responds only prints `NOT RESPONDING after 60s`, then exits 0.
- `admin-console/index.html:80-82`, `:133-135`: the UI shows only the last two lines of `output` and ignores `ok`.

**Failure scenario:** an app crashes on boot, so its port never opens. The supervisor waits 60 s, prints a notice and exits 0. The console returns `200 {ok:true, output:"…NOT RESPONDING…"}`. The UI shows the last two output lines like any other message and does not mark it as an error. The owner can think the demo is up and send a customer link. The same applies to `stop`, where "could NOT stop" is reported but the exit code stays 0 (`supervisor/index.mjs:131`).

**Fix:** make the supervisor exit non-zero on those paths, then map failure to a real status.

`supervisor/index.mjs` (track a flag instead of only printing):
```js
let failed = false;
// in start(), both places that print NOT RESPONDING:
if (!up) failed = true;     // container branch (line ~82)
if (!ok) failed = true;     // process branch (line ~104)
// in stop(), both "could NOT stop" branches (lines ~116 and ~131):
failed = true;
// at the bottom, before closeStore():
await closeStore();
if (failed) process.exitCode = 1;
```
`console.mjs:204`:
```js
const r = await o.supervisor([m[2], app.id, ...(only ? [`--only=${only}`] : [])]);
return json(res, r.ok ? 200 : 502, r);
```
`index.html` (two places, `act` and `demoAct`): `say(j.error ? j.error : (j.output.split('\n').slice(-2).join(' · ') || 'Done'))` → also show failure styling when `!r.ok`.

---

### EH-03: WebSocket revocation re-check fails open · Importance 7/10

**Where:** `demo-gateway/gateway.mjs:245-247`
```js
const timer = setInterval(async () => {
  try { const cur = await grantFor(req); if (!isActive(cur) || cur.app !== slug) close('grant-ended'); } catch { /* try again next tick */ }
}, o.wsRecheckMs);
```
**Failure scenario:** the database becomes unreachable (Postgres outage, SQLite locked beyond `busy_timeout`). `grantFor` throws on every tick, the error is swallowed with no log, and every open socket stays up indefinitely. A grant the owner revokes during the outage keeps working. The README promise is that revocation also cuts off open sockets.

**Fix:** count consecutive failures, log them, and close after a short grace window:
```js
let fails = 0;
const timer = setInterval(async () => {
  try {
    const cur = await grantFor(req); fails = 0;
    if (!isActive(cur) || cur.app !== slug) close('grant-ended');
  } catch (e) {
    logger.warn('ws grant re-check failed', { grant: g.id, fails: fails + 1, err: e });
    if (++fails >= 3) close('recheck-failed');   // fail closed after ~15 s with the default 5 s interval
  }
}, o.wsRecheckMs);
```

---

### EH-04: No process-level handlers · Importance 6/10

**Evidence:** `grep -rn "unhandledRejection\|uncaughtException" --include=*.mjs .` returns nothing.

**Impact:** Node 22 terminates on an unhandled rejection or uncaught exception. The log line is a raw stack on stderr, not the structured `logger` format, so JSON log collectors see broken output. The graceful `shutdown()` in `admin-console/server.mjs:262` and `demo-gateway/server.mjs:288` is skipped, so open WebSockets and the DB handle are not closed. EH-01 is an example of what this would contain.

**Fix:** add to `lib/log.mjs` and call from both `server.mjs` files:
```js
// lib/log.mjs
export function installProcessHandlers(onFatal) {
  process.on('unhandledRejection', (err) => { logger.error('unhandled rejection', { err }); onFatal?.('unhandledRejection'); });
  process.on('uncaughtException', (err) => { logger.error('uncaught exception', { err }); onFatal?.('uncaughtException'); });
}
```
```js
// in each server.mjs, after shutdown() is defined
installProcessHandlers((why) => { process.exitCode = 1; shutdown(why); });
```
`shutdown()` already has a 10-second force-exit. Exit rather than continue: state after an uncaught exception is unknown, and the container restart policy brings the service back.

---

### EH-05: Console timeout is shorter than a worst-case start · Importance 6/10

**Where:** `console.mjs:31` (`timeout = 120000` for start/stop/restart) versus `supervisor/index.mjs:81`/`:103` (waits up to 60 × 1 s per process, plus the 800 ms sleep at line 98).

**Evidence:** `registry/apps.json` has apps with 2 non-optional processes (for example `claudeos-demo`, `rmm-demo`). Worst case is 2 × (60 + 0.8) ≈ 121.6 s, over 120 s. `restart` adds the stop time (`killTree` waits up to 5 s on POSIX, `stopContainer` up to 30 s).

**Failure scenario:** `execFile` kills the supervisor mid-start. The console reports `ok:false` with partial output. The record in `process_state` may be half-written, and the UI gives no reason. The `busy` lock is released while a child app may still be coming up.

**Fix:** derive the timeout from the work, and say so when it fires.
```js
function defaultSupervisor(args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(root, 'supervisor', 'index.mjs'), ...args],
      { env: process.env, timeout, windowsHide: true },
      (err, stdout, stderr) => resolve({
        ok: !err,
        timedOut: !!err?.killed,
        output: ((stdout + stderr).trim() || err?.message || '') + (err?.killed ? '\n(timed out; check status)' : ''),
      }));
  });
}
// callers: start/restart use 300000, status keeps 30000
const slow = ['start', 'restart'].includes(m[2]);
await o.supervisor([...], slow ? 300000 : 120000)
```

---

### EH-06: Every demo error becomes 400/404, with raw messages returned · Importance 6/10

**Where:** `console.mjs:219-223` and `:225-228`
```js
try { const b = JSON.parse(body || '{}'); const { grant, link } = await createGrant({...}); return json(res, 200, …); }
catch (e) { return json(res, 400, { error: e.message }); }
...
try { await revokeGrant(m[1]); … } catch (e) { return json(res, 404, { error: e.message }); }
```
**Problems:**
- A database failure inside `createGrant` (`store.grants.insert`, `grants.mjs:346`) is reported as a 400 "client error", and the driver's message is returned to the browser. For Postgres this includes text such as `duplicate key value violates unique constraint "grants_pkey"` or connection errors.
- A database failure during revoke is reported as 404 "No such grant", which tells the owner the grant does not exist when the revoke simply did not happen.
- A JSON body such as `null` makes `b.customer` throw a `TypeError` whose message ("Cannot read properties of null…") is returned to the client.

This is the same gap as EH-10, shown in code. Fix with a small error class so validation errors are distinguishable:

`lib/errors.mjs` (new, see EH-10 for the full file):
```js
export class HttpError extends Error {
  constructor(status, message, opts = {}) { super(message, opts); this.status = status; this.expose = status < 500; }
}
```
`demo-gateway/grants.mjs` (throw typed errors instead of `new Error`):
```js
import { HttpError } from '../lib/errors.mjs';
if (!customer || !app) throw new HttpError(400, 'Customer and app are required');
if (!demoApps()[app]) throw new HttpError(400, `"${app}" has no demo-ready instance`);
// …
if (!t) throw new HttpError(404, 'No such grant');
```
`console.mjs` (let the central catch decide):
```js
if (req.method === 'POST' && url.pathname === '/api/demos') {
  if (!originOk(req)) return json(res, 403, { error: 'bad origin' });
  const b = JSON.parse((await readBody(req)) || '{}');       // SyntaxError → 400 in the central handler
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Expected a JSON object');
  const { grant, link } = await createGrant({ customer: b.customer, app: b.app, hours: b.hours, maxUses: b.maxUses, deviceLock: b.deviceLock });
  return json(res, 200, { grant: publicGrant(grant), link });
}
```
Adopt the central `catch` shown under EH-10 so unexpected errors become a logged 500 with a generic message.

---

### EH-07: Login with JSON `null` returns 500 · Importance 5/10

**Where:** `console.mjs:97` then `:101`/`:106`
```js
let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) { … }
const pwOk = !!hash && verifyPassword(String(b.password ?? ''), hash);   // b === null → TypeError
```
`JSON.parse('null')` (also `'0'`, `'"x"'`, `'[]'` for some fields) passes the try/catch, then `b.password` throws outside any handler. The outer catch logs `console error` and answers a bare `500 Error`. This also burns one of the rate-limit slots first. (By code reading; any POST to `/login` with body `null` while in password mode exercises it.)

**Fix:**
```js
let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: 'bad request' }); }
if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'bad request' });
```
Add a test in `tests/unit/console.test.mjs` posting `null`.

---

### EH-08: Upstream response abort leaves the browser hanging · Importance 5/10

**Where:** `gateway.mjs:195` `ur.pipe(res);`

`stream.pipe()` does not end or destroy the destination when the source closes early or errors. If the demo instance dies or resets mid-response after headers were sent, `res` is never ended and the customer's request hangs until the browser or Caddy times out. `up.on('error')` (line 199-204) only covers the request side before/while the response is being read, and then only destroys `res` if headers were already sent, which does cover some, but not all, abort paths (a response `aborted` event does not always raise an `error` on `up`).

**Fix:** use `pipeline`, which destroys both ends and reports the error:
```js
import { pipeline } from 'node:stream';
// replace `ur.pipe(res);`
pipeline(ur, res, (err) => {
  if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') logger.debug('proxy stream ended early', { err });
});
```
Whether the hang occurs in your Node version is **unable to verify** without a test. The proof is a test that has the fake upstream write headers plus a partial body, then `socket.destroy()`, and asserts the client sees the connection close promptly. `tests/unit/gateway.test.mjs` already has the fake-upstream scaffolding.

---

### EH-09: Admin UI ignores some failures · Importance 5/10

**Where:** `admin-console/index.html`
- `:180` Revoke: `await fetch('/api/demos/' + g.id + '/revoke', { method: 'POST' }); loadDemos();`. The response status is never checked. A failed revoke (EH-06, an expired session, a bad origin) looks the same as a success, which matters because revoke is a security control.
- `:89` `showLog`: `r.json()` with no `try/catch`. A 401/404 produces an unhandled promise rejection in the browser and the dialog never opens.
- `:141` `loadDemos`: `catch { return; }` silently blanks the demo panel on error.
- `:80-83`, `:133-136`, `:165-167`: after a session expires (12 h), API calls return `401 {"error":"sign in required"}` and the user sees that text but is not sent to `/login`.

**Fix** (one helper, used everywhere):
```js
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  let j = {}; try { j = await r.json(); } catch { /* non-JSON body */ }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
// revoke:
onclick: async () => {
  if (!confirm('Revoke the demo link for ' + g.customer + '?')) return;
  try { await api('/api/demos/' + g.id + '/revoke', { method: 'POST' }); say('Revoked'); }
  catch (e) { say('Revoke FAILED: ' + e.message); }
  loadDemos();
}
```
In token mode (no `/login` page) the 401 redirect should instead say "Session ended. Re-open the URL from the terminal".

---

### EH-10: No central error handler or error classes · Importance 5/10

**Current state** (answers to the checklist):
- **Central handler:** there are two last-resort catches (`console.mjs:233-235`, `gateway.mjs:286-289`), but all expected-error handling is hand-written per route. The error response helper `json()` (`lib/http-util.mjs:34`) is used by the console only. The gateway re-implements it as `jsonRes` (`gateway.mjs:80`) and uses `page()` for HTML.
- **Custom errors:** none. The one ad hoc convention is `Object.assign(new Error('too large'), { code: 413 })` (`console.mjs:80`), later tested as `e.code === 413` at `:97`. The gateway uses `{ code: 'ETIMEOUT' }` (`gateway.mjs:198`). Validation and "not found" use plain `Error`, so callers cannot tell them from bugs (EH-06).
- **Response shape:** console API errors are `{error: string}`; the console's non-API errors are plain text ("Forbidden", "Not found", "Unauthorized…") or a bare `500 Error`; the gateway answers HTML pages. Not uniform, but consistent within each surface.

**Fix:** one small module plus one wrapper (no new dependencies).
```js
// lib/errors.mjs
export class HttpError extends Error {
  constructor(status, message, opts = {}) { super(message, opts); this.name = 'HttpError'; this.status = status; this.expose = status < 500; }
}
export const badRequest = (m) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const tooLarge = () => new HttpError(413, 'too large');

// Turns anything thrown into { status, body }. Only HttpError messages (status < 500) reach the client.
export function toResponse(e) {
  if (e instanceof HttpError && e.expose) return { status: e.status, body: { error: e.message } };
  if (e instanceof SyntaxError) return { status: 400, body: { error: 'bad request' } };
  return { status: 500, body: { error: 'internal error' } };
}
```
```js
// console.mjs: replace the outer catch at :233-235
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const { status, body } = toResponse(e);
    if (status >= 500) logger.error('console error', { err: e, method: req.method, path: req.url.split('?')[0] });
    if (res.headersSent) return res.destroy();
    json(res, status, body);
  });
});
```
Then `readBody` throws `tooLarge()` and the `e.code === 413` checks go away. The gateway keeps its own HTML `page()` for customer-facing errors but should use the same `HttpError` for its internals.

---

### EH-11: Postgres has no connection or statement timeouts · Importance 5/10

**Where:** `lib/store/postgres.mjs:53`
```js
const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX || 10), … });
```
`pg` defaults to `connectionTimeoutMillis: 0` (wait forever for a free connection) and no statement timeout. If the database is down or slow, every gateway request (each does two lookups, `grantFor`, plus rate-limit writes) waits with no upper bound, and the health check (`gateway.mjs:81`) hangs rather than returning 503, so the orchestrator never sees the failure. `openPostgres` also gives up immediately on first connect failure (`await pool.query(SCHEMA_SQL)`, line 59) with no retry, which is a problem when the DB and the app start together in `deploy/docker-compose.yml`.

**Fix:**
```js
const pool = new pg.Pool({
  connectionString: url,
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5000),
  idleTimeoutMillis: 30000,
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 10000),
  ...(schema ? { options: `-c search_path=${schema}` } : {}),
});
```
Startup retry (in `openWithPool`, replacing the bare `await pool.query(SCHEMA_SQL)`):
```js
for (let i = 1; ; i++) {
  try { await pool.query(SCHEMA_SQL); break; }
  catch (e) { if (i >= 10) throw e; console.error(`postgres not ready (attempt ${i}/10): ${e.message}`); await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** i, 8000))); }
}
```
Both stores are fail-closed on rate-limit write failure (login and redeem return 500 when the DB is down). That is the right choice for login. For the customer link redeem it is a judgment call: decide on purpose rather than by accident.

---

### EH-12: Child `'error'` event is unhandled; `p.cwd` is unchecked · Importance 5/10

**Where:** `lib/process-driver.mjs:36-38` (posix) and `:12-14` (windows), `supervisor/index.mjs:85`/`:97`

`spawn()` reports failures (for example a non-existent `cwd`) asynchronously as an `'error'` event on the child. Nothing listens, so the supervisor dies with an uncaught exception, possibly after saving a state record with `child.pid === undefined`. Only `app.path` is existence-checked (`index.mjs:69`); `p.cwd` is not, and neither is `fill()` (`index.mjs:36`) which throws `TypeError` if `{port:name}` refers to a process that does not exist.

**Fix:**
```js
// process-driver.mjs, both spawnApp implementations, before child.unref()
child.on('error', (e) => { child.spawnError = e; });
```
```js
// supervisor/index.mjs, after the 800 ms wait
if (child.spawnError || !child.pid) { console.error(`Could not start ${app.id}/${p.name}: ${child.spawnError?.message ?? 'no pid'}`); failed = true; continue; }
```
```js
// supervisor/index.mjs, before spawning
if (!existsSync(cwd)) { console.error(`Working directory not found: ${cwd}`); process.exit(1); }
```
Add `{port:name}` validation to `lib/registry.mjs` `validate()` so the typo is caught at load time:
```js
for (const m of String(p.cmd ?? '').matchAll(/\{port:(\w+)\}/g)) if (!a.processes.some((q) => q.name === m[1])) errs.push(`${pw}: {port:${m[1]}} refers to an unknown process`);
```
Early-exit detection is also missing: if the app dies within the first second, the supervisor still waits the full 60 s. A `child.on('exit')` flag that breaks the poll loop would report the failure immediately.

---

### EH-13: Gateway will not start if audit pruning fails · Importance 4/10

**Where:** `demo-gateway/server.mjs:280`
```js
const pruned = await gw.store.audit.prune(RETENTION_DAYS);
```
Housekeeping is on the critical path of startup. A transient DB error, or `AUDIT_RETENTION_DAYS=abc` (gives `NaN`, producing an invalid date and a thrown `RangeError` in `toISOString()`), stops the gateway from coming up at all.

**Fix:**
```js
let pruned = 0;
try { pruned = await gw.store.audit.prune(Number.isFinite(RETENTION_DAYS) ? RETENTION_DAYS : 90); }
catch (e) { logger.warn('audit prune failed; continuing', { err: e }); }
```

---

### EH-14: Synchronous subprocess calls have no timeout · Importance 4/10

**Where:** `lib/process-driver.mjs:14` (`quiet`, shared by every `execFileSync` for `powershell`, `netstat`, `ss`, `lsof`, `ps`), `:26` (`taskkill`).

A stuck `powershell` or `netstat` blocks the supervisor's event loop indefinitely. `supervisor status` calls `startTime()` once or twice per process. The console kills the supervisor on its 30 s timeout, but on Windows that does not kill the `powershell` grandchild.

**Fix:**
```js
const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true };
// taskkill (line 26): { stdio: 'ignore', timeout: 15000, windowsHide: true }
```

---

### EH-15: Missing `Retry-After`; no 405 · Importance 3/10

- The 429 responses (`console.mjs:95`, `:113`; `gateway.mjs:142`, `:148`, `:229`) carry no `Retry-After` header, though the messages say "wait 15 minutes". Well-behaved clients and Streamlit's reconnect loop cannot back off.
- The console answers 404 for a wrong method on a known path (`console.mjs:230`), for example `GET /api/demos/…/revoke`. Harmless, but 405 with `Allow` is the convention.

**Fix:**
```js
// lib/http-util.mjs
export function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
// usage
return json(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' }, { 'retry-after': '900' });
```
For the gateway `page()`, add an optional headers argument the same way.

---

### EH-16: Silent catches · Importance 3/10

- `console.mjs:236` `Promise.resolve(store.sessions.prune()).catch(() => {})` and the identical `gateway.mjs:62` for `grantSessions.prune()`: a persistent failure (read-only DB, full disk) is never visible, and expired sessions pile up.
- `console.mjs:180` and `:211`: `try { rows = JSON.parse(output); } catch { /* leave empty */ }`. If the supervisor fails or times out, `/api/apps` returns 200 with every process shown as "stopped" and `managed:false`. That is a misleading failure (graceful degradation without telling anyone). The owner may then press Start on something that is running.
- `gateway.mjs:246` is covered by EH-03.

**Fix:**
```js
.catch((err) => logger.warn('session prune failed', { err }))
```
```js
const { ok, output } = await o.supervisor(['status', '--json'], 30000);
let rows = [], statusError = null;
try { rows = JSON.parse(output); } catch { statusError = ok ? 'unreadable status' : 'status check failed'; logger.warn('supervisor status failed', { output: output.slice(0, 300) }); }
// include `statusError` in the JSON and show a banner in the UI
```
This changes the `/api/apps` payload from an array to an object, or use a response header such as `x-status-error: 1` to keep the array.

---

### EH-17: Logging completeness · Importance 3/10

`lib/log.mjs` is clean and JSON-capable, and errors are reduced safely. Gaps:
- Error logs carry no request context: `logger.error('console error', { err: e })` and `'gateway error'` do not say which method/path/host/grant failed. Add a short request id to the logs and the 5xx pages.
- `plain()` (`log.mjs:13`) drops `error.cause` and non-enumerable fields such as `code`, so a Postgres error loses its SQLSTATE and Node system errors lose `errno`/`code`.
- The Postgres pool error handler uses `console.error` (`postgres.mjs:58`) instead of the logger. The same goes for the supervisor, which is a CLI, so it is fine there.
- Metrics count responses by class and upstream errors by kind, but there is no counter for store/DB errors or handler exceptions.

**Fix:**
```js
// lib/log.mjs
const plain = (v) => (v instanceof Error
  ? { message: v.message, code: v.code, stack: v.stack?.split('\n').slice(0, 6).join('\n'), ...(v.cause ? { cause: plain(v.cause) } : {}) }
  : v);
```
```js
// gateway.mjs catch at :286
const id = randomBytes(4).toString('hex');
logger.error('gateway error', { err: e, id, method: req.method, host: req.headers.host, path: req.url.split('?')[0] });
metrics.inc('pd_gateway_handler_errors_total');
if (!res.headersSent) page(res, 500, 'Something went wrong', `Please try again shortly. Reference: ${id}`);
```
Do not log `req.url` with its query string: link tokens appear only in the path `/d/<token>`, so log a truncated form such as `path.replace(/\/d\/[a-f0-9]{48}/, '/d/…')` to keep link tokens out of logs.

---

### EH-18: `getStore()` caches a rejected promise · Importance 2/10

**Where:** `lib/store/index.mjs:114-125`. `opened ??= (async () => …)()`: if opening fails, the rejected promise stays cached, so later callers get the same error, and `closeStore()` (`:128`) then throws on `await opened`. Today the callers are all start-up paths that exit, so the impact is small, but it makes a retry loop (EH-11) impossible.

**Fix:**
```js
export function getStore() {
  opened ??= (async () => { /* existing body */ })().catch((e) => { opened = undefined; throw e; });
  return opened;
}
export async function closeStore() { if (opened) { const p = opened; opened = undefined; try { await (await p).close(); } catch { /* never opened */ } } }
```

---

### EH-19: No `'error'` handler on `listen()` · Importance 2/10

**Where:** `console.mjs:241`, `gateway.mjs:297` (`server.listen(port, host, cb)` wrapped in a promise that can never reject). An `EADDRINUSE` or `EACCES` is emitted as an `'error'` event on the server with no listener, which crashes with a stack trace instead of a clear message.

**Fix:**
```js
listen: (host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(o.port, host, () => { server.off('error', reject); resolve(server.address().port); });
}),
```
and in `server.mjs` catch it for a one-line message (`Port 4300 is already in use`).

---

### EH-20: Client abort during an upload · Importance 3/10 · **Unable to verify**

`gateway.mjs:207-216` attaches a `'data'` listener to `req` and pipes it to `up`, but never `req.on('error', …)`. If a customer's browser drops mid-upload, Node can emit `'error'` (`ECONNRESET`, "aborted") on the request. Recent Node versions only emit it when a listener exists, so this may be harmless. **What would prove it:** a test in `tests/unit/gateway.test.mjs` that opens a POST with `content-length: 1000000`, writes a few bytes, then `socket.destroy()`, and asserts the gateway process neither throws nor leaks `up` sockets. If it fails, add:
```js
req.on('error', () => up.destroy());
```
Adding the line is harmless either way.

---

## 3. Checklist answers

### 1. Consistency
No central handler and no custom error classes (EH-10). Handling is uniform within each surface (console JSON, gateway HTML pages) but not between them, and several routes use one status for all failures (EH-06).

### 2. Categories

| Class | Status today |
|---|---|
| Validation 400 | Present: bad JSON (`console.mjs:97`), unknown filter (`:170`), unknown process (`:201`). Mixed with server errors in `/api/demos` (EH-06); `null` JSON gives 500 (EH-07). |
| Auth 401 | Present and correct: console API 401 (`:146`), token mode 401 (`:155`), gateway 401 (`:171`). |
| Authorization 403 | Present: host allow-list (`:125`), origin check, gateway grant ended (`:174`), wrong product. |
| Not found 404 | Present, but revoke maps *any* error to 404 (EH-06). |
| Server 500 | Generic and logged; no request id (EH-17). |
| Rate limit 429 | Present on login, redeem, and WebSockets; lacks `Retry-After` (EH-15). |
| Others | 413, 409 (`busy`), 502 absent for failed supervisor commands (EH-02), 503/504 correct on the gateway. |

### 3. Async
- No unhandled-rejection safety net (EH-04).
- Express-style async wrapper: not needed; both servers use one `handle().catch()`, which is equivalent and fine.
- Callback errors: `execFile` callbacks handle `err` (`console.mjs:34`, `docker.mjs:12`). `spawn` child `'error'` is not handled (EH-12).
- Event emitters: handled for `up`, `upstream`, `socket`, pool. Not handled for `server` (EH-19), spawned children (EH-12), and possibly `req` (EH-20).
- Fire-and-forget promises are mostly caught; `auditDenied` is awaited inside the request path (a rate-limit write failure there turns a 403 into a 500).

### 4. Recovery
- **Graceful degradation:** audit is best-effort (good). Supervisor failure shows every app as "stopped" instead of an error (EH-16). DB outage is a hard outage for all demos and all open WebSockets silently stay up (EH-03, EH-11).
- **Retries:** none anywhere (DB connect at startup, upstream GET, `docker` calls). For a single-owner tool, only the DB startup retry (EH-11) is worth adding.
- **Circuit breakers:** none. A dead demo instance gets a fresh connect attempt per request (fast `ECONNREFUSED` on loopback), so this is acceptable. Not recommended at this scale.
- **Fallbacks:** the registry loader caches by mtime and throws on an invalid file (`registry.mjs:83`). If someone saves a bad `apps.json` while the console runs, `loadRegistry()` is called once at start, so a bad edit is only caught at the next restart, and the gateway's `demoApps()` re-reads on every call and would throw a 500 for every request until the file is fixed. Wrap `demoApps()` in a try/catch that keeps serving the last valid registry:
```js
// grants.mjs
let lastGood = {};
export function demoApps() {
  try {
    const reg = loadRegistry(registryPath);
    lastGood = Object.fromEntries(reg.apps.filter((a) => a.demoOf && a.demoReady === true).map((a) => [a.demoOf, a]));
  } catch (e) { logger.error('registry reload failed; using last valid copy', { err: e }); }
  return lastGood;
}
```
(import `logger` from `../lib/log.mjs`). This one is worth doing: it is a quick edit and it turns a total outage into a log line. Importance 4/10.

### 5. Error information
- **Dev vs prod:** there is no `NODE_ENV` switch, and none is needed. Clients never receive stacks. The exceptions are the raw `e.message` returns in `console.mjs:223` and `:227` (EH-06) and `login` text, which is deliberately generic.
- **Logs:** stacks are written (trimmed to 6 lines), which is appropriate for server logs. They lose `code`/`cause` (EH-17). Query strings are not logged; keep it that way.
- **Friendly messages:** the gateway pages are customer-appropriate. The console's non-API errors are terse plain text ("Error", "Forbidden"), acceptable for an owner-only tool.

---

## 4. Suggested order of work

1. EH-01 (5 minutes, remote-triggerable crash).
2. EH-04 + EH-19 + EH-13 (small, make crashes and startup failures clean).
3. EH-02 + EH-05 + EH-09 (the owner is told the truth about start/stop/revoke).
4. EH-03 (fail closed on revocation re-check).
5. EH-10 + EH-06 + EH-07 (error class and central catch; fixes the 400/404 mislabelling).
6. EH-11, EH-12, EH-08, then the rest.

Tests to add alongside: `GET /%E0%A4%A` on the showcase server; `POST /login` with body `null`; supervisor `start` of an app whose port never opens (expect non-zero exit and a 502 from the console); a gateway test where the store throws during the WebSocket re-check; a fake upstream that destroys its socket mid-response.
