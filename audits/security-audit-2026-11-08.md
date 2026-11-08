# Security Audit: ProjectsDashboard

Date: 2026-11-08 · Commit reviewed: `94da7d7` (working tree clean) · Scope: all tracked code (`admin-console/`, `demo-gateway/`, `lib/`, `lib/store/`, `supervisor/`, `showcase/`, `deploy/`, `.github/`, `registry/apps.json`, `package*.json`). The demo apps themselves (`data/demo-src/*`, and the original apps on the Desktop) are **out of scope** except where this repo configures how they run.

Method: full read of the code above, `npm audit`, a search of tracked files and git history for secrets, and live checks from earlier in this session (showcase crash, login behaviour). Nothing here was exploited against a running deployment. Where a claim depends on code outside this repo I mark it **Unable to verify** and say what would settle it.

Importance scale: 1–10, 10 = critical. **No finding scores above 6.** There is nothing I would call critical or an immediate breach path.

---

## Remediation status (2026-11-08)

Fixed in the working tree: **SEC-01** (apps get a minimal environment; `PD_APP_ENV_PASSTHROUGH=NAME,NAME` lets an app opt in to extra variables), **SEC-04** (certificate validation on; `DEMO_DB_CA` for a provider CA, `DEMO_DB_INSECURE_TLS=1` as an explicit opt-out), **SEC-05** (audit pruning now also runs daily), **SEC-06** (WebSocket `Origin` must match the host), **SEC-09** (app start/stop/restart and sign-out are audited and labelled in the Activity view). **SEC-07** (device lock uses a random `pd_dev` cookie instead of the User-Agent; links with a use limit are spent by a button click (POST), not by a GET; the console form defaults to 5 opens) and **SEC-08** (the console's script policy is a per-response nonce; no inline handlers). **SEC-02, partly** (the gateway now answers Next.js dev-only helper routes `/__nextjs_*`, which return source excerpts and open an editor, with a 404 instead of forwarding them; running `next build && next start` for the CRM and ClaudeWorkspace demos is still open because it needs app-side stub keys in the clones) and **SEC-03, partly** (every link now opens on a shared-demo notice, "do not enter real personal, customer or confidential information", that the customer must accept with a button; resetting an instance to its seed and limited-role demo accounts are still open). **SEC-10** (scrypt now runs asynchronously, at most two at a time, at N=2^17; older hashes still verify and are upgraded at the next sign-in) and **SEC-11** (with `ADMIN_DATA_KEY` set, the TOTP secret is stored AES-256-GCM encrypted, existing plain secrets are encrypted at console start, `gen-key` makes a key, and the setup file is deleted once setup is confirmed; without a key it falls back to plain with a warning). **SEC-12** (once the overall failure cap is passed, each wrong guess is answered after an extra 1.5 s, `loginPenaltyMs`; a correct password still signs in at once) and **SEC-13** (`Forwarded`, `X-Real-IP`, `True-Client-IP`, `CF-Connecting-IP`, `X-Client-IP` and similar are no longer passed to demo apps, over HTTP or WebSocket). **SEC-14** (the console refuses plain HTTP on a non-loopback address unless `ADMIN_ALLOW_HTTP=1`, which only `docker-compose.local.yml` sets) and **SEC-15** (CI token is read-only, `npm audit --omit=dev --audit-level=high` runs in both jobs, actions are pinned to commit SHAs, and `.github/dependabot.yml` updates npm, Actions and Docker weekly). **SEC-16, partly** (gateway and console containers: no-new-privileges, all capabilities dropped, read-only root filesystem with `/tmp` and a `/data` volume, 256 processes and 512 MB; Caddy keeps only `NET_BIND_SERVICE`; Postgres gets no-new-privileges. Not done: pinning base images by digest. Not run here: Docker was not available, so the compose changes are untested) and **SEC-17** (a process name may only contain letters, digits, `_` and `-`). **SEC-18** (over HTTPS the console and gateway cookies are `__Host-pd_session`, `__Host-pd_demo` and `__Host-pd_dev`; a demo app's `Set-Cookie` loses any `Domain=` and cannot set or clear the gateway's cookies) and **SEC-19** (the Supabase key file is written with owner-only permissions where the system supports it; revoking the `sbp_` management token after setup remains a manual step, and Windows file permissions are not changed). Tests added for 01, 02, 03, 06, 07, 08 and 09; the five demo journeys pass with the new environment. All other findings are open.

## 1. Summary

The core design is sound and noticeably more careful than typical for a project this size:

- **Parameterised SQL everywhere.** Both stores use prepared statements or `$n` parameters (`lib/store/sqlite.mjs`, `lib/store/postgres.mjs`). The one interpolated identifier, `DATABASE_SCHEMA`, is validated against `/^[a-z_][a-z0-9_]{0,62}$/i` (`postgres.mjs`, `openPostgres`).
- **Hashed secrets at rest.** Demo link tokens are 192-bit random and stored only as SHA-256 hashes. The link token is separate from the browser's session cookie (64 hex, also stored hashed), so a link cannot double as a cookie. Admin sessions are stored hashed too.
- **Admin sign-in.** scrypt password hashes (`lib/auth.mjs`), constant-time comparisons (`safeEq`, `timingSafeEqual`), TOTP with replay protection serialised under a lock, and per-IP plus overall rate limits stored in the database.
- **Cookies.** The admin cookie is `HttpOnly; SameSite=Strict`, with `Secure` when https is configured. The customer cookie is `HttpOnly; SameSite=Lax`, and it is stripped before the request reaches the demo app.
- **Console hardening.** A Host allow-list against DNS rebinding, a same-origin check on every state-changing POST, a refusal to listen beyond loopback without a password, and the audit view renders untrusted text as text.
- **Immediate revocation.** The gateway re-reads the grant on every request and re-checks open WebSockets every few seconds. Product binding (`g.app !== slug`) is enforced on every request.
- **Safe supervisor design.** Container names are validated and passed as arguments, never to a shell (`lib/docker.mjs`). The supervisor only kills PIDs it recorded, verified by start time.
- **Clean dependencies and repo.** `npm audit` reports 0 vulnerabilities, the lockfile is committed and CI uses `npm ci`. No secrets are in tracked files or in git history. A search for `sbp_`/JWT/`sk_`/private-key/URL-with-password patterns turned up only code comments and CI test values. `data/` and all `.env*` files are git-ignored and excluded from the Docker context.

The gaps are mostly **least privilege and defence in depth**: what the managed demo apps inherit and how they run, WebSocket origin handling, a few unbounded or never-run retention paths, and soft defaults.

| ID | Finding | Category | Importance |
|---|---|---|---|
| SEC-01 | Managed apps inherit the supervisor's entire environment | Secrets / Config | **6** |
| SEC-02 | Customer-facing demo instances run framework *dev servers* | Config & Hardening | **5** |
| SEC-03 | All customers share one demo instance and one set of seeded credentials | Data flow / cross-tenant | **5** |
| SEC-04 | `apply-sql.mjs` connects with TLS certificate validation disabled | Crypto & Transport | **5** |
| SEC-05 | Audit-log retention only runs at gateway start-up | Data flow & Privacy | **4** |
| SEC-06 | WebSocket upgrade does not validate `Origin`, and rewrites it | AuthZ / CSRF | **4** |
| SEC-07 | Demo links are unlimited-use by default; "device lock" is only a User-Agent hash | Authentication | **4** |
| SEC-08 | Admin console CSP allows inline scripts | Config & Hardening | **4** |
| SEC-09 | Admin actions (start/stop/restart) are not audited | Security logging | **3** |
| SEC-10 | scrypt is synchronous and below current cost guidance | Cryptography | **3** |
| SEC-11 | TOTP secret stored in plaintext; setup file left on disk | Secrets | **3** |
| SEC-12 | Distributed guessing is not capped (design trade-off) | Authentication | **3** |
| SEC-13 | Spoofable client-IP headers are forwarded to demo apps | Input / Config | **3** |
| SEC-14 | Console can be configured for plain HTTP on a non-loopback address | Transport | **3** |
| SEC-15 | CI has no token permissions, no dependency automation, actions unpinned | Supply chain | **3** |
| SEC-16 | Containers lack hardening options; base images use floating tags | Config & Hardening | **3** |
| SEC-17 | Registry-derived strings reach a shell command; process names unvalidated | Injection | **2** |
| SEC-18 | Cookie names lack prefixes; upstream `Set-Cookie` passed through unchanged | Sessions | **2** |
| SEC-19 | Supabase tooling stores tokens and keys in plain env files | Secrets | **2** |

---

## 2. Findings

### SEC-01: Managed apps inherit the supervisor's entire environment · 6/10
**Category:** Secrets & Sensitive Data / Configuration
**Location:** `supervisor/index.mjs:89` (`const env = cleanEnv({ ...process.env });`), `admin-console/console.mjs:34` (`defaultSupervisor` passes `env: process.env`).

**Description:** every host process the supervisor starts (including customer-facing demo instances) receives a copy of the supervisor's whole environment. `cleanEnv` (`lib/clean-env.mjs`) only removes virtual-environment variables. The comment at the top of `supervisor/index.mjs` says app env vars are "set on the child process only", which is true for the additions but not for what is inherited.

**Risk:** the console runs the supervisor, so the supervisor's environment is the console's environment. In hosted mode that includes `DATABASE_URL` for the dashboard's Postgres (admin password hash, TOTP secret, session hashes, grants, audit log), `METRICS_TOKEN`, and anything else the shell holds. In local mode it is whatever the owner's shell has: cloud keys, API keys, tokens. A bug or malicious dependency in any demo app (code that customers interact with) can read all of it. In the hosted compose file the demo apps run in separate containers, so this applies to **host-process mode**, which is how the local setup works today.

**Remediation:** pass an allow-list, then add the registry's variables.
```js
// supervisor/index.mjs, replace line 89
const KEEP = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES.*|PROGRAMDATA|NUMBER_OF_PROCESSORS|PROCESSOR_.*|OS|LANG|LC_.*|TZ)$/i;
const env = cleanEnv(Object.fromEntries(Object.entries(process.env).filter(([k]) => KEEP.test(k))));
```
Then run the five demo journeys (`npm run test:e2e`) to find any variable a toolchain genuinely needs (for example `NVM_*`, `CONDA_*`, `PNPM_HOME`) and add only those.

---

### SEC-02: Customer-facing demo instances run framework dev servers · 5/10
**Category:** Configuration & Hardening (debug mode)
**Location:** `registry/apps.json`: the demo instances `crm-demo` (`"cmd": "npx next dev --turbopack -p {port}"`, line ~220) and `claudeworkspace-demo` (`next.cmd dev -p {port} --turbo`, lines ~243 and ~252); `deploy/docker-compose.yml` services `crm-demo` (`npx next dev` via `deploy/apps/crm/Dockerfile`) and `claudeworkspace-admin` (`pnpm exec next dev ... --turbo`).

**Description:** the gateway puts these dev servers on the internet behind customer links. The deploy files document why (production mode refuses to boot without real email/Redis/MFA keys). The cost is the dev server's surface: verbose error overlays with source code and stack traces, development-only endpoints and the HMR WebSocket, no production optimisations, and a history of dev-server-specific advisories.

**Risk:** information disclosure (source paths, code, stack traces) to any customer, and a larger attack surface than a production build. The impact is bounded because the instances hold demo data and no real service keys. **Unable to verify** which Next.js version is installed in `data/demo-src/crm` and `data/demo-src/claudeworkspace`; `npm audit` run in those folders would show whether any dev-server advisory applies.

**Remediation:**
1. Preferred: give the demo builds the minimal dummy values production mode wants (a stub email provider, `CRON_SECRET`, an MFA key, an in-memory rate-limiter) and run `next build && next start`.
2. Otherwise, at least keep the gateway as the only way in (already the case) and add response headers at the gateway so error pages are not framed or cached. The gateway already sets `X-Frame-Options`.
3. Pin and update Next.js in the demo clones, and run `npm audit` there regularly.

---

### SEC-03: All customers share one demo instance and one set of credentials · 5/10
**Category:** Data Flow & Privacy (cross-tenant exposure)
**Location:** `demo-gateway/gateway.mjs` `upstreamPort()` and `demoApps()` in `demo-gateway/grants.mjs`: one process per product, selected by product slug only. `data/crm-demo.env` / `deploy/.env.example` (`CRM_DEMO_PASSWORD`, `SEED_USER_PASSWORD`).

**Description:** the isolation model is "demo data is separate from production", which it is. It is not "customer A is separate from customer B". Every customer for a product reaches the same instance, the same database, and the same seeded sign-in (`admin@crm.test` and so on, with one shared password).

**Risk:** a customer who is told the demo password can read or alter what the previous customer typed in (names, emails, uploaded images, notes). A customer can also change the demo admin's password or delete seeded data, breaking the demo for everyone (this is probably what happened to `admin@crm.test`: its password was changed after seeding). **Unable to verify** whether ImageApp serves uploads at guessable or listable URLs; a request log or a look at the app's upload route would settle it.

**Remediation:** pick one:
- Reset each demo instance to its seed on a schedule or when a link is revoked or expires (`WIPE_FORCE`-style seed already exists for the CRM).
- Tell customers (in the link email) not to enter real personal data, and make that visible in the demo banner.
- For sensitive products, one instance per grant.
Also create demo accounts with limited roles where the product allows, rather than handing out an admin.

---

### SEC-04: `apply-sql.mjs` disables TLS certificate validation · 5/10
**Category:** Cryptography & Transport
**Location:** `supervisor/apply-sql.mjs:29`
```js
const client = new Client({ connectionString: env.DEMO_DB_URL, ssl: { rejectUnauthorized: false } });
```
**Description:** the connection encrypts but accepts any certificate, so a network attacker between the machine and the Supabase demo database can impersonate it. The credentials in `DEMO_DB_URL` and the SQL being applied cross that connection.

**Risk:** credential theft or tampered migrations on a hostile network (public Wi-Fi, a compromised router). The target is a demo database, which limits the damage.

**Remediation:** validate against the provider's CA.
```js
import { readFileSync } from 'node:fs';
// download the project's CA from the Supabase dashboard (Database settings -> SSL), keep it in data/
const ca = env.DEMO_DB_CA ? readFileSync(env.DEMO_DB_CA, 'utf8') : undefined;
const client = new Client({ connectionString: env.DEMO_DB_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true } });
```
If the pooler's certificate chain is not in the system store, the `ca` file fixes that. `supabase-admin.mjs` uses `fetch` over HTTPS, which validates normally.

---

### SEC-05: Audit-log retention only runs at gateway start-up · 4/10
**Category:** Data Flow & Privacy
**Location:** `demo-gateway/server.mjs:13` (`gw.store.audit.prune(...)` is called once, before `listen`).

**Description:** the retention setting `AUDIT_RETENTION_DAYS` (default 90) is applied only when the gateway process starts. In the hosted setup (`restart: unless-stopped`, long uptime) the pruning may not happen for months. The audit table stores IP addresses, User-Agents and customer names (`audit` rows from `gateway.mjs` and `grants.mjs`), which is personal data.

**Risk:** retention longer than stated; the audit table grows without bound.

**Remediation:**
```js
// demo-gateway/server.mjs, after the first prune
const pruneAudit = () => gw.store.audit.prune(Number.isFinite(RETENTION_DAYS) ? RETENTION_DAYS : 90)
  .then((n) => { if (n) logger.info('pruned old audit events', { count: n }); })
  .catch((err) => logger.warn('audit prune failed', { err }));
setInterval(pruneAudit, 24 * 3600e3).unref();
```
Also document the retention period for customers if you collect their data, and consider truncating the IP (for example the last octet) before storing.

---

### SEC-06: WebSocket upgrade does not validate `Origin`, and rewrites it · 4/10
**Category:** Authorization / CSRF
**Location:** `demo-gateway/gateway.mjs` `upgrade()`, the header copy loop (`lk === 'origin'` skipped, ~line 275) and `if (req.headers.origin) lines.push(\`Origin: http://${upHost}:${port}\`)` (~line 281).

**Description:** the gateway rewrites the browser's `Origin` to the upstream's own address so servers such as Streamlit accept the socket. As a result the upstream's own cross-site-WebSocket protection is neutralised, and the gateway does not do the check itself. The customer cookie is `SameSite=Lax`, which blocks cross-site WebSocket requests from unrelated sites, but **sibling subdomains are same-site**: a page on any other `*.DEMO_DOMAIN` host (another product's demo) can open a WebSocket to `crm.DEMO_DOMAIN` with the victim's cookie.

**Risk:** needs a victim with a live grant and script running on a sibling demo host (an XSS or hostile content in a demo app). Low likelihood, moderate impact on that session.

**Remediation:** check the browser's Origin against the request's own host before forwarding.
```js
// in upgrade(), after the grant checks and before opening the upstream
const origin = req.headers.origin;
if (origin) {
  let sameHost = false;
  try { sameHost = new URL(origin).host === hostHdr; } catch { /* malformed */ }
  if (!sameHost) return rejectUpgrade(socket, 403, 'Forbidden');
}
```
(`hostHdr` is already lower-cased in `resolveRequest`.) Add a gateway test that a WebSocket with a foreign Origin gets 403.

---

### SEC-07: Links are unlimited-use by default; "device lock" is only a User-Agent hash · 4/10
**Category:** Authentication
**Location:** `demo-gateway/grants.mjs` `createGrant` (`maxUses = null`, `hours = 48`); `demo-gateway/gateway.mjs:155` (`store.grants.redeem(g.id, sha256(ua))`); `lib/store/sqlite.mjs` / `postgres.mjs` `redeem` (device compare).

**Description:**
- By default a link can be opened any number of times until it expires (48 hours by default, up to 720). Anyone who gets the URL can use it: forwarded email, a shared chat, a link-preview or mail-scanner bot (the redeem is a plain `GET`).
- "Lock to first browser" compares a hash of the **User-Agent string**. Every user of the same browser build has the same value, so it stops casual sharing only between different browsers or devices; it is not a device binding.

**Risk:** a forwarded link keeps working; the documented promise ("tied to the browser it was first opened in") is stronger than what is enforced.

**Remediation:**
- Default `maxUses` to a small number in the UI form (for example 5) and keep "unlimited" as an explicit choice.
- Make the lock real: on first redeem set a long-lived random `pd_dev` cookie, store its hash as `device_hash`, and compare that on later redeems instead of the UA hash. (The cookie is HttpOnly and per-subdomain.)
- Optionally require a click-through page for redeem (a `POST`), so link scanners that only `GET` do not consume a use.

---

### SEC-08: Admin console CSP allows inline scripts · 4/10
**Category:** Configuration & Hardening
**Location:** `admin-console/console.mjs:81` (`script-src 'unsafe-inline'`), `admin-console/index.html` and `login.html` (inline `<script>` blocks and an inline `onclick="logdlg.close()"`).

**Description:** the page writes all untrusted text with `textContent`/`el()` (verified, including the audit view), so I found no current XSS. But the CSP does not backstop a future mistake, and the console is the single most valuable target (start/stop apps, mint customer links).

**Remediation:** use a per-response nonce and drop the inline handler.
```js
// console.mjs
const nonce = randomBytes(16).toString('base64');
const csp = securityHeaders['content-security-policy'].replace("script-src 'unsafe-inline'", `script-src 'nonce-${nonce}'`);
const page = readFileSync(join(here, 'index.html'), 'utf8').replace('<script>', `<script nonce="${nonce}">`);
res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...securityHeaders, 'content-security-policy': csp });
```
and in `index.html` replace `onclick="logdlg.close()"` with an `addEventListener` in the script. Do the same for `login.html`. Leave `style-src 'unsafe-inline'` for now; it is much lower risk.

---

### SEC-09: Admin actions are not audited · 3/10
**Category:** Security logging / audit trail
**Location:** `admin-console/console.mjs`, the `POST /api/apps/:id/(start|stop|restart)` route; `/logout`.

**Description:** sign-ins, failed sign-ins, grant creation and revocation, and CLI password/2FA changes are all audited. Starting, stopping or restarting a product, and sign-out, are not, although they change what customers can reach.

**Remediation:**
```js
// after the busy.add(app.id) line in the start/stop/restart route
audit({ ev: 'admin-app-' + m[2], app: app.id, ip: clientIp(req, trusted), ...(only ? { proc: only } : {}) });
```
and add `'admin-app-start'` etc. to the UI's `EVENT_LABELS` (`index.html`). The `admin-` prefix already routes them into the "Console sign-ins and changes" filter.

---

### SEC-10: scrypt is synchronous and below current cost guidance · 3/10
**Category:** Cryptography
**Location:** `lib/auth.mjs:7` (`const SCRYPT = { N: 16384, r: 8, p: 1 }`), `hashPassword` / `verifyPassword` (`scryptSync`).

**Description:** scrypt with N=2^14 is the minimum commonly cited; current OWASP guidance is N=2^17 (r=8, p=1). `scryptSync` also blocks the single event loop for the duration of each attempt, so up to 8 attempts per IP from many addresses can stall the console.

**Remediation:** hash and verify asynchronously and raise the cost for new hashes. Stored hashes already record their parameters, so old ones keep verifying.
```js
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
```
`verifyPassword` becomes async the same way (pass `maxmem` too); update its three callers (`console.mjs` login, `auth-cli.mjs` indirectly via `hashPassword`, tests). Memory use is about 128 MB per attempt at N=2^17, so keep the per-IP limit.

---

### SEC-11: TOTP secret in plaintext; setup file left on disk · 3/10
**Category:** Secrets
**Location:** `admin-console/auth-cli.mjs:80` (`writeFileSync(file, describe(pending) + '\n')`, never deleted), `store.meta` keys `admin_totp_secret` / `admin_totp_pending`.

**Description:** `lib/auth.mjs` documents that the TOTP secret must be recoverable, so it lives in the database as plain text. Anyone who can read `data/dashboard.db` (a backup, a copied folder, a database dump) gets both factors' material except the password. The `--start --to-file` flow writes the secret to a file and relies on the user to delete it (the `set-password --from-file` flow deletes its file; this one does not). The pending secret stays in `meta` if setup is abandoned.

**Remediation:** encrypt the secret with a key held outside the database.
```js
// lib/auth.mjs
import { createCipheriv, createDecipheriv } from 'node:crypto';
const key = () => Buffer.from(process.env.ADMIN_DATA_KEY || '', 'hex'); // 32 bytes, generated once
export const seal = (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv); const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]); return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.'); };
```
(with a matching `open()`); use it for `admin_totp_secret` and `admin_totp_pending`. Fall back to plain if the key is unset, with a warning. For the file flow, have step 2 (`--code`) delete the file if its path was recorded, or print a reminder.

---

### SEC-12: Distributed guessing is not capped · 3/10
**Category:** Authentication
**Location:** `admin-console/console.mjs`, `login()`: `loginMaxPerIp: 8`, `loginMaxTotal: 40`.

**Description:** this is a deliberate trade-off, documented in the code and tested: after 40 failures overall, wrong guesses get 429 but a correct password still signs in, so a botnet cannot lock the owner out. The side effect is that an attacker spreading guesses over many IPs is limited only by 8 per IP per 15 minutes. With a 12+ character password and scrypt this is not practical for the password. For the 6-digit code (about 1,000,000 possibilities, 3 accepted per window) it matters only if the attacker already has the password.

**Remediation (optional):** keep the owner-lockout protection, but also slow the attacker: add a growing delay for failed attempts when `overall` is true.
```js
if (overall) await new Promise((r) => setTimeout(r, 1500)); // before the 429/401 response
```
and require the TOTP step to be verified before the password result is revealed (the code already runs both checks, which avoids a timing oracle). Put the console behind Caddy's `rate_limit` or an IP allow-list if the admin hostname is stable.

---

### SEC-13: Spoofable client-IP headers are forwarded to demo apps · 3/10
**Category:** Input handling / Configuration
**Location:** `demo-gateway/gateway.mjs`, the request-header copy in `handle()` (everything except hop-by-hop, `cookie`, `host`, `x-forwarded-*`) and in `upgrade()` (raw header copy).

**Description:** the gateway correctly drops client-supplied `X-Forwarded-*` and sets its own. Other headers that some frameworks treat as the client address (`Forwarded`, `X-Real-IP`, `True-Client-IP`, `CF-Connecting-IP`, `X-Client-IP`) pass through, so a customer can present a false address to the demo app's own logging or rate limiting.

**Remediation:**
```js
const SPOOFABLE = new Set(['forwarded', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'x-client-ip']);
// handle(): add `&& !SPOOFABLE.has(k)` to the header filter
// upgrade(): add `|| SPOOFABLE.has(lk)` to the `continue` condition
```

---

### SEC-14: Console can run plain HTTP on a non-loopback address · 3/10
**Category:** Transport
**Location:** `admin-console/console.mjs:56` (`scheme: ADMIN_SCHEME || 'http'`) and the start-up guard at line 75.

**Description:** the guard refuses a non-loopback bind without a password, but not without HTTPS. With `ADMIN_BIND=0.0.0.0`, a password set and `ADMIN_SCHEME` left at `http`, the password and the session cookie (no `Secure` flag) travel in clear text. The local compose override does exactly this on purpose, for a test on one machine.

**Remediation:** refuse unless the operator opts in.
```js
if (!LOOPBACK.has(o.bindHost) && o.scheme !== 'https' && process.env.ADMIN_ALLOW_HTTP !== '1') {
  throw new Error('Refusing to serve the console over plain HTTP on a non-loopback address. Put it behind HTTPS (ADMIN_SCHEME=https), or set ADMIN_ALLOW_HTTP=1 for a local test.');
}
```
and set `ADMIN_ALLOW_HTTP: "1"` in `deploy/docker-compose.local.yml` only.

---

### SEC-15: CI has no token permissions, no dependency automation, actions unpinned · 3/10
**Category:** Dependencies & Supply chain
**Location:** `.github/workflows/ci.yml`; no `.github/dependabot.yml`.

**Description:** the workflow has no `permissions:` block, so the `GITHUB_TOKEN` gets the repository default (which can be read/write). Actions are pinned by tag (`actions/checkout@v4`), not commit. There is no scheduled dependency update and no `npm audit` step. The project has only one runtime dependency (`pg`) and `npm audit` is clean today, so the exposure is small.

**Remediation:**
```yaml
# .github/workflows/ci.yml, top level
permissions:
  contents: read
# add to both jobs after `npm ci`
      - run: npm audit --omit=dev --audit-level=high
```
```yaml
# .github/dependabot.yml
version: 2
updates:
  - { package-ecosystem: npm, directory: "/", schedule: { interval: weekly } }
  - { package-ecosystem: github-actions, directory: "/", schedule: { interval: weekly } }
  - { package-ecosystem: docker, directory: "/deploy", schedule: { interval: weekly } }
```
Pin the actions to commit SHAs (Dependabot will keep them current).

---

### SEC-16: Containers lack hardening options; base images use floating tags · 3/10
**Category:** Configuration & Hardening
**Location:** `deploy/docker-compose.yml` (`gateway`, `console`, `caddy`, `postgres`), `deploy/Dockerfile` (`FROM node:24-slim`), `deploy/Caddy.Dockerfile` (`caddy:2-alpine`), `postgres:17-alpine`.

**Description:** good already: the dashboard image runs as the non-root `node` user, Postgres is not published, only Caddy exposes 80/443, and no Docker socket is mounted. Missing: `no-new-privileges`, dropped capabilities, read-only root filesystems and resource limits; images are tag-pinned but not digest-pinned.

**Remediation (gateway and console):**
```yaml
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    read_only: true
    tmpfs: [/tmp]
    pids_limit: 256
    mem_limit: 512m
```
(`/data` for logs stays a volume. If the SQLite store is used inside the container it also needs the volume writable.) Pin images by digest in the Dockerfiles once a version is chosen, and let Dependabot refresh them.

---

### SEC-17: Registry-derived strings reach a shell command; process names unvalidated · 2/10
**Category:** Injection
**Location:** `lib/process-driver.mjs` `windowsDriver.spawnApp` / `posixDriver.spawnApp` (`${cmd} >> "${logPath}" 2>&1`, run through a shell); `lib/registry.mjs` `validate()` (checks `p.name` is present, not its characters); `supervisor/run-with-env.mjs` (`cmd.join(' ')` with `shell: true`).

**Description:** `cmd` comes from `registry/apps.json` and is meant to be a shell command, so that is trusted by design. `logPath` includes `proc.name`, which is only checked to be non-empty, so a process name containing `"` or `&` would break out of the quoting. The registry is owner-controlled, so this is hardening rather than an exploitable path.

**Remediation:**
```js
// lib/registry.mjs, in validate()
if (p.name && !/^[\w-]+$/.test(p.name)) errs.push(`${pw}: process name may only contain letters, digits, _ and -`);
```

---

### SEC-18: Cookie names lack prefixes; upstream `Set-Cookie` passed through unchanged · 2/10
**Category:** Sessions
**Location:** `demo-gateway/gateway.mjs` (`COOKIE = 'pd_demo'`, response header copy loop), `admin-console/console.mjs` (`COOKIE = 'pd_session'`).

**Description:** over HTTPS, the `__Host-` prefix makes browsers reject a cookie that was set insecurely or with a `Domain`. A demo app can also send `Set-Cookie: x=1; Domain=.demo.example.com`, which would apply to every product's demo host. These are trusted demo apps, so this is low.

**Remediation:** use `__Host-pd_session` / `__Host-pd_demo` when `Secure` (https), and optionally strip `Domain=` from upstream cookies:
```js
if (out['set-cookie']) out['set-cookie'] = [].concat(out['set-cookie']).map((c) => c.replace(/;\s*domain=[^;]*/i, ''));
```

---

### SEC-19: Supabase tooling stores tokens and keys in plain env files · 2/10
**Category:** Secrets
**Location:** `supervisor/supabase-admin.mjs` (`fetch-keys` writes `SUPABASE_SERVICE_ROLE_KEY` with `writeFileSync`), `supervisor/set-env-values.ps1`; `data/*.env` (git-ignored).

**Description:** the keys are for the separate demo Supabase project, the files are git-ignored and excluded from Docker contexts, and the tooling never prints values. The residual risks are plain-text storage on the owner's machine and a `sbp_` management token that should be revoked after setup (the script header already says so). On POSIX the write uses default permissions.

**Remediation:** `writeFileSync(envFile, ..., { mode: 0o600 })`, and revoke the management token when setup finishes.

---

## 3. Coverage by requested category

| Category | Result |
|---|---|
| **Authentication & Authorization** | Strong core (SEC-07, 10, 12 are refinements). No hard-coded credentials in tracked files. Product binding and revocation are enforced per request. Gateway `/_pd/metrics` is token-protected or loopback-only; `/_pd/tls-ask` answers only direct calls. |
| **Input Validation & Injection** | No SQL injection found (parameterised throughout). No command injection from request data: the only shell use takes owner-controlled registry values (SEC-17). Path traversal is blocked in `showcase/serve.mjs` (`startsWith(dist + sep)` after `normalize`) and in the console's log route (`proc` must match the registry). The showcase malformed-URL crash was fixed earlier in this session. Request bodies are size-limited (4 KB console, 50 MB proxied, header size 16 KB). |
| **Secrets & Sensitive Data** | No secrets in tracked files or git history. Logs never include secrets; I also masked link tokens in the new 500-error log line. See SEC-01, 11, 19. |
| **Cryptography & Transport** | CSPRNG (`randomBytes`) for tokens, sessions and TOTP secrets; no custom crypto. HTTPS via Caddy with on-demand certificates restricted by the `ask` endpoint. SEC-04 (disabled cert validation), SEC-10, SEC-14. Postgres inside the compose network is plain TCP by design; **Unable to verify** TLS for any external `DATABASE_URL` (the docs say to add `sslmode=require`). |
| **Dependencies & Supply chain** | `npm audit`: 0 vulnerabilities. One runtime dependency (`pg ^8.13.1`), lockfile committed, `npm ci` in CI and Docker. SEC-15, 16. The demo clones' own dependencies are outside this repo (SEC-02). |
| **Configuration & Hardening** | Security headers set on console, gateway pages and showcase; HSTS when https; frame protection on proxied pages. SEC-02, 08, 13, 16. |
| **Data Flow & Privacy** | Audit log holds IPs, User-Agents and customer names (SEC-05); admin actions incomplete (SEC-09); shared demo data between customers (SEC-03). Metrics carry no per-customer labels. |

## 4. Unable to verify

| Item | What would confirm it |
|---|---|
| Whether ImageApp uploads are reachable by other customers | Upload a file as customer A and request its URL (or the app's list route) as customer B. |
| Installed Next.js versions in `data/demo-src/crm` and `claudeworkspace` | `npm ls next` and `npm audit` in those folders. |
| Whether Airfinder's `run.py` binds to all interfaces (registry line ~274) | The app's `run.py` host argument, or `netstat -ano | findstr :5210` while it runs (look for `0.0.0.0`). The registry itself notes RMM's `start_api.py` binds `0.0.0.0`. |
| Caddy access logging (link tokens appear in `/d/<token>` paths) | `deploy/Caddyfile` has no `log` directive, so none is configured here; check the running container's config if one was added. |
| TLS on any external `DATABASE_URL` | The URL's `sslmode` parameter and the server's certificate. |

## 5. Suggested order of work

1. SEC-01 (environment allow-list), SEC-06 (WebSocket origin), SEC-04 (TLS validation): small, contained changes.
2. SEC-05 (retention timer), SEC-09 (audit start/stop), SEC-07 (link defaults and device cookie).
3. SEC-02 and SEC-03 are decisions about how demos run; they need your call rather than a quick patch.
4. SEC-08, SEC-10, SEC-11, SEC-14, SEC-15, SEC-16 as hardening passes.
5. SEC-12, 13, 17, 18, 19 when convenient.
