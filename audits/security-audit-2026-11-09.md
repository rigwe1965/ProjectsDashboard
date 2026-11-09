# Security Audit: ProjectsDashboard

Date: 2026-11-09 · Commit reviewed: `c9e0320` (`main`, working tree clean) · Scope: all tracked code and config: `admin-console/`, `demo-gateway/`, `lib/`, `lib/store/`, `supervisor/`, `showcase/`, `deploy/`, `.github/`, `registry/`, `package*.json`, the launcher `.bat` files. The demo apps themselves (`data/demo-src/*` and the originals on the Desktop) are **out of scope**, except where this repo decides how they run.

Method: full read of the code listed above; `npm audit` (0 vulnerabilities); `npm test` (190 tests, 189 pass, 1 skipped, 0 fail); a search of tracked files and of git history for keys, tokens, private keys, URLs with passwords and committed env files; one measurement (S-02). Nothing was run against a live or hosted deployment. Where a claim depends on something I could not see, it is marked **Unable to verify** with what would settle it.

Importance scale: 1–10, 10 = critical. **No finding scores above 5. There is no critical or high issue and no path to a breach that I could find.** This is the third security pass. The 19 findings of `security-audit-2026-11-08.md` and the follow-ups in `security-reaudit-2026-11-08.md` were fixed and I re-read the fixes; they hold. The findings below are new, plus a short list of earlier items that are still open.

---

## 1. Summary

| ID | Finding | Category | Importance |
| --- | --- | --- | --- |
| S-01 | Hosted compose puts the dashboard database, console, gateway and every customer-facing demo on one flat network | Configuration & Hardening | **5** |
| S-02 | The rate limiter records and counts every refused request, so its cost grows with the attack (measured) | Configuration / DoS | **4** |
| S-03 | Hosted console: the 2-step code and the encryption key for its secret are both optional | Authentication / Secrets | **4** |
| S-04 | Sign-in throttling is per address (IPv6 gets a fresh budget per address) and the hashing queue is unbounded | Authentication | **3** |
| S-05 | A WebSocket counter is never decremented on one refusal path, which can lock a customer out of their own link | Availability (found in code review) | **3** |
| S-06 | `imageapp-demo` and `airfinder-demo` containers have no capability drop, no `no-new-privileges`, no limits | Configuration & Hardening | **3** |
| S-07 | `grant-created` and `grant-revoked` audit events carry no source address | Security logging | **3** |
| S-08 | `start-console.bat` leaves the one-time console URL (the token) in a log file | Secrets | **3** |
| S-09 | A compiled `.pyc` file is tracked in git | Supply chain | **2** |
| S-10 | `apply-sql.mjs` loads `pg` from an untracked folder outside the lockfile | Dependencies | **2** |
| S-11 | The hosted CRM demo container holds the database owner's credentials | Configuration | **2** |
| S-12 | CI has no secret scan, image scan or code scan | Supply chain | **2** |
| S-13 | App process logs are created with default permissions and shown unredacted in the console | Secrets / Privacy | **2** |
| S-14 | Customer IP and browser strings are kept 90 days with no way to remove one customer's records | Data flow & Privacy | **2** |

Group by category:

- **Authentication & Authorization:** S-03, S-04. Access control itself (grants bound to one product, re-checked on every request, immediate revocation) is sound.
- **Input validation & injection:** nothing found. See section 4.
- **Secrets & sensitive data:** S-03, S-08, S-13. No secrets in tracked files or in git history.
- **Cryptography & transport:** nothing found. TLS verification is on; scrypt, AES-256-GCM and TOTP are used correctly.
- **Dependencies & supply chain:** S-09, S-10, S-12.
- **Configuration & hardening:** S-01, S-02, S-06, S-11.
- **Data flow & privacy:** S-05 (availability), S-07, S-14.

---

## 2. Findings

### S-01: One flat network for the database, the control plane and every customer-facing demo · 5/10
**Status: fixed 2026-11-09** (four networks: `edge`, `db`, `apps`, `crm`; `docker compose config` validates, runtime isolation not exercised).
**Category:** Configuration & Hardening / cross-tenant
**Location:** `deploy/docker-compose.yml`: every service ends with `networks: [internal]` (postgres line 44, gateway 63, console 85, then the app containers at lines 118, 140, 163, 181, 218, 250, 270, 285); the only network defined is `internal` (172.30.0.0/24).

**Description:** all containers share one network, and Docker lets containers on one network reach each other on every port. So the demo apps that customers use (and that run other people's code paths: image uploads, a Flask app, two Next.js apps) can open connections to `postgres:5432` (the dashboard's own database: grants, sessions, the admin password hash and the encrypted 2-step secret), `console:4100`, `gateway:4300`, and to each other (`crm-demo-db:5432`).
Reaching is not the same as getting in: the dashboard database needs `POSTGRES_PASSWORD`, which no demo container has, and the console needs the admin password. But a compromised demo container can now attack the database login, the admin login (from an internal address that the per-address limit treats as one client) and the other demos' databases without any firewall between them. The hosted `compose` already took care of the other hardening (read-only root, dropped capabilities for the two Node services), so this is the largest remaining gap in the hosted design.

**Importance:** 5/10. It needs a first compromise of a demo container to matter, but turns one compromised demo into a foothold on the control plane.

**Remediation:** three networks; Postgres only on the one that the gateway and console share, the demos only on the one that the gateway shares.

```yaml
# deploy/docker-compose.yml
networks:
  edge:   { ipam: { config: [{ subnet: 172.30.0.0/24, ip_range: 172.30.0.128/25 }] } }  # caddy <-> gateway, console
  db:     { internal: true }                                                            # postgres <-> gateway, console
  apps:   { internal: true }                                                            # gateway <-> demo containers
# postgres:                networks: [db]
# gateway:                 networks: [edge, db, apps]
# console:                 networks: [edge, db]
# caddy:                   networks: { edge: { ipv4_address: 172.30.0.2 } }
# imageapp-demo, airfinder-demo, claudeworkspace-*:   networks: [apps]
# crm-demo + its db + ratelimit:   a fourth network `crm: { internal: true }` shared only by those three, plus `apps` on crm-demo
```
`internal: true` also stops the demos from reaching the internet, which the demo apps do not need (the Supabase-backed ClaudeWorkspace containers do, so leave `edge` or a separate egress network on those two).
Keep `TRUSTED_PROXIES: 172.30.0.2` pointing at Caddy's address on `edge`. **Unable to verify** the effect on the running stack (Docker was not used here); `docker compose config` and a `docker compose exec imageapp-demo python -c "import socket; socket.create_connection(('postgres',5432),2)"` that now fails would confirm it.

---

### S-02: The rate limiter's cost grows with the attack · 4/10
**Status: fixed 2026-11-09** (`rateLimit.hit(key, window, max)` stops recording once the window holds `max` hits; used by the gateway and the console sign-in; store contract test added).
**Category:** Configuration & Hardening (denial of service)
**Location:** `demo-gateway/gateway.mjs:90` (`limited`) and `:187`; `lib/store/sqlite.mjs`, `rateLimit.hit`; `lib/store/postgres.mjs`, `rateLimit.hit`. The same pattern is used by `admin-console/console.mjs:120` (`login:<ip>`).

**Description:** `hit(key, window)` always inserts a row and then counts all rows for that key in the window. A request that is over the limit still inserts a row and still counts, so one address sending requests faster than the limit makes its own count, and so the cost of every later request, grow. Measured here with the real SQLite store (synchronous, so it blocks the gateway's event loop for every customer):

| Rows for one address in the last minute | Time for one more `hit()` |
| --- | --- |
| 100 | 0.03 ms |
| 10,000 | 0.21 ms |
| 60,000 | 2.00 ms |
| 120,000 | 4.24 ms |

At about 2,000 requests per second from one address the gateway spends its whole time counting; a spread of many addresses is cheaper to run but costs the database the same way. Caddy and the network sit in front, so this is not a one-line exploit, but the redemption path `/d/<48 hex>` is reachable by anyone and does this work before it looks at the token. The in-memory `tooManyMisses` limiter already used for session-less requests (`gateway.mjs:101-106`) has the right shape; the link path does not use it.

**Importance:** 4/10. A cheap denial of service of the whole gateway (all customers), no data exposure.

**Remediation:** refuse first from memory, then spend a database write only for requests that are within the limit.

```js
// demo-gateway/gateway.mjs: a cheap first line for the redemption path, before any database work
const redeemMisses = new Map(); // ip -> { n, t }
const overBurst = (ip, max = o.redeemPerMinute * 5) => {
  const now = Date.now(), b = redeemMisses.get(ip);
  if (!b || now - b.t > 60000) { redeemMisses.set(ip, { n: 1, t: now }); return false; }
  return ++b.n > max;
};
// at the top of the /d/<token> branch:
if (overBurst(ip)) { metrics.inc('pd_gateway_redeem_total', { result: 'limited' }); return tooMany(res, 60); }
```
and in both stores make `hit` stop recording once the caller is clearly over (or add a `hitIfBelow(key, windowMs, max)` that counts first and inserts only when `count < max`). Sweep `redeemMisses` with the existing `missTimer`.

---

### S-03: Hosted console: 2-step code and the key that protects its secret are optional · 4/10
**Status: fixed 2026-11-09** (`ADMIN_DATA_KEY` required by compose; `ADMIN_REQUIRE_TOTP=1` makes the console refuse to listen beyond loopback without 2-step codes; test added).
**Category:** Authentication / Secrets
**Location:** `deploy/docker-compose.yml:77` (`ADMIN_DATA_KEY: ${ADMIN_DATA_KEY:-}`); `admin-console/console.mjs:83-90` (the start-up checks); `admin-console/server.mjs:8-16`; `deploy/.env.example` (`ADMIN_DATA_KEY=` blank).

**Description:** the hosted console is published on the internet at `ADMIN_DOMAIN`. The start-up checks require a password and HTTPS but not a 2-step code, so a hosted console that has only a password is accepted. Separately, `ADMIN_DATA_KEY` may be blank; then the 2-step secret is stored in the database in plain text and only a log line (`logger.warn`) says so. The console controls customer links, resets (which wipe demo data) and starts/stops processes, so it is the most valuable target in the system. Per-address limits (8 per 15 minutes) and a 12+ character password make guessing slow, but a password is then the only barrier.

**Importance:** 4/10. Mitigated by the password policy and the rate limits, and by the fact that the data behind the console is demo data, but it is the highest-value login and the extra factor is only a recommendation.

**Remediation:** make the hosted setup fail closed.
```yaml
# deploy/docker-compose.yml, console service
ADMIN_DATA_KEY: ${ADMIN_DATA_KEY:?set ADMIN_DATA_KEY in deploy/.env (npm run console:auth -- gen-key)}
ADMIN_REQUIRE_TOTP: "1"
```
```js
// admin-console/console.mjs, next to the other start-up refusals
if (!LOOPBACK.has(o.bindHost) && process.env.ADMIN_REQUIRE_TOTP === '1' && !(await store.meta.get(ADMIN_KEYS.totpSecret))) {
  throw new Error('Refusing to listen beyond this machine without 2-step codes. Run "npm run console:auth enable-totp" first.');
}
```
Optional extra layer at the edge (the console is for one person): an address allow-list in `deploy/Caddyfile`:
```
{$ADMIN_DOMAIN} {
	@blocked not remote_ip {$ADMIN_ALLOWED_IPS}
	respond @blocked 404
	...
```

---

### S-04: Sign-in throttling is per address, and the hashing queue is unbounded · 3/10
**Status: fixed 2026-11-09.** `limitKey()` (`lib/http-util.mjs`) makes an IPv6 client count as its whole /64 for the console sign-in and for the gateway's link-open and no-session limits. The password-hashing queue holds at most 20 waiting checks (`AUTH_BUSY`); further ones get an immediate 429 and are not counted as wrong passwords. Tests added for all three.
**Category:** Authentication
**Location:** `admin-console/console.mjs:119-121` (`login:<ip>` limit), `:143-147` (penalty only when the overall cap is passed); `lib/auth.mjs:21-26` (`withSlot`, `queue`).

**Description:** two limits sit on top of each other. (1) The per-address limit of 8 per 15 minutes uses the full address; an IPv6 client controls a whole /64 (2^64 addresses), so every guess can come from a "new" address. What is left is the overall failure cap (40 per 15 minutes) which, by design (SEC-12), refuses wrong guesses with a 1.5 s delay but still lets a correct password through. (2) Each attempt waits for one of two scrypt slots; the queue behind them has no limit. A flood of attempts therefore makes the owner's own sign-in wait behind the queue, even though the cap is "not locking the owner out". Throughput for a guesser is bounded by the machine (roughly a few guesses per second), which is slow against a 12+ character password, but it is not bounded by policy.

**Importance:** 3/10. Needs a password the attacker cannot guess quickly; the practical effect is a delay of the owner's sign-in. Becomes more relevant if S-03 is left as is.

**Remediation:**
```js
// lib/http-util.mjs: count IPv6 clients by /64
export const limitKey = (ip) => (ip.includes(':') ? ip.split(':').slice(0, 4).join(':') + '::/64' : ip);
// console.mjs: store.rateLimit.hit('login:' + limitKey(ip), 900000)
```
```js
// lib/auth.mjs: refuse instead of queueing without limit
const MAX_QUEUE = 20;
async function withSlot(fn) {
  if (hashing >= MAX_HASHING) {
    if (queue.length >= MAX_QUEUE) throw Object.assign(new Error('busy'), { status: 429 });
    await new Promise((r) => queue.push(r));
  } else hashing++;
  ...
}
```
(`verifyPassword` already turns a throw into "wrong", so catch `busy` in `login()` and answer 429 before counting it as a failure.)

---

### S-05: WebSocket counter is not released when a per-link copy is not ready · 3/10
**Status: fixed 2026-11-09, confirmed defect** (the new gateway test fails on the old code and passes now; `releaseWs()` gives the count back on every refusal).
**Category:** Availability / Data flow (found in code review; not exercised)
**Location:** `demo-gateway/gateway.mjs:324-333` (`upgrade`).

**Description:** the socket count for a grant is raised at line 325 (`wsCounts.set(g.id, … + 1)`) before the per-link lookup. The refusal at line 331 (`if (inst?.state !== 'ready') return rejectUpgrade(socket, 503, …)`) and any error thrown by `await instances.lookup(…)` return without releasing it, because `close()` (which decrements) is only defined later at line 337. Streamlit-style clients reconnect in a loop; a customer whose private copy is restarting can therefore use up their 20 slots (`maxWsPerGrant`) without ever opening one, and then gets 429 for every WebSocket until the gateway is restarted. The effect is limited to that customer's own link (self lock-out), so it is an availability bug, not an access problem.

**Importance:** 3/10.

**Remediation:** count only after every refusal has passed.
```js
// move these two lines to just before `const upstream = net.connect(...)`
if ((wsCounts.get(g.id) || 0) >= o.maxWsPerGrant) return rejectUpgrade(socket, 429, 'Too Many Requests');
wsCounts.set(g.id, (wsCounts.get(g.id) || 0) + 1);
```
(the per-link lookup and `upstreamPort(...)` come first; `net.connect` does not throw synchronously). A test: open `maxWsPerGrant + 1` upgrades while the copy is `starting`, then once `ready`, and expect the last one to succeed.

---

### S-06: Two demo containers lack the hardening the others have · 3/10
**Category:** Configuration & Hardening
**Location:** `deploy/docker-compose.yml`: `imageapp-demo` (line 105) and `airfinder-demo` (line 120) have no `security_opt`, `cap_drop`, `pids_limit` or `mem_limit`. `crm-demo` and the two `claudeworkspace-*` services have `no-new-privileges`, `cap_drop: [ALL]` and `pids_limit` but no `mem_limit`. Base images in `deploy/Dockerfile`, `deploy/Caddy.Dockerfile` and `deploy/apps/*/Dockerfile` are floating tags (`node:24-slim`, `postgres:17-alpine`, `caddy:2-alpine`, `python:3.12-slim`), not digests (carried from SEC-16).

**Description:** `imageapp-demo` processes uploaded images from customers and runs as a non-root user (good) but with Docker's default capabilities and without a process or memory limit; a decompression bomb or a runaway request can take the host's memory. `airfinder-demo` is the same. Their images run as UID 10001, which limits the damage, but the other containers show the intended standard.

**Importance:** 3/10.

**Remediation:** reuse the existing anchor (a read-only root needs a `tmpfs` for the app's temp folders; `imageapp` writes to `/tmp/imageapp` and `/var/log/imageapp`, `airfinder` to the `airfinder_demo_data` volume):
```yaml
x-demo-limits: &demo-limits
  security_opt: ["no-new-privileges:true"]
  cap_drop: [ALL]
  pids_limit: 256
  mem_limit: 768m
# imageapp-demo:   <<: *demo-limits      tmpfs: [/tmp, /var/log/imageapp]
# airfinder-demo:  <<: *demo-limits
# crm-demo, claudeworkspace-*: add mem_limit: 1g
```
Digests: `docker buildx imagetools inspect node:24-slim` and pin `FROM node:24-slim@sha256:…`; Dependabot (already configured for Docker) keeps the digest current.

---

### S-07: `grant-created` and `grant-revoked` events say nothing about who or where · 3/10
**Category:** Security logging / audit trail
**Location:** `demo-gateway/grants.mjs:53` and `:60` (the audit calls); `admin-console/console.mjs:269` and `:286-287` (the callers), compared with `console.mjs:241` and `:279`, which do record `ip`.

**Description:** the two most security-relevant admin actions, creating and revoking a customer's access, are written as `{ ev, grant, app, … }` with no `ip` and no `by`. Starts, stops, resets and sign-ins do record an address. If a link is created or revoked unexpectedly, the log cannot say from which address (or whether from the console or the command line). With one admin this is small, but it is the event an investigation starts from.

**Importance:** 3/10.

**Remediation:**
```js
// grants.mjs
export async function createGrant({ customer, app, hours = 48, maxUses = null, deviceLock = false }, who = {}) { … await store.audit.add({ ev: 'grant-created', …, ...who }); }
export async function revokeGrant(id, who = {}) { … await store.audit.add({ ev: 'grant-revoked', grant: t.id, app: t.app, ...who }); }
// console.mjs
createGrant({ … }, { ip: clientIp(req, trusted), by: 'console' });
revokeGrant(m[1], { ip: clientIp(req, trusted), by: 'console' });
// grants.mjs CLI: { by: 'cli' }
```
Add `grant-created`/`grant-revoked` to the "admin" filter list in `/api/audit` (`console.mjs:204`, which currently keys on the `admin-` prefix, so these show only under "demos").

---

### S-08: The one-time console URL is left in a log file · 3/10
**Category:** Secrets & Sensitive Data
**Location:** `start-console.bat` (starts `node admin-console\server.mjs > %LOG% 2>&1`, then reads the `?t=` line back from `data\logs\console-launcher.out`); `admin-console/server.mjs` (prints `…/?t=<token>`); `admin-console/console.mjs:188-193` (in token mode the cookie value *is* the launch token).

**Description:** in token mode (no password set), the full URL with the launch token is written to a file and stays there until the next launch overwrites it. Anyone who can read `data\logs\` can use it to open the console (start/stop apps, create customer links) as long as that console process runs. The token is 192-bit random and the console is loopback-only, so the exposure is to other local users or to a backup/sync tool that copies the folder. On a single-user PC this is minor, which is why it is not higher.

**Importance:** 3/10.

**Remediation:** have the launcher read the URL from the process's output without keeping it, or delete the log after reading:
```bat
rem start-console.bat, after the URL has been read into %URL%
if exist %LOG% del /q %LOG%
```
Better, `set-password` once (the README already recommends it): password mode does not print a token at all.

---

### S-09: A compiled Python file is tracked in git · 2/10
**Category:** Supply chain
**Location:** `supervisor/demo-fixes/__pycache__/rmm_demo_services.cpython-311.pyc` (tracked: `git ls-files | grep pyc`); `.gitignore` has no `__pycache__` rule.

**Description:** bytecode in a repository cannot be reviewed, and Python will run a `.pyc` that sits next to the source if its recorded modification time and size match, so a changed `.pyc` could run in place of the reviewed `.py`. **Unable to verify** that this file matches `rmm_demo_services.py` (compare with `python -m py_compile` output). It was almost certainly added by accident when the tests ran Python.

**Importance:** 2/10.

**Remediation:**
```bash
git rm --cached -r supervisor/demo-fixes/__pycache__
printf '__pycache__/\n*.pyc\n' >> .gitignore
```

---

### S-10: `apply-sql.mjs` uses a database driver outside the lockfile · 2/10
**Category:** Dependencies & Supply chain
**Location:** `supervisor/apply-sql.mjs:12` (`createRequire(join(root, 'data', 'tools', 'package.json'))('pg')`); `data/tools/package.json` (untracked; `pg ^8.23.1`, `pnpm ^9.15.0`).

**Description:** this script connects to a hosted database with the Supabase demo credentials, using a copy of `pg` from `data/tools/node_modules`. That copy is not in `package-lock.json`, not covered by `npm audit` in CI or by Dependabot, and the `^` range moves on every install. The repository already depends on `pg` (`package.json`), so the extra copy is unnecessary.

**Importance:** 2/10.

**Remediation:**
```js
// apply-sql.mjs
import pg from 'pg';           // the version pinned by package-lock.json
const { Client } = pg;
```
and remove the `createRequire` lines and the `data/tools` dependency on `pg`.

---

### S-11: The hosted CRM demo container holds the database owner's credentials · 2/10
**Category:** Configuration
**Location:** `deploy/docker-compose.yml`, `crm-demo` environment: `DIRECT_URL` and `PLATFORM_DATABASE_URL` use the owner role `crm`; `DATABASE_URL` uses the restricted `crm_app` role (`deploy/apps/crm/init-roles.sh` makes it `NOBYPASSRLS`).

**Description:** the compose comment says the restricted role is there so that row-level security binds in the demo as in production. The container also gets the owner's URLs (needed for `prisma migrate deploy` at start, and the app's platform connection), so anything running inside the container can connect as the owner and ignore row-level security. **Unable to verify** whether the running app uses `PLATFORM_DATABASE_URL`; the Dockerfile entrypoint needs `DIRECT_URL` only at start-up. It is a demo database with sample data, so the impact is small.

**Importance:** 2/10.

**Remediation:** run migrations in a one-off container (like the existing seed) and give the long-running `crm-demo` only `DATABASE_URL`; keep `PLATFORM_DATABASE_URL` only if the app needs it at run time.

---

### S-12: CI does not scan for secrets, images or code issues · 2/10
**Category:** Dependencies & Supply chain
**Location:** `.github/workflows/ci.yml`.

**Description:** CI runs `npm audit`, lint, tests and builds the two images, with a read-only token and pinned action SHAs (good). It has no secret scan (the repository is clean today; the check would keep it so), no image scan of what `docker build` produces, and no static analysis. **Unable to verify** that the pinned action SHAs match their upstream tags (no network check was made).

**Importance:** 2/10.

**Remediation:** add a job (pin each action to a commit SHA as the others are):
```yaml
  scan:
    runs-on: ubuntu-latest
    permissions: { contents: read, security-events: write }
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@<sha>
      - uses: github/codeql-action/init@<sha>
        with: { languages: javascript-typescript }
      - uses: github/codeql-action/analyze@<sha>
```
and `aquasecurity/trivy-action` against `projects-dashboard` after the image build.

---

### S-13: App process logs: default permissions, shown unredacted · 2/10
**Category:** Secrets / Privacy
**Location:** `lib/process-driver.mjs:66` and `:101` (output redirected by the shell into `data/logs/<app>-<proc>.log`); `admin-console/console.mjs:226-231` (`/api/apps/:id/logs` returns the last 12 KB as it is); compare `supervisor/index.mjs` `runLoggedStep` / `redact`, which does create step logs owner-only and masks secret-looking values (RA-05).

**Description:** the earlier fix covered build, reset and prepare logs. The long-running processes' own logs (a dev server printing a request URL, a stack trace with a connection string, a demo user's e-mail address) are created with the process's default permissions and are returned to the browser in full. The console is owner-only, so exposure is to other local users of the PC (or a log shipper in the hosted setup) and to the owner's screen.

**Importance:** 2/10.

**Remediation:** create the log files owner-only before the process starts, and mask on the way out:
```js
// supervisor/index.mjs, before driver.spawnApp(...)
try { appendFileSync(logPath, '', { mode: 0o600 }); } catch { /* best effort */ }
```
```js
// console.mjs: /logs
return json(res, 200, { log: tail(...).replace(/((?:password|secret|token|key)\w*["'=:\s]+)[^\s"']{8,}/gi, '$1***') });
```

---

### S-14: Customer addresses and browser strings are kept for 90 days, with no per-customer removal · 2/10
**Category:** Data flow & Privacy
**Location:** `demo-gateway/server.mjs:10-20` (`AUDIT_RETENTION_DAYS`, default 90); `lib/store/sqlite.mjs` and `postgres.mjs` (`audit.prune(days)` is the only delete); events carry `ip`, `ua`, `customer`.

**Description:** the audit log stores each customer's IP address and User-Agent for every open, denial and WebSocket event, and the customer's name on the grant. Retention is time-based and applied daily (good). There is no way to remove everything about one customer on request, and the same 90 days also apply to the admin sign-in events, which are the ones worth keeping longest for an investigation. Whether this needs a notice depends on who the customers are (**Unable to verify**: legal context).

**Importance:** 2/10.

**Remediation:** a `forget` command and a longer window for admin events:
```js
// store: audit.deleteForGrant(id) -> DELETE FROM audit WHERE grant_id = ?
// server.mjs: prune customer events at AUDIT_RETENTION_DAYS (90) and admin- events at AUDIT_ADMIN_RETENTION_DAYS (365)
```

---

## 3. Earlier items that are still open (unchanged, accepted)

| Earlier ID | What | Why it stays | Status |
| --- | --- | --- | --- |
| RB-02 | Private demo copies run as the same OS user and are not sandboxed from each other | Needs containers or per-copy OS users; documented in `demo-gateway/README.md` | Open, documented |
| RA-04 | Hosted CRM demo runs with admin 2-step off and stand-ins for mail and rate limiting | By design for a demo with sample data; the image refuses to start with an empty secret | Open, by design |
| SEC-16 (part) | Base images are not pinned by digest | Folded into S-06 | Open |
| SEC-12 (part) | Distributed guessing is slowed, not capped | Folded into S-04 | Open |
| Shared demos | CRM, ClaudeWorkspace and RemoteManagementSystem share one database between customers | The notice page and automatic reset are the mitigation (SEC-03) | Open, by design |

---

## 4. Checked and found sound

- **Injection:** every SQL statement in both stores is a prepared statement or uses `$n` parameters; the one interpolated name (`DATABASE_SCHEMA`) is validated against `/^[a-z_][a-z0-9_]{0,62}$/i` (`postgres.mjs`) and has a test. No `eval`, `new Function`, `innerHTML` or `document.write` in `admin-console/*.html` (DOM built with `createElement` and `textContent`); no user input reaches a shell: container names, product ids, process names, slot numbers and PIDs are validated or numeric (`lib/docker.mjs`, `lib/registry.mjs`, `lib/instance-app.mjs`, `lib/process-driver.mjs`). Commands in `registry/apps.json` are trusted configuration.
- **Path handling:** the showcase server resolves and prefix-checks paths and rejects bad encodings; the reset and snapshot tools resolve links before acting and refuse other drives (`reset-fs.mjs`); `safeDir` keeps instance folders inside `data/instances/`.
- **Authentication:** scrypt N=2^17 with bounded parameters on read, constant-time comparisons, TOTP with replay protection held under a lock, secret sealed with AES-256-GCM, sessions stored as hashes, `HttpOnly; SameSite=Strict`, `__Host-` names over HTTPS, all sessions cleared when the password or 2-step setting changes, same error text whether or not 2-step is on.
- **Customer access:** link tokens are 192-bit random and stored only as SHA-256; a GET never spends a use; the session cookie is a different random value from the link; the grant is re-read on every request and every few seconds on open sockets; the upstream port comes from the customer's own seat; WebSocket `Origin` must match the host; spoofable client-address headers are not forwarded.
- **Transport and headers:** certificate validation on by default (`apply-sql.mjs`); the console refuses to listen beyond loopback without a password, and without HTTPS unless `ADMIN_ALLOW_HTTP=1`; Host allow-list and same-origin check on every state-changing route; nonce-based script policy; `frame-ancestors 'none'`, `nosniff`, `no-store`, `no-referrer`; Caddy issues certificates on demand only for real product names (`tls-ask`).
- **Secrets and repository:** the pattern search over tracked files found only documentation examples and CI test values (`testpw` for the throwaway CI database); the git history contains no env files other than `deploy/.env.example` (blank values); `data/` and `.env*` are git-ignored and excluded from the Docker context; apps receive an allow-listed environment.
- **Dependencies:** `npm audit` reports 0 vulnerabilities; the lockfile is committed; CI uses `npm ci`, a read-only token and SHA-pinned actions; Dependabot covers npm, Actions and Docker.
- **Tests:** 189 of 190 pass (1 skipped), including tests for the earlier security fixes.

## 5. Not verifiable here

- The hosted stack under Docker (S-01, S-06, S-11): `docker compose` was not run.
- Pinned GitHub Action SHAs and base image versions against their upstream registries (S-12, S-06).
- Whether `supervisor/demo-fixes/__pycache__/…pyc` matches its source (S-09).
- Whether the running CRM demo uses `PLATFORM_DATABASE_URL` (S-11).
- The demo apps' own code and their installed dependencies (`npm audit` inside `data/demo-src/*`, `pip` requirements of the original Flask apps).
- Browser-level behaviour of the pages (no end-to-end run was done for this report).
- The WebSocket counter leak (S-05) is established by reading the code; a failing test first would turn it into a confirmed defect.

## 6. Suggested order

1. **S-01** (separate networks) and **S-03** (require the 2-step code and `ADMIN_DATA_KEY` in the hosted setup): the two that change the hosted risk most.
2. **S-02** and **S-05**: small code changes, each with an obvious test.
3. **S-07**, **S-08**, **S-09**, **S-10**: a few lines each.
4. **S-04**, **S-06**, **S-11** to **S-14** as time allows.
