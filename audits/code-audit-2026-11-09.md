**Fixed** |**Fixed** |**Fixed** |**Fixed** |**Fixed** |**Fixed** |# Code audit (third pass): ProjectsDashboard

Date: 2026-11-09 · Commit audited: `33fc7c1` (`main`) · Scope: the code that runs in production or guards it, read in full: `demo-gateway/gateway.mjs`, `demo-gateway/grants.mjs`, `admin-console/console.mjs`, `admin-console/index.html`, `lib/auth.mjs`, `lib/http-util.mjs`, `lib/registry.mjs`, `lib/process-driver.mjs`, `lib/run-supervisor.mjs`, `lib/config.mjs`, `lib/clean-env.mjs`, `supervisor/index.mjs`, `supervisor/run-with-env.mjs`, `showcase/serve.mjs`, `showcase/build.mjs` (`esc`), `deploy/docker-compose.yml`, `deploy/Caddyfile`, `.github/workflows/ci.yml`, `start-customer-demo.bat`, `data/tools/rmm_demo_api.py`.

This builds on `security-audit-2026-11-08.md` (SEC-01 to SEC-19) and `security-reaudit-2026-11-08.md` (RA-01 to RA-05). Items already recorded there are not repeated; new ones are numbered N-01 onward.

Checks run in this pass: `npm audit --omit=dev` (0 vulnerabilities), `npm run lint` (1 error, see N-01), `npm test` (143 pass, 0 fail), a syntax check of the inline script in `admin-console/index.html` and `login.html` (passes after the fix in `33fc7c1`, failed before it, see N-02), and a search of tracked files for secrets (none; the demo credential in N-07 is not tracked). Nothing was run against a hosted deployment.

## Result

No high or medium security issue found. The gateway, console and auth code is careful and consistent: constant-time comparisons, hashed session and link tokens, per-request grant re-checks, an allow-listed child environment, `Origin` and `Host` checks, no `innerHTML` in the browser page. The two findings that matter most are about **delivery**, not attack surface: CI is currently red because of lint, and a script syntax error shipped unnoticed and left the console blank.

| ID | Finding | Importance | Status |
| --- | --- | --- | --- |
| N-01 | `npm run lint` fails on `tests/journeys.mjs:30`; CI runs lint | 4/10 | **Fixed** |
| N-02 | Nothing tests the console page's inline script; a syntax error shipped and blanked the console | 4/10 | **Fixed** (script in `33fc7c1`, test added) |
| N-03 | Hosted compose defaults app secrets and passwords to empty (`:-`) | 3/10 | **Fixed** (with a check script; see note) |
| N-04 | RMM demo needs Docker, which nothing started or checked | 3/10 | **Fixed** (launcher and supervisor) |
| N-05 | Sign-in error text reveals whether two-step codes are on | 2/10 | **Fixed** |
| N-06 | Gateway tunnels any `Upgrade` request as a raw socket, not only WebSocket | 2/10 | **Fixed** |
| N-07 | Unknown session cookies cost one database read per request, with no rate limit | 2/10 | **Fixed** |
| N-08 | RMM demo reset depends on files that are not tracked in git | 2/10 | **Fixed** |
| N-09 | A demo account password is printed into a reset log | 1/10 | **Fixed** |
| N-10 | Hosted `postgres` containers lack `cap_drop` | 1/10 | **Fixed** |

## Remediation status (2026-11-09)

All findings were fixed after this report was first written (N-04: the launcher first, then the supervisor itself through a registry `requiresDocker` flag, so the admin console starts Docker too). Two corrections to the report itself came out of the work:

- **N-03:** the `${VAR:?message}` form suggested below cannot be used on its own. Compose reads it for every service in the file, even those outside the profile, so it would also stop the plain `docker compose up -d`. The fix is `deploy/check-apps-env.sh`, which refuses empty values for the demos you name, plus a README and compose-header note.
- **N-08:** `data/tools/rmm_demo_api.py` is also untracked (`.gitignore` ignores `/data/*`; an earlier `git ls-files` reading suggested otherwise). Both RMM scripts now live in `supervisor/demo-fixes/` and the registry points there.

New tests: a non-WebSocket `Upgrade` is refused, the per-address limit on session-less requests (and that valid sessions are not counted), and the sign-in error wording with two-step off. Tests: 147 pass, lint clean. `cap_drop` on the Postgres services (N-10) is checked only by `docker compose config`; Docker was not running, so a fresh-volume start is untested.

## N-01: lint fails, so CI fails · 4/10

**Category:** Build and CI
**Location:** `tests/journeys.mjs:30`: `page.waitForFunction(() => !/^Preparing your demo/i.test(document.title), ...)`. `eslint.config.mjs:7` gives the project Node globals only; line 10 adds browser globals for `tests/ui-check.mjs` alone.

**Description:** `document` is used inside a callback that runs in the browser page, but ESLint only knows Node globals for this file, so `npm run lint` reports `'document' is not defined (no-undef)`. `.github/workflows/ci.yml` runs `npm run lint` in both the `windows` and `linux` jobs, so both fail. Reproduced: `npm run lint` prints `✖ 1 problem (1 error, 0 warnings)`. It came in with commit `3269f43`.

**Remediation:**

```js
// eslint.config.mjs  (line 10: add the second file)
{ files: ['tests/ui-check.mjs', 'tests/journeys.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
```

## N-02: the console page's script is never parsed by a test · 4/10

**Category:** Testing, availability
**Location:** `admin-console/index.html`, the `confirm(j.error + '…Reset anyway?')` call in `demoReset` (a real line break sat inside a single-quoted string, from commit `3b40a3f` until `33fc7c1`). `tests/unit/console.test.mjs` exercises the server, not the page.

**Description:** A syntax error in the one inline `<script>` stops the whole script, so the page never ran `load()` and every panel stayed on "Loading…" with no message. 143 tests passed throughout, because none loads the page's JavaScript. The same can happen to `login.html` (sign-in would silently do nothing).

**Remediation:** a unit test that extracts each inline script and compiles it without running it:

```js
// tests/unit/pages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

for (const f of ['admin-console/index.html', 'admin-console/login.html']) {
  test(`${f}: inline scripts are valid JavaScript`, () => {
    const html = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, 'expected an inline script');
    for (const s of scripts) assert.doesNotThrow(() => new Script(s, { filename: f }));
  });
}
```

## N-03: hosted secrets default to empty · 3/10

**Category:** Configuration, secrets
**Location:** `deploy/docker-compose.yml` (profile `apps`): `SECRET_KEY: ${AIRFINDER_SECRET_KEY:-}`, `JWT_SECRET: ${AIRFINDER_JWT_SECRET:-}`, `SUPER_ADMIN_PASSWORD: ${AIRFINDER_ADMIN_PASSWORD:-}`, `CRM_APP_PASSWORD: ${CRM_APP_PASSWORD:-}`, `POSTGRES_PASSWORD: ${CRM_DB_PASSWORD:-}`, `NEXTAUTH_SECRET: ${CRM_AUTH_SECRET:-}`, `SEED_USER_PASSWORD: ${CRM_DEMO_PASSWORD:-}`, `UPSTASH_REDIS_REST_TOKEN` / `REDIS_STUB_TOKEN: ${CRM_AUTH_SECRET:-}`. The core services already use the safe form (`${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in deploy/.env}`).

**Description:** If `deploy/.env` omits one of these, compose starts the container with an empty value instead of stopping. `RA-04` records that the CRM image refuses an empty `CRM_AUTH_SECRET`, but the other variables are not covered there. Whether the Airfinder app refuses an empty `SECRET_KEY`/`JWT_SECRET`/`SUPER_ADMIN_PASSWORD` is **Unable to verify**: its code is not in this repository. A file such as `Airfinder/app/config.py` showing a startup check on those values would prove it.

**Remediation:** use the required form, so a missing value stops `docker compose --profile apps up`:

```yaml
SECRET_KEY: ${AIRFINDER_SECRET_KEY:?set AIRFINDER_SECRET_KEY in deploy/.env}
JWT_SECRET: ${AIRFINDER_JWT_SECRET:?set AIRFINDER_JWT_SECRET in deploy/.env}
SUPER_ADMIN_PASSWORD: ${AIRFINDER_ADMIN_PASSWORD:?set AIRFINDER_ADMIN_PASSWORD in deploy/.env}
NEXTAUTH_SECRET: ${CRM_AUTH_SECRET:?set CRM_AUTH_SECRET in deploy/.env}
POSTGRES_PASSWORD: ${CRM_DB_PASSWORD:?set CRM_DB_PASSWORD in deploy/.env}
```

Note this makes the whole `apps` profile require every value, even if only one demo is wanted. If that is too strict, apply it per service group (CRM values on the CRM services only).

## N-04: the RMM demo needs Docker and nothing checked for it · 3/10

**Category:** Availability
**Location:** `data/tools/rmm_demo_api.py` (waits for ports 5433 and 6380 after `docker start`), `start-customer-demo.bat`, `registry/apps.json` (`rmm-demo` / `api`, health wait 60 s in `supervisor/index.mjs` `start()`).

**Description:** Unlike the other demos, the RMM demo keeps Postgres and Redis in Docker containers (`pd-rmm-demo-pg`, `pd-rmm-demo-redis`). With Docker Desktop not running, the API process waits 60 s, exits with "Port 5433 did not come up", and the launcher reports "NOT RESPONDING". Reproduced: `docker info` returned "failed to connect to the docker API", and `data/logs/rmm-demo-api.log` ends with the same message.

**Remediation (applied in the launcher):** `start-customer-demo.bat` now runs `docker info`, starts Docker Desktop if needed and waits up to 3 minutes, before starting the RMM demo. Still open: starting `rmm-demo` from the admin console does not do this. `data/tools/rmm_demo_api.py` could try to start Docker Desktop itself, but the supervisor's 60 s wait is shorter than a Docker cold start, so the more reliable fix is a longer `health` wait for that one process or a `prepare`-style step in the registry. Unable to verify the exact start time on this machine; it varies.

## N-05: sign-in errors reveal whether two-step is on · 2/10

**Category:** Authentication, information disclosure
**Location:** `admin-console/console.mjs:146`: `error: totpSecret ? 'Wrong password or code.' : 'Wrong password.'`

**Description:** An unauthenticated caller can learn whether the owner has enabled two-step codes by sending any wrong password. It does not help guess anything, but it tells an attacker which factors to aim at.

**Remediation:**

```js
return json(res, 401, { error: 'Wrong password or code.' });
```

## N-06: any `Upgrade` request becomes a raw socket · 2/10

**Category:** Proxying
**Location:** `demo-gateway/gateway.mjs:292-364` (`upgrade()`): there is no check of `req.headers.upgrade`; after the handshake line is re-sent, `socket.pipe(upstream); upstream.pipe(socket)` joins the two sockets.

**Description:** Node raises the `upgrade` event for any request that carries an `Upgrade` header (for example `h2c`), not only WebSocket. A customer with a valid session can use that to hold a raw byte pipe to the demo app, where the gateway's body-size limit (`maxBodyBytes`), header filtering of later requests and per-request audit no longer apply. It is limited to their own demo instance, so the impact is small.

**Remediation:**

```js
// at the top of upgrade(), before grantFor()
if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return rejectUpgrade(socket, 400, 'Bad Request');
```

## N-07: unknown cookies cost a database read each, unlimited · 2/10

**Category:** Denial of service
**Location:** `demo-gateway/gateway.mjs:129-134` (`grantFor`) called at line 215 (`handle`) and line 297 (`upgrade`). Only link redemption (`limited(ip)`, line 171) is rate limited.

**Description:** A request with a well-formed 64-hex `pd_demo` cookie runs `store.grantSessions.get(...)` before it is refused with 401, and nothing limits how many such requests one address may send. The cookie cannot be guessed (256 bits), so this is load, not access. `TRUSTED_PROXIES` is set in the compose file, so per-address limits would work behind Caddy.

**Remediation:** a small in-memory limit, with no database writes:

```js
// gateway.mjs, near the other helpers
const missBuckets = new Map(); // ip -> { n, t }
const tooManyMisses = (ip) => {
  const now = Date.now(), b = missBuckets.get(ip);
  if (!b || now - b.t > 60000) { missBuckets.set(ip, { n: 1, t: now }); return false; }
  return ++b.n > 120;
};
// in handle(), when grantFor returns null:
if (!g) return tooManyMisses(ip) ? page(res, 429, 'Too many attempts', 'Please wait a minute.', { 'retry-after': '60' }) : page(res, 401, /* … */);
```

(prune `missBuckets` on the existing hourly `pruneTimer`.) Alternatively enforce it in Caddy with a rate-limit module.

## N-08: RMM demo reset depends on untracked files · 2/10

**Category:** Reproducibility
**Location:** `registry/apps.json` (`rmm-demo` reset step 3: `..\..\..\tools\seed-rmm-demo.py`; process `api`: `..\..\..\tools\rmm_demo_api.py`). `.gitignore` has `/data/*` with only `!/data/README.md`; `git ls-files data` lists only `data/README.md`; both `data/tools/rmm_demo_api.py` and `data/tools/seed-rmm-demo.py` exist on disk but are untracked.

**Description:** On a fresh clone the RMM demo's API launcher and reset step 3 would fail because neither script is in git. The same applies to any other `data/tools` script the registry names. This is a reliability gap, not a security one.

**Remediation:** move the scripts the registry depends on out of the ignored `data/` folder (for example `supervisor/demo-fixes/`, which already holds `rmm_reset.py`) and update the paths, or add `!/data/tools/` to `.gitignore` and track them:

```gitignore
!/data/tools/
/data/tools/node_modules/
```

## N-09: a demo account password appears in a reset log · 1/10

**Category:** Secrets in logs
**Location:** `data/logs/rmm-demo-reset.log` contains the seed script's line `Created admin user: admin@rmm-demo.test / <password>`. `supervisor/index.mjs` `redact()` masks only values of environment variables whose names match `KEY|SECRET|TOKEN|PASS|URL|DSN`; a password printed by a script that is not an environment value is not masked.

**Description:** The value is a sample demo credential, `data/logs/` is git-ignored, and the console does not serve `*-reset.log` (its logs route reads only `<app>-<process>.log`), so exposure is local only. Recorded for completeness because the log is kept.

**Remediation:** have the seed script stop printing the password, or mask it when the log is written:

```js
// supervisor/index.mjs, in redact(), after the env loop
text = text.replace(/(Created admin user: \S+ \/ )\S+/g, '$1***');
```

## N-10: hosted Postgres containers keep default capabilities · 1/10

**Category:** Container hardening
**Location:** `deploy/docker-compose.yml`: services `postgres` and `crm-demo-db` set only `security_opt: ["no-new-privileges:true"]`, while `gateway`, `console` (`x-hardened`) and `caddy` also drop capabilities. Partly covered by SEC-16.

**Remediation:** Postgres needs a few capabilities on first start; drop the rest:

```yaml
cap_drop: [ALL]
cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID]
```

Test with a fresh volume, because the capabilities are needed when the data directory is first initialised.

## Checked and found sound

- **Link and session tokens:** 192-bit link tokens are stored only as SHA-256 (`grants.mjs` `hashToken`); the cookie holds a separate 256-bit session id, also stored hashed (`gateway.mjs:206-207`, `auth.mjs` `hashSessionId`).
- **Per-request grant check:** revocation and expiry apply to every request and, every `wsRecheckMs`, to open WebSockets, with fail-closed after three failed database checks (`gateway.mjs:331-340`).
- **Gateway headers:** gateway-owned cookies are stripped from upstream `Set-Cookie` and from the request forwarded upstream; `Domain` attributes removed; client-address headers dropped (`gateway.mjs:29, 37, 152, 254`).
- **Health, metrics, TLS ask:** `/_pd/metrics` needs a bearer token or loopback without `X-Forwarded-For`; `/_pd/tls-ask` answers only direct calls for real product names, and Caddy adds `X-Forwarded-For` to anything it proxies, so neither is reachable from the internet (`gateway.mjs:115-125`, `Caddyfile`).
- **Console:** `Host` allow-list, same-origin check on every state-changing request, per-address and overall sign-in limits, TOTP replay protection serialised by `withTotpLock`, nonce-based script CSP, all dynamic values inserted with `textContent`/`el()` (no `innerHTML`, `eval` or `document.write` anywhere in `admin-console/`).
- **Passwords:** scrypt N=2^17 with a concurrency cap of 2 (`auth.mjs:10-21`), bounded parameters when verifying (`:39`), minimum length 12.
- **Sessions after changes:** `set-password`, `remove-password`, `disable-totp` and `sign-out-all` all clear stored sessions (`auth-cli.mjs` lines 63, 111, 121, 127).
- **Static server:** `showcase/serve.mjs` resolves the path and requires it to stay under `dist/`; binds `127.0.0.1`; strict CSP. `esc()` in `showcase/build.mjs:12` escapes `& < > " '`. The new glass styling in `showcase/build.mjs` adds CSS only.
- **Supervisor:** allow-listed child environment (`clean-env.mjs`), process names restricted to `[\w-]+` (`registry.mjs:33`), only recorded PIDs are killed after a start-time match, step output redacted and logs created with mode `0600`.
- **Dependencies and CI:** `npm audit --omit=dev` reports 0 vulnerabilities; actions pinned by commit SHA; workflow permissions `contents: read`.
- **Batch launcher:** `start-customer-demo.bat` rejects any product name not in its fixed list before using it in a command, so a crafted argument cannot reach `node` or `curl`.

## Unable to verify

- Whether the Airfinder, CRM and ClaudeWorkspace containers refuse to start with empty secrets (N-03): their source is outside this repository.
- Behaviour of a real hosted deployment (Caddy on-demand certificates, rate limits behind the proxy): no hosted instance was available.
- The browser-side behaviour of the console and showcase was checked by reading the code and compiling the script, not by driving a browser.

## Suggested order

1. N-01 (one line; turns CI green) and N-02 (a test that would have caught the blank console).
2. N-03, N-05 and N-06 (each a few lines).
3. N-04 console path, N-07, N-08, then N-09 and N-10 when convenient.
