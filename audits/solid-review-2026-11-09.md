# SOLID Review: ProjectsDashboard

Date: 2026-11-09 · Commit reviewed: `2be9616` (`main`) · Scope: `lib/`, `lib/store/`, `demo-gateway/`, `admin-console/`, `supervisor/`, `showcase/` (read in full for the first three; skimmed for `showcase/`, which is a static generator). Tests were read only where they show how the code is wired.

**How to read this.** The code base is plain ES modules with factory functions (`createGateway`, `createConsole`, `createInstances`), not classes. The only class is `HttpError` (`lib/errors.mjs`). So "class" below means a module or a factory closure, "interface" means the object shape that several modules agree on (the store, the process driver, the supervisor function), and "injection" means passing a dependency in as an argument or option. Importance is 1–10 (10 = serious); here it means "how much this costs when you change or test the code", not security risk. Nothing was changed.

## Score

| Principle | Score | One line |
| --- | --- | --- |
| Single responsibility | **5/10** | The three biggest modules each do five or six jobs; the `lib/` helpers are well separated. |
| Open/closed | **6/10** | New apps and demo types are added in `registry/apps.json` without code; new runtimes, backends and commands are not. |
| Liskov substitution | **8/10** | The two stores and the two process drivers really are interchangeable, with a contract test; two small gaps. |
| Interface segregation | **6/10** | One wide store object, a generic `meta` key-value table used for unrelated things. |
| Dependency inversion | **6/10** | Good injection of the supervisor, clock and engine checks; the store and registry are process-wide singletons. |
| **Overall** | **6/10** | Sound for a project of this size, with tests that pass (191 of 192, 1 skipped). The weak spot is a few large modules that fetch their own dependencies. |

| ID | Finding | Principle | Importance |
| --- | --- | --- | --- |
| D-01 | `createGateway`, `createConsole` and `grants.mjs` get the store from a global singleton | DIP | **5** |
| S-01 | `supervisor/index.mjs` is a CLI, a lifecycle manager, an env builder and a step runner, and runs at import | SRP | **5** |
| S-02 | `createGateway` (365 lines) holds redemption, proxying, WebSockets, metrics, health and timers | SRP | **5** |
| O-01 | Host process and container are `if (p.container)` branches in five places of the supervisor | OCP | **4** |
| D-02 | The registry is read through a module-level `demoApps()` that cannot be injected | DIP | **4** |
| S-03 | `createConsole().handle` is one 130-line router that also does auth, audit feed and demo CRUD | SRP | **4** |
| D-03 | The gateway has two sources of truth for HTTPS (`HTTPS` constant and `o.scheme`) | DIP | **3** |
| O-02 | Shared and per-link demos are `target.perLink` branches in five places of the gateway | OCP | **3** |
| I-01 | The store is one wide object; consumers use one or two of its seven groups | ISP | **3** |
| I-02 | `store.meta` is a junk drawer: admin login, reset flags, seat tables, import flags | ISP / SRP | **3** |
| L-01 | SQLite store methods are synchronous, Postgres ones are Promises; a missing `await` works on one only | LSP | **3** |
| S-04 | `grants.mjs` mixes grant rules, registry lookup, link formatting and a CLI | SRP | **3** |
| S-05 | `registry.validate` is one 80-line function for seven kinds of check | SRP | **3** |
| O-03 | Supervisor commands are an `else if` chain | OCP | **3** |
| I-03 | `lib/auth.mjs` bundles admin login with generic hashing helpers the gateway also imports | ISP | **2** |
| L-02 | Optional `startTimes` on the process driver is guarded at the call site | LSP | **2** |
| O-04 | Store backend and driver choice are `if`/ternary chains | OCP | **2** |

---

## 1. Single responsibility

### S-01: `supervisor/index.mjs` · 5/10
**Location:** `supervisor/index.mjs` (289 lines). Functions: `fill`, `childEnv` (environment building), `isManaged`, `status`, `start`, `stop` (process lifecycle for host processes and containers), `instanceStart`, `instanceStop` (per-link copies), `redact`, `runStep`, `runLoggedStep` (shell step runner with log files), `build`, `reset`. Lines 277-288 parse `process.argv` and run, at import time. `registry`, `store` and `driver` are bound at lines 25-33.

**Why it hurts:** the file changes for five different reasons (a new command, a new log rule, a change in how env is built, a new container behaviour, a new reset flow). It cannot be imported by a test, because importing it executes the command line; the tests start it as a child process instead (`tests/unit/supervisor-start.test.mjs`, `supervisor-steps.test.mjs`).

**Fix:** keep the file as a thin entry point and split by job. First step, no behaviour change: make the functions importable by moving the dispatch behind a guard (the repo already uses this pattern in `demo-gateway/grants.mjs` and `showcase`):
```js
// supervisor/index.mjs, bottom
export { status, start, stop, build, reset, instanceStart, instanceStop };
if (process.argv[1]?.endsWith('index.mjs')) await main(process.argv.slice(2));
```
Then move out, one at a time: `childEnv`/`fill`/`portRefs` → `supervisor/env.mjs`; `redact`/`runStep`/`runLoggedStep` → `supervisor/steps.mjs`; `start`/`stop`/`isManaged` → `supervisor/lifecycle.mjs`, each taking `{ registry, store, driver }` as arguments (see D-01).

### S-02: `createGateway` · 5/10
**Location:** `demo-gateway/gateway.mjs:61-426`. Inside one closure: link redemption (`handle`, lines 178-229), proxying with header and cookie rewriting (230-303), WebSocket proxying and recheck timers (`upgrade`, 308-385), Prometheus metrics set-up (112-127), `health` and `tlsAsk`, the miss limiter (`tooManyMisses`), and the server wiring.

**Why it hurts:** a change to the cookie rules, the proxy headers or the WebSocket handling is a change to the same 365-line scope, and the closure shares ten variables (`o`, `store`, `instances`, `trusted`, `wsCounts`, `audit`, `metrics`, ...) so nothing can be tested without building the whole gateway (as `tests/unit/gateway.test.mjs` does).

**Fix:** extract the parts that are pure first; they need no dependencies and are already free of closure state apart from `trusted`/`o`:
```js
// demo-gateway/proxy-headers.mjs (moves from gateway.mjs lines 168-175, 255-259, 266-273)
export const cookiesForUpstream = (req, ours) => (req.headers.cookie || '').split(/;\s*/).filter((c) => c && !ours.test(c)).join('; ');
export const forwardedFor = (req, trusted) => { /* body of the existing forwardedFor */ };
export const upstreamHeaders = (req, { host, port, hostHdr, scheme, trusted }) => { /* the for-loop at 255-259 */ };
export const rewriteResponseHeaders = (ur, { ours, hostHdr, scheme, upHost, port, https }) => { /* lines 261-273 */ };
```
then move `upgrade` to `demo-gateway/websocket.mjs` as `createUpgradeHandler(deps)` and redemption to `demo-gateway/redeem.mjs`, leaving `createGateway` to assemble them. Keep `wsCounts`/`releaseWs` together with the WebSocket handler.

### S-03: `createConsole().handle` · 4/10
**Location:** `admin-console/console.mjs:164-297` (about 130 lines): host check, health, login routes, token mode, `/api/session`, `/api/audit` (filter map and field whitelist), `/api/apps`, logs, start/stop/restart, `/api/demos` (list, create, reset, revoke), 404/405. Also `login()` (117-160, password and 2-step), `statusRows()` (305-321, status cache).

**Fix:** a route table makes each endpoint a small function and the 404/405 logic one place (this also helps O-03):
```js
const routes = [
  ['GET',  /^\/api\/session$/,            apiSession],
  ['GET',  /^\/api\/audit$/,              apiAudit],
  ['GET',  /^\/api\/apps$/,               apiApps],
  ['POST', /^\/api\/apps\/([\w-]+)\/(start|stop|restart)$/, appAction],
  ['POST', /^\/api\/demos$/,              demoCreate],
  // ...
];
for (const [method, re, fn] of routes) { const m = req.method === method && url.pathname.match(re); if (m) return fn(req, res, url, m); }
```
Move the audit feed and the status cache to their own files (`admin-console/audit-feed.mjs`, `status-cache.mjs`); both already have clear inputs and outputs.

### S-04: `demo-gateway/grants.mjs` · 3/10
**Location:** `demo-gateway/grants.mjs`: grant rules (`createGrant`, `revokeGrant`, `isActive`, `publicGrant`), registry lookup (`demoApps`, lines 22-32, which the gateway and `reset.mjs` also use), link text (`demoLink`, reading `DEMO_SCHEME`/`DEMO_BASE_HOST`), and a command line at lines 69-82.

**Fix:** `demoApps` belongs with the registry (`lib/registry.mjs`: `export const demoApps = ...`); the CLI to `demo-gateway/grants-cli.mjs`. `gateway.mjs` then no longer imports a "grants" module to find out which products exist.

### S-05: `registry.validate` · 3/10
**Location:** `lib/registry.mjs:19-103`. One loop validates identity, processes, ports, `requiresDocker`, `reset`, `build`, `snapshot`, `demoAccounts` and `perLink`.
**Fix:** one small checker per block, run in a list:
```js
const checks = [checkIdentity, checkProcesses, checkReset, checkBuild, checkSnapshot, checkDemoAccounts, checkPerLink];
for (const a of reg.apps) for (const check of checks) errs.push(...check(a, ctx));
```
Existing tests (`tests/unit/registry.test.mjs`, `instances.test.mjs`) pin the messages, so this is a safe refactor.

**Sound:** `lib/util.mjs`, `lib/http-util.mjs`, `lib/errors.mjs`, `lib/metrics.mjs`, `lib/log.mjs`, `lib/instance-app.mjs`, `lib/docker.mjs`, `demo-gateway/reset.mjs`, `demo-gateway/instances.mjs` and `lib/store/shared.mjs` each have one purpose and a short public surface.

---

## 2. Open/closed

### O-01: host process versus container, five branches · 4/10
**Location:** `supervisor/index.mjs:67` (`isManaged`), `:95` (path check in `start`), `:120-129` (container start), `:157-162` (container stop), plus `lib/registry.mjs:36-38` and `:85`. A third kind of process (a systemd unit, a Kubernetes job) needs edits in all of them.

**Fix:** one runtime object per kind, chosen once:
```js
// supervisor/runtimes.mjs
export const containerRuntime = {
  isManaged: async (p, rec, up) => !!(rec?.container && up && await containerRunning(rec.container)),
  start: async (app, p, ctx) => { await startContainer(p.container); /* record + wait, as at lines 120-129 */ },
  stop: async (app, name, rec) => { await stopContainer(rec.container); },
};
export const hostRuntime = { /* isManaged by PID start time, spawnApp via driver, killTree */ };
export const runtimeFor = (p) => (p.container ? containerRuntime : hostRuntime);
// start():  for (const p of pending) await runtimeFor(p).start(app, p, ctx);
```

### O-02: shared versus private demo copies · 3/10
**Location:** `demo-gateway/gateway.mjs:203` (notice text), `:207` (seat check), `:225` (start the copy), `:243-252` (readiness and "preparing" page), `:330-333` (WebSocket readiness).
**Fix:** a small strategy chosen once per request; the shared one does nothing:
```js
const sharedMode = { notice: SHARED_NOTICE, hasRoom: async () => true, onEnter: async () => {}, resolve: async () => ({ state: 'ready', slot: null }) };
const privateMode = (slug, target, g) => ({ notice: PRIVATE_NOTICE,
  hasRoom: () => instances.hasRoom(slug, target, g.id), onEnter: () => instances.ensure(slug, target, g.id),
  resolve: () => instances.lookup(slug, g.id) });
const mode = target.perLink ? privateMode(slug, target, g) : sharedMode;
```
Then `if (!(await mode.hasRoom()))`, `await mode.onEnter()`, and so on. `instances.mjs` already isolates the private-copy logic, so this only moves the `if`s.

### O-03: supervisor commands · 3/10
**Location:** `supervisor/index.mjs:279-287`.
```js
const commands = {
  status: () => status(id === '--json'), start: () => start(getApp(id), only), stop: () => stop(getApp(id), only),
  restart: async () => { const a = getApp(id); await stop(a, only); await start(a, only); },
  reset: () => reset(getApp(id)), build: () => build(getApp(id)),
  'instance-start': () => instanceStart(getApp(id), rest[0]), 'instance-stop': () => instanceStop(getApp(id), rest[0]),
};
if (commands[cmd]) await commands[cmd](); else console.log(USAGE);
```

### O-04: backend and driver selection · 2/10
**Location:** `lib/store/index.mjs:17` (nested ternary), `lib/process-driver.mjs:125-129` (`if` chain).
```js
const BACKENDS = { sqlite: () => openSqlite(join(dataDir, 'dashboard.db')), postgres: () => openPostgres() };
const open = BACKENDS[kind]; if (!open) throw new Error(`Unknown DASHBOARD_DB "${kind}". Use ${Object.keys(BACKENDS).join(' or ')}.`);
```

**Sound (open for extension):** a new product, its processes, `demoRoutes`, `reset` steps, `build`, `snapshot`, `perLink` and `demoAccounts` are all registry data; the console's audit filters (`console.mjs` `keep` map) and the showcase `specimens` map are open tables.

---

## 3. Liskov substitution

There are two families of interchangeable parts: the stores (`lib/store/sqlite.mjs`, `postgres.mjs`) and the process drivers (`windowsDriver`, `posixDriver`). Both are checked by tests (`tests/unit/store-contract.test.mjs` runs one set of assertions against both stores; `tests/unit/process-driver.test.mjs`, `tests/linux/driver-check.mjs`). `HttpError` extends `Error` and `toResponse` honours its `expose` flag: sound. `instanceApp()` returns an object with the shape of a registry app, so `start(app)` accepts a private copy exactly like a registered app: sound.

### L-01: synchronous versus asynchronous store · 3/10
**Location:** `lib/store/sqlite.mjs` header comment ("All methods are synchronous here, but callers must `await` them") against `lib/store/postgres.mjs` (every method `async`). SQLite also adds a `file` property that Postgres lacks (no caller outside `sqlite.mjs` uses it today).

**Why it matters:** the contract test catches a wrong *result*, but a caller that forgets one `await` (for example `if (store.meta.get(k))`) passes every SQLite test and breaks only on the hosted Postgres setup. A synchronous SQLite call also blocks the event loop for its whole duration (measured at up to 4 ms in the security audit, S-02).
**Fix:** make SQLite honour the same shape so the mistake shows up locally:
```js
// lib/store/sqlite.mjs: wrap every leaf function once, at the end of openSqlite
const asyncGroup = (g) => Object.fromEntries(Object.entries(g).map(([k, f]) => [k, async (...a) => f(...a)]));
return { kind: 'sqlite', file, close: () => db.close(),
  ...Object.fromEntries(['grants','grantSessions','sessions','audit','processState','rateLimit','meta'].map((n) => [n, asyncGroup(inner[n])])) };
```
(`tx` stays synchronous inside, so atomicity is unchanged; the `await` the callers already have now matters.)

### L-02: optional driver method · 2/10
**Location:** `supervisor/index.mjs:76` (`driver.startTimes ? driver.startTimes(pids) : new Map()`). Both shipped drivers define `startTimes`, so the guard hides a contract that is not written down.
**Fix:** treat it as required and delete the guard, or add a default in `getDriver`:
```js
return { startTimes: (pids) => new Map(pids.map((p) => [Number(p), driver.startTime(p)]).filter(([, t]) => t)), ...driver };
```

---

## 4. Interface segregation

### I-01: the store is one wide object · 3/10
**Location:** `lib/store/sqlite.mjs` / `postgres.mjs` return `grants`, `grantSessions`, `sessions`, `audit`, `processState`, `rateLimit`, `meta`, `close` (about 30 methods). Consumers need slices: `supervisor/index.mjs` uses `processState` only; `createInstances` uses `meta`, `audit`, `grants.list`; `reset.mjs` uses `meta`, `audit`, `grants.list`; the console uses `sessions`, `meta`, `audit`, `rateLimit`. Test fakes therefore have to be the whole store or a real database.
**Fix:** depend on the slice. `createInstances({ store, supervisor })` becomes `createInstances({ meta: store.meta, audit: store.audit, grants: store.grants, supervisor })`; no change to the stores. Document the slices once:
```js
/** @typedef {{ get(k): Promise<string|null>, set(k, v): Promise<void> }} MetaStore */
/** @typedef {{ add(e): Promise<void>, list(n): Promise<object[]> }} AuditLog */
```

### I-02: `store.meta` as a junk drawer · 3/10
**Location:** keys written through `meta.get`/`meta.set`: admin login (`ADMIN_KEYS.*` in `lib/auth.mjs`, seven keys), reset state (`demo_resetting:<p>`, `demo_reset_at:<p>`, `demo_reset_failed:<p>` in `demo-gateway/reset.mjs`), the seat table (`inst:<p>` in `instances.mjs`, a JSON blob rewritten whole), import flags (`legacy_imported`, `legacy_audit_imported`) and a health probe (`'health-check'`).
**Why it matters:** each concern depends on the whole generic store and the key spelling is its only contract; the seat table is a read-modify-write of one JSON value guarded only by an in-process lock.
**Fix:** a thin typed module per concern over the same `meta` (no schema change):
```js
// lib/store/admin-login.mjs
export const adminLogin = (meta) => ({
  passwordHash: () => meta.get(ADMIN_KEYS.passwordHash), setPasswordHash: (h) => meta.set(ADMIN_KEYS.passwordHash, h),
  totpSecret: () => meta.get(ADMIN_KEYS.totpSecret), /* ... */
});
```
Consumers (`console.mjs`, `auth-cli.mjs`, `server.mjs`) then name an operation, not a string key.

### I-03: `lib/auth.mjs` serves two audiences · 2/10
**Location:** `lib/auth.mjs` holds admin-only parts (scrypt password hashes, TOTP, AES sealing of the 2-step secret, `ADMIN_KEYS`) and generic ones (`sha256`, `newSessionId`, `hashSessionId`). `demo-gateway/gateway.mjs:24` and `grants.mjs:7` import the generic ones from it, so the customer-facing gateway depends on the admin login module.
**Fix:** `lib/ids.mjs` with `sha256`, `newSessionId`, `hashSessionId`; `lib/auth.mjs` re-exports them so existing imports keep working.

Minor: `lib/util.mjs` is a grab-bag (`num`, `sleep`, `errMessage`, `unmapV4`, `parseEnvText`, `missingKeys`, `createSerialLock`, `skipIfRunning`, `fireAndForget`). In JavaScript importing one name costs nothing extra, so this is not worth moving unless the file keeps growing.

---

## 5. Dependency inversion

**What is already good:** the supervisor is injected into the console, the gateway, `createInstances` and `runReset` (`opts.supervisor`, `createInstances({ store, supervisor, now })`, `runReset({ store, product, app, supervisor })`), which is why the tests run those paths with fakes. `ensureEngine({ up, launch, sleep, now, log })` injects every OS and clock access. `createInstances`, `resetSweep` and `runReset` take the store as an argument. `new` is used only for platform objects (`URL`, `Map`, `Set`, `http.Agent`, `pg.Pool`), never to build one of this project's services.

### D-01: the store is fetched, not passed · 5/10
**Location:** `demo-gateway/gateway.mjs:85` (`const store = await getStore()`), `admin-console/console.mjs:73`, `demo-gateway/grants.mjs:18`, `:35`, `:51`, `:57` (`createGrant`, `revokeGrant`, `findGrant`, `loadGrants` each call `getStore()`), `supervisor/index.mjs:28`. `getStore()` returns one process-wide instance (`lib/store/index.mjs`).
**Evidence it costs something:** the tests have to set `DASHBOARD_DATA` and `DASHBOARD_REGISTRY` before a dynamic `import()` of the module (the headers of `tests/unit/gateway.test.mjs` and `console.test.mjs` say so), and a test cannot run two gateways against two stores in one process.
**Fix:** accept the store, defaulting to the current behaviour so nothing else changes:
```js
// gateway.mjs / console.mjs
export async function createGateway(opts = {}) {
  const store = opts.store ?? await getStore();
// grants.mjs: functions take the store explicitly
export async function createGrant(store, { customer, app, hours = 48, maxUses = null, deviceLock = false }, who = {}) { ... }
export const revokeGrant = async (store, id, who = {}) => { ... };
```
and have the console/CLI pass `store`. This also removes the reason `grants.mjs` imports `getStore`/`closeStore`.

### D-02: the registry is a hidden global · 4/10
**Location:** `demo-gateway/grants.mjs:22-32` (`demoApps()` reads the registry file, with a module-level `lastGood`), called per request from `gateway.mjs:135`, `:157` and from `:412-415`; `lib/registry.mjs` `loadRegistry(path = defaultPath)` with the default taken from `lib/config.mjs` at import time (`process.env.DASHBOARD_REGISTRY`).
**Fix:** let the caller supply the lookup, keeping the current function as the default:
```js
export async function createGateway(opts = {}) {
  const o = { ..., demoApps, ...opts };      // o.demoApps()
  // gateway.mjs: replace every demoApps() with o.demoApps()
```
The same option removes the need for tests to write a registry file just to define a fake product.

### D-03: two sources of truth for HTTPS · 3/10
**Location:** `demo-gateway/gateway.mjs:47` (`const HTTPS = (process.env.DEMO_SCHEME || 'http') === 'https'`, read once at import) feeds `OWN_HEADERS` (lines 48-49) and the proxied-response header at `:273`, while cookies, redirects and `X-Forwarded-Proto` use the option `o.scheme` (`:81`, `:226`, `:260`). A gateway created with `{ scheme: 'https' }` (as `createGateway` allows) would set `Secure` cookies but not send `Strict-Transport-Security` unless the environment variable also says so.
**Fix:** derive both from the option:
```js
// inside createGateway, after `o` is built
const https = o.scheme === 'https';
const ownHeaders = { ...OWN_HEADERS_BASE, ...(https ? { 'strict-transport-security': 'max-age=31536000' } : {}) };
// page(res, code, title, msg, headers, head) -> uses ownHeaders; line 273: if (https) ...
```
`page` currently sits outside the factory (line 51), so it needs the headers passed in or moved inside.

### D-04: the supervisor binds its parts at import · 3/10
**Location:** `supervisor/index.mjs:25-33` (`registry = loadRegistry()`, `store = await getStore()`, `driver = getDriver()`) and direct imports of `containerRunning`, `startContainer`, `stopContainer`. Same cause as S-01; the fix is the same `createSupervisor({ registry, store, driver, docker })` factory. The driver is already an interface with two implementations, so only the wiring is missing.

**Unable to verify:** whether anything outside this repository imports `grants.mjs` or `supervisor/index.mjs` directly. D-01 and S-01 change signatures; keeping the old zero-argument behaviour as the default (as shown) avoids breaking such callers, but only a search of the other projects could prove there are none.

---

## 6. Suggested order

1. **D-01** and **D-02** (pass the store and the registry lookup as options with the current defaults). Small, behaviour-neutral, and they make every later split testable.
2. **D-03** (one source for HTTPS): a real inconsistency, a few lines.
3. **S-01 / D-04** (make the supervisor importable, then split it) and **O-01** (runtimes), which share the same work.
4. **S-02** (pure proxy helpers first, then WebSocket and redemption), **S-03** with **O-03** (route and command tables).
5. **L-01**, **I-01**, **I-02**, **I-03**, then the remaining low items as time allows.

Each step can be checked with the existing suite (`npm test`, 192 tests) before the next one; none of them needs a data or registry format change.
