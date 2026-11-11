# Whole-project review: ProjectsDashboard

- **Date:** 2026-11-11
- **Commit reviewed:** `e563371` (branch `main`, clean working tree)
- **Reviewer:** Claude Fable 5.2, read-only review. No project file was changed apart from adding this report.
- **Scope:** every tracked source file: `lib/`, `supervisor/`, `demo-gateway/`, `admin-console/`, `showcase/`, `deploy/`, `registry/`, the launch scripts, CI, and the test set-up. The six app folders (Airfinder, ClaudeOS, CRM, ...) are git-ignored copies and were not reviewed.
- **Earlier audits:** the eight reports already in `audits/` were read first. Items they list as fixed or accepted are not repeated here unless something new was found.

## How to read this

Each finding has a status:

- **Confirmed**: reproduced by running something (the command or script is named).
- **By reading**: established from the code alone. Likely right, but a failing test first would settle it.
- **To check**: depends on something outside this repository (an app's own code, a key's settings).

Severity is my judgement of impact on this project as it is used today (owner's PC, hosting deferred): **High**, **Medium**, **Low**.

## Checks that were run

| Check | Result |
| --- | --- |
| `npm test` | 222 pass, **1 fail**, 1 skipped (the failure is finding F-01) |
| `npm run lint` | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Secret patterns in tracked files | none (one fake token in a test) |
| Isolated gateway proof script (temp database, fake demo app) | confirmed F-02, F-12, F-13 |

## Summary

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| F-01 | High | Confirmed | Running the tests writes an empty database into the real backup folder, and one test fails on this PC |
| F-02 | Medium | Confirmed | An `Upgrade` request that the demo app does not upgrade becomes an unfiltered tunnel to it |
| F-03 | Medium | To check | Two customer-facing demos hold a live Anthropic API key and the gateway has no usage cap |
| F-04 | Medium | By reading | A failed or interrupted reset lets the next customer into the previous customer's data, or leaves the demo down with no alert |
| F-05 | Medium | By reading | `reset-supabase-demo.mjs` deletes users and rows with no check that the target is the demo project |
| F-06 | Medium | By reading | A gateway started through the supervisor loses its environment settings |
| F-07 | Medium | By reading | An alert is lost when the webhook cannot be reached at that moment |
| F-08 | Medium | By reading | The customer-demo launcher uses up private seats and starts an instance nothing uses |
| F-09 | Medium | Confirmed | App logs grow without limit |
| F-10 | Low | By reading | After a fatal error the gateway and console exit with code 0 |
| F-11 | Low | By reading | Starting a private copy wipes its folder without first stopping what is left there |
| F-12 | Low | Confirmed | `//__nextjs_...` passes the gateway's dev-route block |
| F-13 | Low | Confirmed | `constructor` and `__proto__` count as product names |
| F-14 | Low | By reading | Two resets of one demo can start at the same moment; a reset carries on when the stop failed |
| F-15 | Low | By reading | Damaged stored data is answered as "400 bad request" and never logged |
| F-16 | Low | By reading | Registry checks miss `demoRoutes`, empty entries and a lowered seat count |
| F-17 | Low | By reading | Snapshot and reset tools ignore `DASHBOARD_DATA` |
| F-18 | Low | Mixed | Smaller defects (12 short items) |
| F-19 | Low | By reading | Hosted setup: gaps to close before going online |
| F-20 | Low | Confirmed | Documentation that no longer matches the code |

Nothing was found that lets someone without a valid demo link, or without the owner's sign-in, reach data or run commands. The authentication, token handling, path guards and SQL use hold up (see "Checked and found sound").

---

## F-01: Running the tests writes an empty database into the real backup folder · High · Confirmed

**Where:** `tests/unit/console-launch.test.mjs:15`, `tests/browser-stack.mjs:35` and `:41`, `tests/unit/console.test.mjs:343` and `:396`; the code they start: `admin-console/server.mjs:45-50` and `:54-66`.

**What happens.** These tests start the real console program and pass it `...process.env`, replacing only the data folder and port. This PC has `DASHBOARD_BACKUP_DIR`, `ALERT_WEBHOOK_URL` and `ADMIN_DATA_KEY` set as user-level variables, so the test console inherits them:

1. At start-up the console makes a backup when the newest one is over 20 hours old. The test console's database is a new, empty one, and it is written into the real backup folder under a normal backup name.
2. The real console then sees a backup under 20 hours old and skips its own start-up backup. The newest file in the folder is an empty database.
3. Retention keeps the 14 newest files, so each of these pushes a real backup out.
4. `console.test.mjs:396` expects "ADMIN_DATA_KEY is not set" but the key is inherited, so the test fails on this PC (it passes in CI, where the variable does not exist).
5. `npm run test:browser` keeps a console alive long enough for the alert check to run with the real webhook.

**Reproduced during this review.** `npm test` at 06:58 UTC on 2026-11-11 created `D:\ProjectsDashboardBackups\dashboard-20261111-065846.db`: 77,824 bytes, 0 grants, 0 audit rows, no password. The previous day's backup holds 144 grants and 548 audit rows. **That file is not a real backup and should be deleted** (it could not be removed from this session):

```powershell
Remove-Item "D:\ProjectsDashboardBackups\dashboard-20261111-065846.db"
```

After that, `npm run backup` makes a real one.

**Fix.** Give test processes a clean environment instead of the owner's: build `env` from a short allow-list (PATH, SystemRoot, TEMP, ...) plus the test's own values, or at least delete `DASHBOARD_BACKUP_DIR`, `ALERT_WEBHOOK_URL`, `ADMIN_DATA_KEY`, `DASHBOARD_DB` and `DATABASE_URL` before spawning. One shared helper in `tests/helpers.mjs` would cover all four call sites. As a second guard, `runBackup` could refuse to write when the data folder is not the configured one.

---

## F-02: An `Upgrade` request the app does not upgrade becomes an unfiltered tunnel · Medium · Confirmed

**Where:** `demo-gateway/websocket.mjs:76-96` (the two `pipe` calls at line 93).

**What happens.** After the gateway connects to the demo app it re-sends the upgrade request and then joins the two sockets. It never looks at the app's answer. If the app answers `200` instead of `101 Switching Protocols` and keeps the connection open, the customer's socket is now a raw line to the app, and every further request typed into it skips the gateway.

**Proof** (throwaway gateway, fake app): a second request sent down the same connection reached the app as

```text
{"url":"/__nextjs_original-stack-frame","xff":"6.6.6.6","xreal":"6.6.6.6","cookie":"pd_demo=5438...; mine=1","host":"anything"}
```

So through this path:

- the customer chooses the client address the app sees (`X-Forwarded-For`, `X-Real-IP`). An app that limits sign-in attempts per address, such as the CRM demo, can be made to see a new address each time, which matters because shared demos have an "owner only" admin account;
- the gateway's own session cookie (`pd_demo`) is handed to the demo app;
- the dev-route block, the upload size limit and the per-request checks do not apply;
- response headers from the app (including `Set-Cookie` with `Domain=`) go to the browser without the filtering that `proxy-headers.mjs` applies to normal responses. This last point also holds for a genuine `101` answer.

It needs a valid, active link and reaches only that customer's own demo, which is why this is Medium and not High. It is the follow-on to N-06 in `code-audit-2026-11-09.md`: that fix limited upgrades to `websocket`, but the tunnel is still opened whatever the app replies.

**Fix.** Read the app's response head before piping. Only on `HTTP/1.1 101` pass it on (after removing the gateway's cookie names and any `Domain=` from `Set-Cookie`) and join the sockets. For any other status, relay that one response and close both sockets.

---

## F-03: Two customer-facing demos hold a live Anthropic API key, with no cap at the gateway · Medium · To check

**Where:** `data/claudeos-demo.env` and `data/rmm-demo.env` (key names only were read: both have a non-empty `ANTHROPIC_API_KEY`; RMM has `AI_ASSISTANT_ENABLED=true`). Gateway: `demo-gateway/gateway.mjs:150-178`, `proxy.mjs`.

**What happens.** Anyone holding a ClaudeOS or RMM demo link can make these apps call the Claude API on your account. The gateway limits link opens and sockets per link, but not how many requests a signed-in customer sends. A link is valid for up to 30 days and, unless "Lock to the first browser" is ticked, works for whoever it is forwarded to.

**To check.**
- Are these keys separate from the ones your real apps use? (The two values have different lengths, so they are at least not the same key twice.)
- Does that key have a spend limit in the Anthropic console?
- Do the apps themselves cap requests per user?

**Fix.** Use a key made only for demos, in its own workspace with a low monthly spend limit. Consider a per-link request limit in the gateway (requests per minute per grant, in memory, like `tooManyMisses`). Two related settings worth a look: `CLAUDEOS_ENV=development` and `FLASK_ENV=development` in the demo env files. `FLASK_DEBUG=0` and waitress mean the debugger is not exposed, but development mode can still show more detail in error pages than a customer should see.

---

## F-04: A failed or interrupted reset fails open, or leaves the demo down silently · Medium · By reading

**Where:** `supervisor/core.mjs:204-221`, `demo-gateway/reset.mjs:44-61` and `:65-74`, `demo-gateway/redeem.mjs:32`.

Two separate problems in the same flow:

**(a) The next customer gets the old data.** The gateway holds links back only while `demo_resetting` is set. When a reset step fails, `endReset` clears that flag, records the failure and the demo is started again with whatever data it has. A new customer who opens a link in the next 10 minutes (before the retry) enters a shared demo that still holds the previous customer's entries. Once they are in, the product counts as "busy" and no retry happens until their link ends. The reset exists so one customer's data never reaches the next (SEC-03); a failure quietly switches that off.

**(b) The demo stays down.** `reset()` remembers "it was running" only in a local variable. If the supervisor process is killed between the stop and the start (the 20-minute limit in `runReset`, a crash, a reboot), the demo is left stopped. The retry then sees "not running", runs the steps and, correctly by its own logic, does not start it. Because a stopped app has no process record, the alert check ignores it. Customers get "Demo unavailable" until someone notices.

**Fix.** (a) After a failed reset keep refusing new opens for that product ("being prepared") until a reset succeeds or the owner overrides it in the console. (b) Write "restart after reset" into the store before stopping and clear it after the start, so a later run finishes the job; or have the sweep start a `demoReady` shared demo that has active links and is not running.

---

## F-05: `reset-supabase-demo.mjs` has no check that it is pointed at the demo project · Medium · By reading

**Where:** `supervisor/reset-supabase-demo.mjs:20-27` and `:50-69`; called with `--yes` by the registry's `claudeworkspace-demo` reset and by `deploy/docker-compose.yml` (`cw-reset`).

**What happens.** The script deletes every row in eleven tables (bookings, payments, ...) and every sign-in account except two, in whichever Supabase project the env file or environment names. Its only guard is the `--yes` flag, which the automatic reset always passes. Its sibling `apply-sql.mjs` checks the project ref and refuses a database it did not set up; this script, which is more destructive, checks nothing. If the real project's URL and service key were ever pasted into `data/claudeworkspace-demo.env` or `deploy/.env` (the files look alike), the next automatic reset would empty production.

**Fix.** Require a second value that must match, for example `DEMO_PROJECT_REF=<ref>`, compared with the host of `NEXT_PUBLIC_SUPABASE_URL`, and stop if it is missing or different. A marker row in the demo database that the script looks for before deleting would be stronger still.

---

## F-06: A gateway started through the supervisor loses its environment settings · Medium · By reading

**Where:** `supervisor/env.mjs:20-29`, `lib/clean-env.mjs:10-14`, the `gateway` entry in `registry/apps.json`, `start-customer-demo.bat:66`.

**What happens.** The registry lists the gateway as an app, so the console's Start button and the launcher start it with `supervisor start gateway`. Every supervised process gets the cut-down environment meant to keep the owner's secrets away from demo apps. The gateway is not a demo app: it is part of the dashboard and reads its configuration from the environment. Started this way it never sees `DEMO_BASE_HOST`, `DEMO_SCHEME`, `TRUSTED_PROXIES`, `METRICS_TOKEN`, `AUDIT_RETENTION_DAYS`, `GATEWAY_*`, `DEMO_AUTO_RESET`, `DASHBOARD_DATA`, `DASHBOARD_DB` or `DATABASE_URL`.

With the defaults this is invisible. The moment one of them is set it splits: with `DASHBOARD_DATA` or Postgres the console and gateway use different databases, so links created in the console are "not valid" at the gateway; a retention or rate setting silently has no effect. `npm run gateway` behaves differently from the Start button.

**Fix.** Give the `gateway` registry entry an explicit pass-through list for its own settings (a per-process `passEnv` in the registry, read by `childEnv`), or start the gateway from the console directly instead of as a registry app. `PD_APP_ENV_PASSTHROUGH` works today but would hand the same variables to every demo app.

---

## F-07: An alert is lost when the webhook cannot be reached · Medium · By reading

**Where:** `lib/alerts.mjs:45` and `:52-53`.

**What happens.** `lastSent` is set before `send()` and the result is ignored. If the POST fails (the network is down, which is often why things are down), the alerter believes the message went out and stays quiet for 6 hours. The "is back" message is the same: the record is deleted first, so a failed send is never retried.

**Fix.** Set `lastSent` only when `send` returns true; on failure try again at the next check. For "back", keep the record until the message is delivered.

---

## F-08: The customer-demo launcher uses up private seats and starts an unused instance · Medium · By reading

**Where:** `start-customer-demo.bat:69-80`; seats in `registry/apps.json` (`perLink.max`: imageapp 4, airfinder 4, claudeos 3).

**What happens.**
- Every run creates a new 8-hour "Local owner" link (the database holds 144 links). For ImageApp, Airfinder and ClaudeOS each opened link takes a private seat for up to 2 idle hours. Running the launcher four times for Airfinder in an afternoon leaves no seat for a real customer: they see "All demo seats are taken".
- For those three products the launcher also starts the shared instance (`imageapp-demo` on 5410, and so on) and waits for it. Since private copies were introduced the gateway never sends anyone to that instance, so it is a process that only uses memory.

**Fix.** For `perLink` products skip the shared-instance start. Reuse an existing active "Local owner" link, or revoke the previous one before creating a new one (revoking frees the seat within 30 seconds).

---

## F-09: App logs grow without limit · Medium · Confirmed

**Where:** `lib/process-driver.mjs:66` and `:101` (`>> logPath`), `supervisor/steps.mjs:40`.

`data/logs/claudeworkspace-web.log` and `claudeworkspace-admin.log` are already 10 MB each after a few days. Nothing rotates or trims them, and the console only ever reads the last 12 KB. Private copies write their logs under `data/instances/`, which are deleted with the copy, so this concerns the long-lived apps.

**Fix.** At `start`, if the log is over a set size (say 5 MB), rename it to `.1` (replacing the old `.1`) before the app is launched.

---

## F-10: After a fatal error the services exit with code 0 · Low · By reading

**Where:** `demo-gateway/server.mjs:43-51`, `admin-console/server.mjs:70-78`.

The fatal handler sets `process.exitCode = 1` and calls `shutdown()`, which ends with `process.exit(0)`. An explicit `process.exit(0)` wins, so a crash looks like a clean stop to anything that reads the exit code. Docker's `unless-stopped` restarts either way, so the effect today is limited to launch scripts and monitoring.

**Fix.** `process.exit(process.exitCode ?? 0)`.

---

## F-11: Starting a private copy wipes its folder without stopping what is left there · Low · By reading

**Where:** `supervisor/core.mjs:167-169`, `demo-gateway/instances.mjs:47-50` and `:68-77`.

`instanceStart` deletes and recreates the copy's data folder, then starts only the processes that are not already answering. Two ways this goes wrong:

- A copy has two processes (ClaudeOS: ui and api) and one crashed. The other is still running on the folder that is being deleted. On Windows the delete fails on open files and the start fails; a later clean-up and retry recover it, after the customer has seen "Demo could not start".
- After a failed start the clean-up (`instance-stop`) is fired without waiting. A customer retry 20 seconds later can run `instance-start` while that stop is still deleting the folder.

**Fix.** Make `instanceStart` call `stop(app)` before `freshInstanceDir`, and have `begin()` wait for its clean-up before the seat is marked failed.

---

## F-12: `//__nextjs_...` passes the dev-route block · Low · Confirmed

**Where:** `demo-gateway/gateway.mjs:154` and `:169`, `demo-gateway/proxy.mjs:32`.

The block is tested against a parsed URL (`new URL(req.url, base).pathname`) but the raw `req.url` is what gets forwarded. For `//__nextjs_original-stack-frame` the parser reads `__nextjs_original-stack-frame` as a host name and returns the path `/`, so the check passes and the app receives `//__nextjs_original-stack-frame` (proof script: status 200, the app saw that URL). Percent-encoded forms pass the same way. The same parsed path picks the `demoRoutes` process, so `//admin` goes to the wrong one.

No demo runs `next dev` today (they use `next start`), so nothing is exposed now. It matters the day a dev server is put behind the gateway.

**Fix.** Refuse a request target that does not start with exactly one `/`, and run the check on the same string that is forwarded.

---

## F-13: `constructor` and `__proto__` count as product names · Low · Confirmed

**Where:** `demo-gateway/gateway.mjs:121` and `:143`, `demo-gateway/grants.mjs:21`, `admin-console/console.mjs:236`.

`demoApps()` returns a plain object and it is indexed with outside text. `demoApps()['constructor']` is a built-in function, which counts as "exists". Proof: `/_pd/tls-ask?domain=constructor.localhost` and `__proto__.localhost` both answer 200, where an unknown name answers 404. In the hosted setup Caddy would therefore request a certificate for `constructor.<demo domain>`. Requests to that host still end at 401 or 403, and only the owner could create a link for such a "product" (opening it would give a 500).

**Fix.** Build the map with `Object.create(null)` or a `Map`, or look up with `Object.hasOwn`.

---

## F-14: Reset: two can start at once, and it carries on when the stop failed · Low · By reading

**Where:** `demo-gateway/reset.mjs:38-43`, `supervisor/core.mjs:209`.

- `beginReset` reads the flag and then writes it, in two steps. The gateway's sweep and the console's Reset button are different processes, so both can pass the check and run the same reset at once.
- `reset()` does not look at whether `stop(app)` succeeded. If the process could not be stopped, the steps (deleting a database file, restoring a snapshot) run under a live app.

**Fix.** Claim the flag in one statement (insert-if-absent, or a compare-and-set on the stored value). In `reset()`, stop and report when `failed` is set after the stop.

---

## F-15: Damaged stored data is answered as "400 bad request" and never logged · Low · By reading

**Where:** `lib/errors.mjs:13`, `lib/store/shared.mjs:20-21`, `admin-console/console.mjs:238-240`.

`toResponse` turns every `SyntaxError` into a 400, and the console logs only statuses of 500 and above. A `JSON.parse` failure on stored data (a damaged audit row, a damaged process record) is therefore shown as the browser's mistake and leaves no trace in the log. One bad audit row makes the whole Activity panel fail this way.

Also in `demoReset`: a body of `null` passes `JSON.parse` and then `b.force` throws, a 500 (`demoCreate` checks `isPlainObject`, this route does not).

**Fix.** Catch the parse error where the request body is read and throw `badRequest()` there; remove the blanket `SyntaxError` rule. Parse stored rows defensively (skip and log a bad one).

---

## F-16: Registry checks miss three things · Low · By reading

**Where:** `lib/registry.mjs:22-24` and `:31-33`, `demo-gateway/proxy-headers.mjs:17-19`, `demo-gateway/instances.mjs:36-39`.

- `demoRoutes` is not validated. A route naming a process that does not exist makes `upstreamPort` throw: a 500 on every matching request, and on the WebSocket path the per-link socket counter is never given back.
- An entry that is `null` (a stray comma) makes `validate` throw a `TypeError` instead of returning its list of problems.
- Lowering `perLink.max` while a higher seat is in use leaves that seat stuck: `instance-stop` refuses the slot number, the sweep retries for ever and the product can report "full".

**Fix.** Validate `demoRoutes` (prefix starts with `/`, process exists); guard `a` and `p` before reading them; let `instance-stop` accept any slot from 0 to 8.

---

## F-17: Snapshot and reset tools ignore `DASHBOARD_DATA` · Low · By reading

**Where:** `supervisor/snapshot.mjs:15`, `supervisor/reset-fs.mjs:9`, compared with `lib/config.mjs:7` and `lib/instance-app.mjs:20`.

These two tools build paths from `<project>/data`, while instance folders use `dataDir`, which follows `DASHBOARD_DATA`. With that variable set, `restore-to` (which requires `dataDir/instances`) and `checkPath` (which requires `<project>/data`) disagree, and the ClaudeOS private copies cannot be prepared. Not a problem with today's default.

Also in `snapshot.mjs`: `take` says "the demo must be stopped" but does not check, and it replaces the golden copy with delete-then-copy (`:43-44`), so an interruption between the two leaves no golden copy.

**Fix.** Use `dataDir` in both; refuse `take` while the app answers on its port; swap with a rename.

---

## F-18: Smaller defects · Low

| # | Where | What | Status |
| --- | --- | --- | --- |
| 1 | `admin-console/index.html:191` | `/Port d+/` is missing a backslash (`\d+`), so "Port 5200 is already in use" messages disappear after 4.5 s instead of 10 s | By reading |
| 2 | `supervisor/index.mjs:37` | An unknown command prints the usage text and exits 0, so a caller sees success | By reading |
| 3 | `demo-gateway/server.mjs:11-17` | `AUDIT_RETENTION_DAYS=0` deletes the whole customer audit log at start-up; other settings use the `num()` helper, this one does not. Only the gateway prunes, so with the console alone nothing is ever pruned | By reading |
| 4 | `demo-gateway/grants.mjs:27-30` | Link ids are 32 bits (a clash is a 500 on create, rare). If the audit write fails after the insert, the link exists but its address is never shown | By reading |
| 5 | `supervisor/create-demo-users.mjs:15` | Sends only `apikey`; `reset-supabase-demo.mjs:26` also sends `Authorization: Bearer`. The admin API may refuse the first form | To check |
| 6 | `registry/apps.json` | `${APPS_ROOT}` and `${DASHBOARD_ROOT}` go into commands without quotes: a folder name with a space breaks every command | By reading |
| 7 | `.github/workflows/ci.yml:16`, `deploy/Dockerfile:4` | CI tests on Node 24, the image runs Node 26 | Confirmed |
| 8 | `admin-console/console.mjs:78` | The console reads the app list once at start, but `demoApps()` re-reads the file: after an edit to `apps.json` the two halves of the page disagree until a restart | By reading |
| 9 | `supervisor/redis-rest-stub.mjs:56-57` | Bound to `0.0.0.0` it still runs without a token (the comment says the two go together; nothing enforces it) | By reading |
| 10 | `supervisor/run-with-env.mjs:11-12` | Passes the whole owner environment to the command and re-joins arguments with spaces (quoting is lost) | By reading |
| 11 | `lib/store/index.mjs:19-22` | Two processes opening a new database together can both import the old JSON files; the second fails on a duplicate id. One-time and already past on this PC | By reading |
| 12 | `lib/events.mjs`, `console.mjs:201`, `instances.mjs:58` | `admin-app-*`, `instance-ready` and `instance-failed` are built from text and are not in `EVENTS`, which exists to prevent exactly that | By reading |

---

## F-19: Hosted setup: gaps to close before going online · Low (hosting is deferred) · By reading

- **`deploy/reset-demos.sh:48-51`:** the Airfinder recipe is stop, reset, start, joined with `&&`. A failed reset leaves the container stopped until the next attempt also gets past that step. Start it again in every case.
- **No automatic database backup.** `deploy/README.md` gives a `pg_dump` command to run by hand. The local setup backs up daily; the hosted one has nothing scheduled.
- **Console buttons.** Start, Stop and the Log view do nothing useful in the hosted console (no Docker access, logs are elsewhere). This is documented at `deploy/README.md:95`, but the buttons are still shown.
- **`/_pd/healthz`** is public on both domains and reads the database on every call, with no limit. Small, but it is the one unauthenticated database read left.
- **F-02, F-04, F-05, F-06 and F-13** all weigh more once the gateway is on the internet. Fix them first.

---

## F-20: Documentation that no longer matches the code · Low · Confirmed

- `README.md:10-15`: the Layout section still says the supervisor has "only `status`" and calls the console, showcase and gateway "placeholder".
- `lib/store/index.mjs:3`: "DASHBOARD_DB=postgres -> Stage 4, not implemented yet". It is implemented.
- `demo-gateway/README.md:11`: says the device lock uses the browser's User-Agent. The code uses a random cookie (`gateway.mjs:32-34`), which is stronger than the README claims.
- `admin-console/auth-cli.mjs:66`: after `set-password` it prints "Restart the console". The console checks the password setting on every request (`console.mjs:90` and `:296`), so the sign-in page appears without a restart; only the listen-safety check runs at start.

---

## Design observations

Not defects. Things to weigh when the code is next changed.

1. **Configuration lives in the environment of two separate programs.** The console creates links and the gateway serves them; both must be given the same `DEMO_BASE_HOST`, `DEMO_SCHEME`, database and registry. F-06 is one result. A single settings file read by both, with the environment as an override, would remove the class of problem.
2. **The seat table is a JSON text in one `meta` row, guarded by a lock inside one process.** It works because exactly one gateway runs. Nothing enforces that; a second gateway on another port would corrupt it. A `seats` table with one row per seat would let the database do the guarding.
3. **Every status check starts a new Node process, and on Windows a PowerShell.** The console does this every few seconds per open tab (cached for 2 s) and the alert check every minute. It is why `status` needed batching. Calling the supervisor's functions in-process for read-only status would be cheaper and faster.
4. **Reset state is three loose `meta` keys per product** with time-based staleness (25 minutes). F-04 and F-14 both come from this. One row per product with an explicit state (`idle`, `resetting`, `failed`, `needs-start`) would make the transitions checkable.
5. **Shared demos (CRM, ClaudeWorkspace, RMM) rely on the reset for privacy between customers.** That is accepted in the earlier audits. It makes the reset a security control, so its failure handling (F-04) deserves the same care as the sign-in code.
6. **Private copies wipe a customer's data on a single refused connection** (`proxy.mjs:46`). It is the right call for a real crash; a brief restart of the app inside the copy has the same effect. Requiring two refusals a few seconds apart would be gentler.

---

## Checked and found sound

- **Owner sign-in:** scrypt with bounded parameters and a bounded queue, constant-time comparisons, 2-step codes with replay protection under a lock, the secret sealed with AES-256-GCM, sessions stored as hashes, `HttpOnly; SameSite=Strict`, `__Host-` cookie names over HTTPS, per-address and overall attempt limits.
- **Console requests:** Host allow-list, same-origin check on every state-changing route, per-response script nonce. `index.html` builds the page with `createElement` and text nodes only; customer names, addresses and browser strings cannot become markup.
- **Customer links:** 192-bit tokens stored as SHA-256; a GET never spends a use; the session cookie is a different random value; the grant is re-read on every request and every few seconds on open sockets; cookies are host-only, so one product's link does not work on another's host.
- **Normal proxy path:** hop-by-hop and spoofable address headers are dropped, the gateway's cookies are never forwarded, `Set-Cookie` from apps is filtered, redirects are rewritten, body size is enforced with and without `Content-Length`.
- **Database:** every statement in both stores is parameterised; the one interpolated name (`DATABASE_SCHEMA`) is validated; `redeem` is atomic in both.
- **Files and commands:** `checkPath` resolves links and refuses other drives; instance folders cannot leave `data/instances/`; container names, process names, slot numbers and PIDs are validated or numeric before they reach a command; the supervisor stops only PIDs it recorded and only when the start time still matches.
- **Demo app environment:** apps get an allow-listed environment, not the owner's (correct for apps; see F-06 for the gateway).
- **Repository:** no secrets in tracked files; `data/` and `.env*` are ignored; CI actions and base images are pinned by hash.
- **Showcase:** static output, every value escaped, strict content policy, path checks in the preview server.

## Not verified

- The six apps' own code and dependencies.
- The Postgres store against a real server (no `TEST_DATABASE_URL` here) and the hosted Docker stack.
- `npm run test:browser` and `npm run test:e2e`: not run, because of F-01 (they start the console with the owner's environment for longer).
- Whether Next.js, Streamlit, waitress and Flask each keep a connection open after declining an upgrade (F-02 was proven with a plain Node server; the fix is the same either way).
- The values in `data/*.env` beyond the few non-secret flags named in F-03.

## Suggested order

1. **F-01**: delete the empty backup file, then isolate the tests' environment. Until that is done, do not run `npm test` or the browser tests on this PC without clearing those three variables first.
2. **F-03**: check the demo API keys and set a spend limit. No code needed.
3. **F-02**: check for `101` before joining the sockets. Small change with an obvious test.
4. **F-05**: add the project-ref guard before the next automatic ClaudeWorkspace reset matters.
5. **F-04**, **F-07**, **F-06**: the three reliability items.
6. **F-08**, **F-09**, then the Low items as the files are touched. F-10, F-12, F-13 and F-18.1 are one-line changes.
