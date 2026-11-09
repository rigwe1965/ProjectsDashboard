# Code duplication audit: ProjectsDashboard

Date: 2026-11-09 · Branch `main` at `d49c8f3` · Scope: every git-tracked file that is code or configuration (`lib/`, `admin-console/`, `demo-gateway/`, `supervisor/`, `showcase/`, `tests/`, `registry/`, `deploy/`, `*.bat`). Not covered: the sibling app folders in the same directory tree (`ClaudeWorkspace/`, `CRM/`, `RemoteManagementSystem/`, `data/demo-src/`); they are other projects, not this repository.

**Size of what was read:** about 3,480 lines of production JavaScript, 463 lines of console HTML, 2,425 lines of tests, plus the registry, compose file, Dockerfiles, launchers and four Python helpers.

**How the percentages were measured.** `jscpd` could not be run here (the tool call was denied), so there is no tool-generated baseline. Two hand measurements are used and each finding says which:

- **exact-line**: share of a file's lines (trimmed, 20+ characters, comments excluded) that also occur verbatim in the compared file. This understates structural duplication, because SQL placeholders (`?` against `$1`) and `await` differences defeat an exact match.
- **structural**: share of the lines that repeat a construct with only names, placeholders or constants changed. This is a reading of the code, not a tool count. Treat it as ±10 points.

## Result

The codebase is in better shape than the average for its size: there is already a shared `lib/` (`http-util`, `errors`, `log`, `metrics`, `config`), the compose file already uses YAML anchors, and `lib/store/index.mjs` plus a contract test keep the two database backends honest. The duplication that is left falls into three groups:

1. **Two database backends written side by side.** Already drifting (D-01).
2. **Small helpers copied between scripts**: the env-file parser exists in six places, and `num`, `jsonRes`, the audit wrapper, the serial lock and the SHA-256 helper each exist two or three times (D-02, D-06, D-08, D-09).
3. **Repeated configuration**: default ports, security-header baselines and the page design tokens (D-03, D-07, D-11).

Nothing found is a defect today except the hard-coded port in `start-console.bat` (D-07), which already disagrees with the server's `CONSOLE_PORT` setting.

| ID | Finding | Type | Measured | Importance | Effort |
| --- | --- | --- | --- | --- | --- |
| D-01 | `sqlite.mjs` and `postgres.mjs` repeat schema, row mappers and audit packing; the schemas have already drifted | Structural / data | 21% exact, about 55% structural | **6/10** | 3 h |
| D-02 | `KEY=value` env-file parser and its "stop on missing key" boilerplate in six scripts | Exact + near | about 8 lines x 6 | **5/10** | 1 h |
| D-03 | `supervisor/index.mjs`: three step runners share one log/failure block; `{port:name}` substitution written five times | Near / structural | about 45 of 283 lines (16%) | **5/10** | 2 h |
| D-04 | `gateway.mjs` repeats its audit-denied record, rate-limit page and HTML page template | Structural | about 30 of 422 lines (7%) | **3/10** | 1 h |
| D-05 | Small helpers copied between modules (`num`, `jsonRes`, audit wrapper, serial lock, sweep guard, `peer`, error text) | Exact | 14 occurrences, 8 helpers | **4/10** | 1 h |
| D-06 | Three SHA-256 hex helpers | Exact | 3 definitions | **3/10** | 15 min |
| D-07 | Default ports and `CONSOLE_PORT` / `GATEWAY_PORT` repeated in code, launchers and proxy config; one launcher ignores the variable | Data / config | 12 places | **4/10** | 1 h |
| D-08 | Security-header baseline written three times | Structural / data | 3 blocks | **4/10** | 1 h |
| D-09 | Admin console auth: meta-key strings and the `originOk` / JSON-object guards repeated | Data + structural | 26 string uses, 8 guards | **3/10** | 1 h |
| D-10 | Design tokens and brand colours repeated across the console pages and the showcase | Data | 3 copies of the token block, 3 of the palette | **3/10** | 2 h (needs a CSP change) |
| D-11 | Registry: local and hosted files repeat product metadata; `registry.mjs` repeats step validation | Data / structural | 6 of 14 keys identical per app | **3/10** | 2 h |
| D-12 | Test helpers redefined per file | Exact + near | about 70 of 2,425 lines (3%) | **3/10** | 2 h |
| D-13 | RMM Python helpers share a "start containers, wait for ports" block | Near | 14 lines x 2 | **3/10** | 30 min |
| D-14 | Compose hardening repeated on five services next to an unused anchor | Structural | 10 lines | **2/10** | 20 min |
| D-15 | Windows launchers repeat prerequisite and wait loops | Structural | 38% / 11% / 6% exact against `start-console.bat` | **2/10** | 1 h |
| D-16 | Name collision: two exported `RETRY_AFTER_FAIL_MS` with different values | Naming | 2 | **2/10** | 10 min |
| D-17 | Windows and POSIX process drivers | Structural | about 12 lines | **1/10** | not worth it |

Sorting by value for effort: D-02, D-06, D-05 and D-07 first (small, mechanical, low risk), then D-01 and D-03 (largest payoff), then the rest as you touch those files.

## Remediation status (2026-11-09)

- **Done:** D-06 (one `sha256`; `hashSessionId` and `hashToken` are aliases), D-16 (constants renamed `INSTANCE_RETRY_AFTER_FAIL_MS` and `RESET_RETRY_AFTER_FAIL_MS`), and D-05 except two items: the `sleep` replacements and the shared health check are still to do.
- **Done (second batch):** D-02 (the six scripts use `parseEnvText`; `missingKeys` added to `lib/util.mjs`; `run-with-env.mjs` no longer has its own parser, and `tests/journeys.mjs` keeps its own because it filters differently) and D-07 (`lib/config.mjs` is the one reader of the three port variables; `start-console.bat` and `start-showcase.bat` honour `CONSOLE_PORT` / `SHOWCASE_PORT`). The Caddyfile, compose file and `start-customer-demo.bat` still hold 4300 and 4100 literally.
- **Next, in order:** D-01 and D-03.
- After these changes: lint clean, 168 of 169 tests pass (one skipped, as before).

## The utilities module

Created: `lib/util.mjs` and `tests/unit/util.test.mjs` (7 tests). Nothing existing was changed to use it yet, so behaviour is unchanged; the full suite passes (167 of 168, one skipped, the same as before) and lint is clean. Each finding below says which export replaces which copy.

| Export | Replaces | Finding |
| --- | --- | --- |
| `num(v, d)` | `console.mjs:32`, `gateway.mjs:44` | D-05 |
| `parseEnvText(text, { trimValues })` | six env parsers | D-02 |
| `createSerialLock()` | `instances.mjs:22-23`, `console.mjs:76-77` | D-05 |
| `skipIfRunning(task, onError)` | the two `sweeping` guards in `demo-gateway/server.mjs:25-26, 31-32` | D-05 |
| `fireAndForget(fn, onError)` | audit wrappers at `gateway.mjs:82`, `console.mjs:80`, `instances.mjs:26` | D-05 |
| `errMessage(e)` | `String(err?.message \|\| err)` at `instances.mjs:45, 104`, `reset.mjs:55` | D-05 |
| `unmapV4(addr)` | `gateway.mjs:134, 167`, `http-util.mjs:22` | D-05 |
| `sleep(ms)` | `new Promise((r) => setTimeout(r, ...))` at `supervisor/index.mjs:125, 136, 143`, `console.mjs:144`, `postgres.mjs:71`, `docker.mjs:34` | D-05 |

---

## D-01: the two store backends are written twice, and the schemas have drifted · 6/10

**Category:** Structural and data duplication · **Effort:** about 3 h

**Locations:**
- Schema: `lib/store/sqlite.mjs:16-49` (`SCHEMA`) and `lib/store/postgres.mjs:5-38` (`SCHEMA_SQL`). Seven tables and four indexes are declared in both.
- Row mapper: `toGrant` at `sqlite.mjs:51-53` and `postgres.mjs:40-42`.
- Audit packing: `sqlite.mjs:131-134` writes the same destructure and `JSON.stringify(rest)` twice in one file (`add`, `addMany`); `postgres.mjs:82-83` has it once as `auditRow`.
- Audit reading: `sqlite.mjs:135` and `postgres.mjs:127` are the same `{ t, ev, grant, app, ip, ...JSON.parse(data) }` mapping.
- Session expiry: `sessions.get` (`sqlite.mjs:125`, `postgres.mjs:119`) and `grantSessions.get` (`sqlite.mjs:120`, `postgres.mjs:114`) repeat `r && Date.parse(r.expires_at) > Date.now() ? {...} : null`.

**Measured:** 21% exact-line overlap in both directions (21 of 98 and 21 of 96 lines). The SQL differs only by placeholder style, so structurally about 55% of each file is the same method list.

**Drift already present:** SQLite's `CREATE TABLE grants` stops at `revoked`, and five columns (`uses`, `max_uses`, `device_lock`, `device_hash`, `last_used_at`) are added by the `ALTER TABLE` loop at `sqlite.mjs:62-65`. Postgres declares all five inline at `postgres.mjs:14-18` and has no upgrade path. A Postgres database created by an older release would be missing those columns, and nothing would add them.

**Suggested extraction:** a shared `lib/store/shared.mjs` module for the pure parts (row mappers, audit packing, expiry check), plus one column list that both schemas are built from. Keep the SQL strings per dialect: they are the part that genuinely differs.

```js
// lib/store/shared.mjs
export const GRANT_EXTRA_COLUMNS = [
  ['uses', 'INTEGER NOT NULL DEFAULT 0'], ['max_uses', 'INTEGER'], ['device_lock', 'INTEGER NOT NULL DEFAULT 0'],
  ['device_hash', 'TEXT'], ['last_used_at', 'TEXT'],
];
export const toGrant = (r) => r && ({ id: r.id, tokenHash: r.token_hash, customer: r.customer, app: r.app,
  createdAt: r.created_at, expiresAt: r.expires_at, revoked: !!r.revoked,
  uses: Number(r.uses ?? 0), maxUses: r.max_uses == null ? null : Number(r.max_uses), deviceLock: !!r.device_lock, lastUsedAt: r.last_used_at ?? null });
export const auditValues = ({ t = new Date().toISOString(), ev, grant, app, ip, ...rest }) =>
  [t, ev, grant ?? null, app ?? null, ip ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null];
export const auditFromRow = (r) => ({ t: r.t, ev: r.ev, grant: r.grant_id ?? undefined, app: r.app ?? undefined, ip: r.ip ?? undefined, ...(r.data ? JSON.parse(r.data) : {}) });
export const liveUntil = (r, pick) => (r && Date.parse(r.expires_at) > Date.now() ? pick(r) : null);
```

```js
// sqlite.mjs: replace lines 131-134 and 135 with
add: (e) => void stmts.aAdd.run(...auditValues(e)),
addMany: (events) => tx(() => { for (const e of events) stmts.aAdd.run(...auditValues(e)); }),
list: (limit = 100) => stmts.aList.all(limit).map(auditFromRow),
// both stores
get: (idHash) => liveUntil(stmts.sGet.get(idHash), (r) => ({ expiresAt: r.expires_at })),
```

`toGrant` is not byte-identical today: Postgres wraps `uses` and `max_uses` in `Number()` because the `pg` driver returns some integer types as strings. The merged version above keeps the Postgres form, which is also correct for SQLite. The existing `tests/unit/store-contract.test.mjs` runs the same cases against both backends, so it is the safety net for this change.

For the drift, also give Postgres the same additive upgrade SQLite has:
`ALTER TABLE grants ADD COLUMN IF NOT EXISTS uses INTEGER NOT NULL DEFAULT 0;` (and the other four), run once from `openWithPool`.

## D-02: the env-file parser exists six times · 5/10

**Category:** Exact and near duplicate · **Effort:** about 1 h

**Locations:**

| File | Lines | Value handling |
| --- | --- | --- |
| `supervisor/apply-sql.mjs` | 17-18 | trimmed |
| `supervisor/create-demo-users.mjs` | 9-10 | trimmed |
| `supervisor/reset-supabase-demo.mjs` | 19-21 | trimmed |
| `supervisor/supabase-admin.mjs` | 16-18 | trimmed |
| `supervisor/index.mjs` (`childEnv`) | 50-53 | **not** trimmed after the first `=` |
| `supervisor/run-with-env.mjs` (`parseEnv`) | 10-19 | **not** trimmed |
| `tests/journeys.mjs` | 10 | different rule (filters on `l.includes('=')`) |

The same line appears four times verbatim: `for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const t = l.trim(), i = t.indexOf('='); if (t && !t.startsWith('#') && i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }`.

**Problem beyond the copies:** `run-with-env.mjs` already exports `parseEnv`, but it cannot be imported, because line 7-8 parse `process.argv` and `process.exit(2)` at import time. That is why every script wrote its own. The two behaviours (trim the value or not) are an accident of copying, not a decision.

**Related boilerplate in the same scripts:**
- `die` / `fail` helper: `apply-sql.mjs:19`, `supabase-admin.mjs:14`, `reset-supabase-demo.mjs:28`.
- "value is missing or still `REPLACE_ME`": `create-demo-users.mjs:11-12`, `reset-supabase-demo.mjs:22-23`, `apply-sql.mjs:21`, `supabase-admin.mjs:21`.
- The same six Supabase key names, listed in `create-demo-users.mjs:11` and, twice, in `reset-supabase-demo.mjs:20, 22`.

**Fix:** use `parseEnvText` from `lib/util.mjs` (added). Keep `trimValues: true` for the four Supabase scripts and the default for `childEnv` and `run-with-env.mjs`, so behaviour is unchanged.

```js
// supervisor/apply-sql.mjs  (replace lines 17-18)
import { parseEnvText } from '../lib/util.mjs';
const env = parseEnvText(readFileSync(envFile, 'utf8'), { trimValues: true });

// supervisor/index.mjs  childEnv  (replace the for-loop at lines 50-53)
Object.assign(env, parseEnvText(readFileSync(f, 'utf8')));

// supervisor/run-with-env.mjs  (delete parseEnv; line 21 becomes)
const env = { ...process.env, ...parseEnvText(readFileSync(envFile, 'utf8')) };
```

For the shared "require these keys" check, add one function next to it:

```js
// lib/util.mjs
export const missingKeys = (env, keys) => keys.filter((k) => !env[k] || env[k] === 'REPLACE_ME');
// create-demo-users.mjs / reset-supabase-demo.mjs
const SUPABASE_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'CUSTOMER_EMAIL', 'CUSTOMER_PASSWORD'];
const missing = missingKeys(env, SUPABASE_KEYS);
if (missing.length) { console.error('STOP: missing ' + missing.join(', ')); process.exit(1); }
```

`missingKeys` is not in `lib/util.mjs` yet; add it with D-02 so the module only contains helpers that have callers.

## D-03: `supervisor/index.mjs` repeats its step runner and its placeholder substitution · 5/10

**Category:** Near duplicate · **Effort:** about 2 h

**Locations (all in `supervisor/index.mjs`):**

- Three step loops share the same shape: check the working directory, build the child env, run, append to a log, test for failure, print the failure text.

  | Part | `instanceStart` | `build` | `reset` |
  | --- | --- | --- | --- |
  | cwd exists check | 197 | 240 | 259 |
  | `childEnv` in try/catch | 198 | 241 | 260 |
  | `appendFileSync(logPath, '\n--- ' + iso + ' ...: exit ...')` | 200 | 245 | 263 |
  | `if (r.error \|\| r.timedOut \|\| r.status !== 0)` | 201 | 246 | 264 |
  | `${r.timedOut ? 'timed out' : r.error ?? 'exit ' + r.status}` | 201 | 246 | 264 |

- `{port:name}` substitution is written five times: `fill` (line 40), `fillStep` in `instanceStart` (193), `fillStep` in `reset` (255), and as validation regexes in `lib/registry.mjs:40-41` and `61-62`.
- The "start, then poll `httpUp` every second for 60 s" loop appears for containers (line 125) and for processes (line 143), the second with an early exit for a crashed process.

**Measured:** about 45 of 283 lines (16%). The three blocks have already diverged slightly (`reset` prints `Reset ... step n/m...` and `ok`, `build` prints `Building ...` and `done`), which is the kind of difference that turns into a bug when only one copy is edited.

**Suggested extraction:** a function in `supervisor/index.mjs` (it uses `logDir`, `childEnv` and `runStep`, so it belongs there) that runs one logged step and returns a result with the failure text.

```js
// supervisor/index.mjs
const portRefs = (app) => (s) => s.replace(/\{port:(\w+)\}/g, (_, n) => String(app.processes.find((q) => q.name === n).port));

// Runs one step with its own env and logs it. Returns { ok, why } where `why` is the text to show when it failed.
async function runLoggedStep({ app, label, st, envSource, fillStep, logName, defaultTimeoutSec }) {
  const cwd = resolve(app.path, st.cwd ?? '.');
  if (!existsSync(cwd)) return { ok: false, why: `working directory not found: ${cwd}` };
  let env; try { env = childEnv(app, envSource, fillStep); } catch (e) { return { ok: false, why: e.message }; }
  const r = await runStep(fillStep(st.cmd), cwd, env, (st.timeoutSec ?? defaultTimeoutSec) * 1000);
  const how = r.timedOut ? 'timed out' : r.error ?? 'exit ' + r.status;
  try { appendFileSync(join(logDir, logName), `\n--- ${new Date().toISOString()} ${label}: ${r.timedOut ? 'timed out' : r.status ?? 'error'}\n${r.output}${r.error ? 'error: ' + r.error + '\n' : ''}`, { mode: 0o600 }); } catch { /* best effort */ }
  return r.error || r.timedOut || r.status !== 0 ? { ok: false, why: how } : { ok: true };
}
```

`reset` then becomes a loop of `runLoggedStep(...)` calls and its own printing; `build` and `instanceStart` the same. `fill` can call `portRefs(app)` for its last `.replace`. The existing `tests/unit/reset-steps.test.mjs` and `tests/unit/supervisor-start.test.mjs` run the real supervisor and cover the reset and start paths; `build` and `instance-start` are covered less, so add one test for each failing step before refactoring those two.

In `lib/registry.mjs`, extract the port-reference check once:

```js
const portRefErrors = (a, text, where) => [...String(text ?? '').matchAll(/\{port:(\w+)\}/g)]
  .filter((m) => !a.processes.some((q) => q.name === m[1])).map((m) => `${where}: {port:${m[1]}} refers to a process that does not exist`);
```

## D-04: `demo-gateway/gateway.mjs` repeats records and page templates · 3/10

**Category:** Structural · **Effort:** about 1 h

**Locations:**
- The denied-audit object is written out five times with small variations: lines 185, 209, 229, 312, 318 (`{ ev: 'denied', grant: g.id, app: slug, ip, ua: ..., why/via }`).
- The "Too many attempts" page is built three times: lines 183, 188, 227.
- The full HTML page template (`font:17px system-ui;max-width:32rem;margin:15vh auto;padding:0 20px;color:#222`, `<h1 style="font-size:22px">`) is in `page()` at line 51 and again, verbatim, in the "Preparing your demo" response at line 245. The second copy exists only to add `<meta http-equiv=refresh content=3>`.
- `handle()` (lines 251-255) and `upgrade()` (lines 366-374) both filter hop-by-hop and spoofable headers and rebuild `host`, `cookie` and the `x-forwarded-*` set. They produce different shapes (an object, then raw header lines), so merging them would cost clarity. Not recommended; noted for completeness.

**Fix:** let `page()` take extra head markup, and give the denied record one constructor.

```js
const page = (res, code, title, msg, headers = {}, head = '') => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...OWN_HEADERS, ...headers });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">${head}<title>${title}</title><body style="font:17px system-ui;max-width:32rem;margin:15vh auto;padding:0 20px;color:#222"><h1 style="font-size:22px">${title}</h1><p>${msg}</p>`);
};
// line 244-245 becomes:
return page(res, 503, 'Preparing your demo', 'Your private copy is being set up. This page refreshes by itself and takes up to a minute.', { 'retry-after': '3' }, '<meta http-equiv=refresh content=3>');

const deniedRecord = (g, slug, ip, req, extra = {}) => ({ ev: 'denied', ...(g ? { grant: g.id } : {}), app: slug, ip, ua: uaOf(req), ...extra });
const tooMany = (res, wait) => page(res, 429, 'Too many attempts', `Please wait ${wait === 60 ? 'a minute' : 'a few minutes'} and try again.`, { 'retry-after': String(wait) });
```

Check that the CSP in `OWN_HEADERS` (`default-src 'none'; style-src 'unsafe-inline'`) still lets the meta refresh work. It does today (the same header is sent at line 244), so no CSP change is needed.

## D-05: small helpers copied between modules · 4/10

**Category:** Exact duplicates · **Effort:** about 1 h

| Helper | Copies | Replace with |
| --- | --- | --- |
| `const num = (v, d) => (v === undefined \|\| v === '' \|\| Number.isNaN(Number(v)) ? d : Number(v))` | `admin-console/console.mjs:32`, `demo-gateway/gateway.mjs:44` (character-identical) | `import { num } from '../lib/util.mjs'` |
| JSON response writer | `gateway.mjs:119` (`jsonRes`) is `lib/http-util.mjs:30-33` (`json`) without the optional `headers` argument | import `json` from `http-util.mjs` and delete `jsonRes`; the gateway already imports from that file at line 15 |
| Fire-and-forget audit write with a logged warning | `gateway.mjs:82`, `console.mjs:80`, `instances.mjs:26` | `fireAndForget(() => store.audit.add(e), (err) => logger.warn('audit write failed', { err }))` |
| One-at-a-time promise chain | `instances.mjs:22-23` (`locked`), `console.mjs:76-77` (`withTotpLock`) | `createSerialLock()` |
| "skip this tick if the last one is still running" | `demo-gateway/server.mjs:25-26` and `31-32` | `skipIfRunning(task, onError)` |
| IPv4-mapped address cleanup `replace(/^::ffff:/, '')` | `gateway.mjs:134`, `167`, `lib/http-util.mjs:22` | `unmapV4` |
| `String(err?.message \|\| err)` | `instances.mjs:45, 104`, `reset.mjs:55` | `errMessage` |
| `new Promise((r) => setTimeout(r, n))` | `supervisor/index.mjs:125, 136, 143`, `console.mjs:144`, `postgres.mjs:71`; `docker.mjs:34` defines its own default | `sleep` |

**Example edits:**

```js
// demo-gateway/server.mjs  (lines 23-27 and 30-33)
import { skipIfRunning } from '../lib/util.mjs';
setInterval(skipIfRunning(() => gw.resetSweep(), (err) => logger.error('reset sweep failed', { err })), everyMs).unref();
setInterval(skipIfRunning(() => gw.instanceSweep(), (err) => logger.error('instance sweep failed', { err })), 30000).unref();

// demo-gateway/instances.mjs  (lines 22-23, 26)
import { createSerialLock, fireAndForget, errMessage } from '../lib/util.mjs';
const locked = createSerialLock();
const audit = (e) => fireAndForget(() => store.audit.add(e), (err) => logger.warn('audit write failed', { err }));

// demo-gateway/gateway.mjs  (delete line 119 jsonRes; line 121 and 122 call json)
import { cookieOf as readCookie, clientIp, safeEq, json } from '../lib/http-util.mjs';
try { await store.meta.get('health-check'); json(res, 200, { ok: true }); } catch (e) { logger.error('health check failed', { err: e }); json(res, 503, { ok: false }); }
```

`lib/util.mjs` is deliberately free of imports so `lib/http-util.mjs` can import `unmapV4` from it without a cycle.

**Related:** the health check itself is written twice (`gateway.mjs:121`, `console.mjs` near line 164: `store.meta.get('health-check')` then 200 or 503). A shared `healthCheck(store)` in `lib/http-util.mjs` would hold the key name, which appears as a bare string in both files.

## D-06: three SHA-256 hex helpers · 3/10

**Category:** Exact duplicate · **Effort:** 15 min

**Locations:** `lib/auth.mjs:123` (`hashSessionId`), `lib/auth.mjs:124` (`sha256`), `demo-gateway/grants.mjs:16` (`hashToken`, plus its own `createHash` import at line 6). All three are `createHash('sha256').update(x).digest('hex')`; the first two coerce with `String()`.

**Fix:**

```js
// lib/auth.mjs
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const hashSessionId = sha256;   // keeps the public name, one implementation

// demo-gateway/grants.mjs: drop `createHash` from line 6 and replace line 16
import { sha256 } from '../lib/auth.mjs';
export const hashToken = sha256;
```

Safe because every caller passes a string already (the `String()` is a no-op for them). `tests/unit/auth.test.mjs` and `tests/unit/grants.test.mjs` cover both names.

## D-07: default ports and port settings repeated; one launcher ignores the variable · 4/10

**Category:** Configuration duplication · **Effort:** about 1 h

**Where the three ports are written:**

| Value | Places |
| --- | --- |
| 4100 (console) | `lib/config.mjs:11`, `admin-console/console.mjs:57`, `start-console.bat:5`, `deploy/Caddyfile:39` (`console:4100`) |
| 4200 (showcase) | `lib/config.mjs:12`, `showcase/serve.mjs:8`, `start-showcase.bat:5` |
| 4300 (gateway) | `lib/config.mjs:13`, `console.mjs:67`, `demo-gateway/gateway.mjs:57`, `start-customer-demo.bat:6, 25, 62`, `deploy/Caddyfile:11, 48`, `deploy/docker-compose.yml` (`GATEWAY_PORT: "4300"`, health check on `:4300`) |

`lib/config.mjs` already says "Single place for paths and ports", but the console, gateway and showcase server each re-read the variable with their own default. The two reads also disagree in meaning: `config.mjs` uses `Number(x || 4100)` (the text `abc` becomes `NaN`), while `console.mjs` and `gateway.mjs` use `num()` (the text `abc` becomes 4100).

**Behaviour already out of step:** `start-console.bat:5` sets `PORT=4100` and probes `http://127.0.0.1:4100/`, but `server.mjs` listens on `CONSOLE_PORT`. With `CONSOLE_PORT=4150` set, the launcher reports "not responding" for a console that is running. The same applies to `start-showcase.bat:5` and `SHOWCASE_PORT`.

**Fix:**

```js
// lib/config.mjs
import { num } from './util.mjs';
export const ports = {
  console: num(process.env.CONSOLE_PORT, 4100),
  showcase: num(process.env.SHOWCASE_PORT, 4200),
  gateway: num(process.env.GATEWAY_PORT, 4300),
};

// admin-console/console.mjs  lines 57 and 67
port: ports.console, ... gatewayPort: ports.gateway,
// demo-gateway/gateway.mjs line 57
port: ports.gateway,
// showcase/serve.mjs line 8
const PORT = ports.showcase;
```

```bat
rem start-console.bat line 5: take the variable if it is set, else the default
if not defined CONSOLE_PORT set "CONSOLE_PORT=4100"
set "PORT=%CONSOLE_PORT%"
```

The tests pass ports in explicitly through `createGateway({ port })` and `createConsole({ port })` (the `...opts` spread wins), so they are unaffected. The Caddyfile and compose values are inside the container network and stay as they are, with a one-line comment pointing at `lib/config.mjs`.

## D-08: the response security-header baseline is written three times · 4/10

**Category:** Structural and data · **Effort:** about 1 h

**Locations:**
- `admin-console/console.mjs:93-96` (`securityHeaders`): `cache-control: no-store`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, plus a CSP.
- `demo-gateway/gateway.mjs:47-48` (`OWN_HEADERS`): the same four keys with the same values, plus a CSP and, over HTTPS, `strict-transport-security`.
- `showcase/serve.mjs:22-25`: `x-content-type-options`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin` (a different value), `permissions-policy`, plus a CSP.
- The proxied-response defaults at `gateway.mjs:259-261` and `268` are a fourth, deliberately different set (`SAMEORIGIN`, `strict-origin-when-cross-origin`).

The CSP strings differ on purpose; do not merge them. Only the shared four keys are worth one definition, so a future change (for example adding `cross-origin-opener-policy`) is made once.

```js
// lib/http-util.mjs
export const BASE_SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
});
// console.mjs
const securityHeaders = { ...BASE_SECURITY_HEADERS, 'content-security-policy': csp("'none'") };
// gateway.mjs
const OWN_HEADERS = { ...BASE_SECURITY_HEADERS, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", ...(HTTPS ? { 'strict-transport-security': 'max-age=31536000' } : {}) };
```

`showcase/serve.mjs` is a static server that is allowed to cache, so it should not take `cache-control: no-store`; leave it out of this change, or spread the base and override.

`tests/unit/console.test.mjs` and `tests/unit/gateway.test.mjs` assert on these headers (a search for `x-frame-options`, `content-security-policy` and `nosniff` finds them only there), so they cover the change for the console and the gateway; nothing covers `showcase/serve.mjs`.

## D-09: admin-console auth repeats storage keys and request guards · 3/10

**Category:** Data and structural · **Effort:** about 1 h

**Locations:**
- The `meta` keys are bare strings spread across three files: `'admin_password_hash'` (7 uses in `auth-cli.mjs`, `console.mjs`), `'admin_totp_secret'` (8 uses in `auth-cli.mjs`, `console.mjs`, `server.mjs`), `'admin_totp_last_step'` (4), `'admin_totp_pending'` (4, in `auth-cli.mjs`, `server.mjs`). A typo in one of them would silently read an empty value, which in `console.mjs` means "no password set", so the console would fall back to launch-token mode.
- `if (!originOk(req)) return json(res, 403, { error: 'bad origin' })`: `console.mjs:112, 175, 264, 271, 283`, plus a variant that also audits at `232`.
- `if (!b || typeof b !== 'object' || Array.isArray(b))`: `console.mjs:122` (answers 400) and `266` (throws `HttpError(400)`).
- "clear sessions, write an audit event, print a line": `auth-cli.mjs` lines 63-64, 111-112, 121, 127.

**Fix:** one constants object, one guard.

```js
// lib/auth.mjs
export const ADMIN_KEYS = Object.freeze({
  passwordHash: 'admin_password_hash', totpSecret: 'admin_totp_secret', totpLastStep: 'admin_totp_last_step',
  totpPending: 'admin_totp_pending', totpPendingFile: 'admin_totp_pending_file',
});
// console.mjs
const refuseBadOrigin = (req, res) => (originOk(req) ? false : (json(res, 403, { error: 'bad origin' }), true));
// each route:  if (refuseBadOrigin(req, res)) return;
const isPlainObject = (b) => !!b && typeof b === 'object' && !Array.isArray(b);
```

`tests/unit/console.test.mjs` exercises login, logout, create and revoke with a bad origin, so the behaviour is guarded. Do this one when you next change the console; the immediate risk is low because the key strings are already consistent.

## D-10: design tokens and the brand palette are copied across three pages · 3/10

**Category:** Data duplication · **Effort:** about 2 h

**Locations:**
- The light and dark colour tokens (`--paper`, `--ink`, `--mute`, `--line`, `--field`, `--glass`, `--glass-edge`) and the two font stacks (`--display`, `--text`) are written in `admin-console/index.html:12-22`, `admin-console/login.html:6-9`, and `showcase/build.mjs:121-124` / `234-235`. The `--display` and `--text` strings are character-identical in all three.
- The six product accent colours `#2b4acb #0f766e #c2410c #0369a1 #7c3aed #407E3C` are in `showcase/products.json` (`accent`), and again hard-coded as inline `style="background:..."` in the brand mark of `login.html` and `index.html` (each colour appears in both).
- The `body:before` radial-gradient background and the `.mark` rules are repeated between `login.html` and `index.html`.

**Measured:** `login.html` against `index.html` is only 12% line-identical (5 of 43), because the token lines differ in values. The duplication is in the token names and font stacks, not in whole lines.

**Fix:** one stylesheet served by the console, and the accents read from `products.json` when the pages are served.

Do **not** simply add a `<link rel="stylesheet">`: the console's CSP is `style-src 'unsafe-inline'` only (`console.mjs:93`), which blocks an external stylesheet. The policy must change first:

```js
// console.mjs line 93
const csp = (script) => `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${script}; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`;
```

and a route that serves `admin-console/theme.css` before the sign-in check (the login page needs it before anyone is signed in). Then both pages use `<link rel="stylesheet" href="/theme.css">` for the shared `:root` blocks and keep only their own rules inline. This also needs a test: `tests/unit/pages.test.mjs` should fetch `/theme.css` without a session and check it is served.

**Low value if the pages rarely change.** If you would rather not touch the CSP, the smaller step is to build the brand mark from `products.json` once on the server and insert it into both pages, which removes the palette copy without opening the policy.

## D-11: registry files repeat product metadata; registry validation repeats step checks · 3/10

**Category:** Data and structural · **Effort:** about 2 h

**Locations:**
- `registry/apps.json` (13 apps) and `registry/apps.hosted.example.json` (8 apps) carry the same product entries. Comparing the eight shared ids, every one has identical `id`, `name` and `tagline`; the demo entries also share `demoOf` and `demoReady`, and `claudeworkspace-demo` shares `demoRoutes`. Six of fourteen top-level keys repeat per app.
- `showcase/products.json` repeats `id` and `name` for the same products. The display names do **not** all agree with the registry (`Remote Management` against `RemoteManagementSystem`, `CarRental` against `ClaudeWorkspace (CarRental)`). **Unable to verify** whether that is intended (a public name against an internal one). Code that would prove it: whether anything joins `products.json` to the registry by `id` and displays both names, and a search of the `.mjs` files finds `products.json` read only by `showcase/build.mjs`. Nothing joins them in code today.
- `envFile` values repeat per app (`data/rmm-demo.env` x5, `data/claudeworkspace-demo.env` x4, `data/crm-demo.env` x3, `data/claudeos-demo.env` x2, `data/airfinder-demo.env` x2). This is by design (each process names its own file) and is not worth a template.
- `lib/registry.mjs` validates "a step has a non-empty `cmd`" three times: reset steps (line 59), `perLink.prepare` (line 87), `build` (line 67); the `{port:name}` reference check twice (lines 40-41, 61-62).

**Fix:** for the registry validation, one helper:

```js
// lib/registry.mjs
const stepProblems = (where, label, steps) => steps.flatMap((st, i) =>
  (!st || typeof st.cmd !== 'string' || !st.cmd.trim()) ? [`${where}: ${label} ${i + 1} needs a cmd`] : []);
// reset:   errs.push(...stepProblems(where, 'reset step', a.reset.steps));
// prepare: errs.push(...stepProblems(where, 'perLink.prepare step', pl.prepare));
```

`tests/unit/registry.test.mjs` does not currently test the reset, build or `perLink` rules at all (a search for those words in it finds nothing), so add a test for each message before changing them; that is what proves the helper kept the wording.

For the two registry files, only do this if you edit them together often: an `"extends"` key resolved in `loadRegistry`, so the hosted file lists only what differs (`path`, `processes`, ports). That is a behaviour change to the loader, so it needs its own tests; the saving is about 8 entries x 6 keys. Not recommended unless the two files keep drifting.

## D-12: test helpers are redefined in each file · 3/10

**Category:** Exact and near duplicates · **Effort:** about 2 h

**Locations:**

| Helper | Copies |
| --- | --- |
| HTTP request that buffers the body: `http.request(...)`, `res.on('data')`, `res.on('end', () => resolve({ status, headers, body }))` | `tests/unit/gateway.test.mjs:58`, `instances.test.mjs:54`, `console.test.mjs:37`, `showcase.test.mjs:8` (shorter) |
| Free port: listen on 0, read `address().port`, close | `instances.test.mjs:11`, `supervisor-start.test.mjs:15`, a third variant `gateway.test.mjs:12` (`listen`) |
| `const proc = (name, port) => ({ name, cmd: 'x', port })` | `console.test.mjs:13`, `gateway.test.mjs:31`, `reset.test.mjs:12` (identical); `registry.test.mjs:6` (variant with defaults) |
| Temporary folder: `mkdtempSync(join(tmpdir(), 'pd-...-'))` and `rmSync(dir, { recursive: true, force: true })` | 14 uses in 9 files: `console` (5), `store` (2), and one each in `gateway`, `grants`, `instances`, `reset`, `reset-steps`, `store-contract`, `supervisor-start` |
| Grant fixture `const grant = (o = {}) => ({ id, tokenHash, customer: 'Acme', app: 'crm', createdAt, ... })` | `store.test.mjs:15`, `store-contract.test.mjs:14` |

**Measured:** about 70 of 2,425 test lines (3%). The duplication is small, but the four request helpers differ in the default `host` header they send, which makes a copied test easy to point at the wrong host.

**Fix:** a helper module that the test glob does not pick up (`npm test` runs `tests/unit/*.test.mjs` only, so `tests/helpers.mjs` is not run as a test):

```js
// tests/helpers.mjs
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function httpRequest({ port, path = '/', method = 'GET', headers = {}, body, host }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: host ?? `127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}
export const freePort = () => new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
export const tempDir = (tag) => { const dir = mkdtempSync(join(tmpdir(), `pd-${tag}-`)); return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) }; };
export const testProc = (name, port) => ({ name, cmd: 'x', port });
```

Each test file keeps a one-line wrapper that fixes its own host, for example `const request = (o) => httpRequest({ port: gwPort, host: `toy.localhost:${gwPort}`, ...o })`.

## D-13: the two RMM Python helpers share a start-and-wait block · 3/10

**Category:** Near duplicate · **Effort:** 30 min

**Locations:** `supervisor/demo-fixes/rmm_demo_api.py:9-19` and `supervisor/demo-fixes/rmm_reset.py:15-28` both run `docker start pd-rmm-demo-pg pd-rmm-demo-redis`, then poll ports 5433 and 6380 for up to 60 s each, then sleep 2 s. They differ only in the failure message wording and a `socket.create_connection(...)` line break. Both also repeat the "refuse unless `DATABASE_URL` is the demo database" check (`rmm_demo_api.py:6-7`, `rmm_reset.py:11-14`), and the port numbers 5433 and 6380 appear in both.

**Measured:** 14 of 24 lines in `rmm_demo_api.py` (58%) and 14 of 43 in `rmm_reset.py` (33%).

**Fix:** one module next to them, imported by both (both run with `data/demo-src/rmm/api` as the working directory and the RMM virtualenv's Python, so the import must use the file's own folder):

```python
# supervisor/demo-fixes/rmm_demo_services.py
import socket, subprocess, sys, time
CONTAINERS = ("pd-rmm-demo-pg", "pd-rmm-demo-redis")
PORTS = (5433, 6380)

def require_demo_database(url):
    if "@127.0.0.1:5433/rmm_demo" not in url:
        sys.exit("Refusing: DATABASE_URL is not the demo database.")

def ensure_demo_services():
    for name in CONTAINERS:
        subprocess.run(["docker", "start", name], capture_output=True)
    for port in PORTS:
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=1).close(); break
            except OSError:
                time.sleep(1)
        else:
            sys.exit(f"Port {port} did not come up. Docker Desktop must be running (start it, wait until it says Engine running, then try again).")
    time.sleep(2)
```

```python
# both scripts, top
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rmm_demo_services import ensure_demo_services, require_demo_database
```

**Verification needed before merging:** these scripts are run by the supervisor's reset steps and by the registry command for `rmm-demo`, and only a real run with Docker proves it. **Unable to verify** here: Docker was not started for this audit and the RMM virtualenv is outside the repository. Code that would prove it: `node supervisor/index.mjs reset rmm-demo` completing with `rmm-demo was reset to its seeded state.` after the change.

## D-14: compose hardening repeated beside the existing anchor · 2/10

**Category:** Structural · **Effort:** 20 min

`deploy/docker-compose.yml:15-22` defines `x-hardened`, used by `gateway`, `console`, `crm-demo-ratelimit` and `cw-reset` (`<<: *hardened` at lines 47, 66, 167, 274). Five other services spell out the same two lines instead: `caddy` (92-93), `crm-demo-db` (147-148), `crm-demo` (209-210), `claudeworkspace-web` (241-242), `claudeworkspace-admin` (261-262), and `postgres` (31-32, which then adds `cap_add`). They cannot take the whole anchor because `read_only`, `tmpfs` and the memory limit would break a database or a Next.js server, which is probably why they were written out.

```yaml
x-nopriv: &nopriv
  security_opt: ["no-new-privileges:true"]
  cap_drop: [ALL]
x-hardened: &hardened
  <<: *nopriv
  read_only: true
  tmpfs: [/tmp]
  pids_limit: 256
  mem_limit: 512m
# the five services:   <<: *nopriv
```

Check with `docker compose -f deploy/docker-compose.yml config` before and after and compare the output: it should be identical. (Docker was not running for this audit, so this is **unverified**.)

## D-15: the Windows launchers repeat their checks and wait loops · 2/10

**Category:** Structural · **Effort:** 1 h

Exact-line overlap with `start-console.bat`: `start-showcase.bat` 38% (9 of 24), `start-crm.bat` 11%, `start-customer-demo.bat` 6%. The repeated parts are the `where node` check, the `npm install` check, the `curl.exe` readiness poll with `ping -n 2 127.0.0.1` as a sleep, and the `:fail` block. A shared `scripts\common.cmd` with `call :wait_http <url> <seconds>` would remove them, but batch `call :label` across files is easy to get wrong and these four files rarely change. Do this only if you add a fifth launcher.

## D-16: two exported constants share a name and mean different things · 2/10

**Category:** Naming · **Effort:** 10 min

`demo-gateway/instances.mjs:13` exports `RETRY_AFTER_FAIL_MS = 20 * 1000` (retry a failed private copy) and `demo-gateway/reset.mjs:15` exports `RETRY_AFTER_FAIL_MS = 10 * 60 * 1000` (retry a failed shared-demo reset). Neither file imports the other's, so nothing breaks, but anyone importing both would get a clash. Rename on the way out:

```js
// instances.mjs
export const INSTANCE_RETRY_AFTER_FAIL_MS = 20 * 1000;
// reset.mjs
export const RESET_RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;
```

Search for `RETRY_AFTER_FAIL_MS` in `tests/unit/` first; update any test that imports it.

## D-17: the Windows and POSIX process drivers · 1/10 · no action

`lib/process-driver.mjs` has `spawnApp` twice (lines 65-70 and 100-105) and `startTimes` twice. The bodies differ in the points that matter (`shell: true` with redirection against `sh -c` with `detached`), and the file's header explains why. Merging them would hide the platform differences that were learned the hard way (the comment at lines 62-64). Leave as is.

## What was checked and found clean

- **Crypto and TOTP** (`lib/auth.mjs`): no repeated blocks beyond D-06.
- **Metrics, logging, errors** (`lib/metrics.mjs`, `lib/log.mjs`, `lib/errors.mjs`): single implementations, used everywhere through imports.
- **Reset state keys** (`demo-gateway/reset.mjs:16`): the three `meta` keys are built by one set of functions, which is the pattern D-09 recommends for the admin keys.
- **The store contract**: `tests/unit/store-contract.test.mjs` runs one set of cases against both backends. That is the right shape for D-01.
- **CI** (`.github/workflows/ci.yml`): the Windows and Linux jobs repeat `npm ci`, `npm audit`, `npm run lint`, `npm test`. A matrix would merge them, but the two jobs differ in setup (Postgres service on Linux) and the repetition is four lines. Not worth changing.
- **Dockerfiles** (`deploy/apps/*/Dockerfile`): at most 20% exact-line overlap; the repeated lines are the base-image, `WORKDIR` and non-root `USER` conventions, which are better left explicit per image.
- **Documentation** (`README.md`, `demo-gateway/README.md`, `deploy/README.md`, `docs/HOW-IT-WORKS.md`): environment-variable and port tables may repeat across these. **Unable to verify** without reading all four against each other and the code; `lib/config.mjs` and the `process.env.*` reads would be the reference to compare them with.

## Suggested order

1. **15 minutes:** D-06 (one SHA-256 helper), D-16 (rename the constants).
2. **1-2 hours, mechanical:** D-05 (use `lib/util.mjs` in the eight places), D-02 (use `parseEnvText` in six scripts), D-07 (ports from `config.mjs`, fix `start-console.bat`).
3. **Half a day:** D-01 (shared store module and the Postgres upgrade statement), D-03 (the step runner in the supervisor).
4. **As the files are next touched:** D-04, D-08, D-09, D-12, D-13.
5. **Skip unless it starts to hurt:** D-10, D-11 (registry `extends`), D-14, D-15, D-17.

After each step run `npm run lint && npm test`; the suite is 167 passing today and covers the gateway, console, store contract, reset steps and supervisor start paths touched above.
