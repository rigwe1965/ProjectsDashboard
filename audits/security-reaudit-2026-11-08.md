# Security re-audit after the fixes: ProjectsDashboard

Date: 2026-11-08 · Compared: `94da7d7` (original audit) to `b99c411` (all fixes) · Scope: every file changed in that range (44 files, about 2,100 lines added), read in full.

Checks run: `npm audit` (0 vulnerabilities), `npx eslint .` (clean), `npm test` (134 tests, 133 pass, 1 skipped, 0 fail), a search of all tracked files for keys, tokens, private keys and URLs with passwords (nothing found except the known CI test values and documentation examples), and a read of the changed code for new weaknesses. Nothing was run against a live deployment.

## Result

No new high or medium issue was introduced. One real defect in a new safety guard was found and fixed (RA-01). Four low-importance observations remain (RA-02 to RA-05); none needs action before use.

| ID | Finding | Importance | Status |
|---|---|---|---|
| RA-01 | `reset-fs.mjs` path guard accepted paths on another Windows drive or a network share | 3 | **Fixed** (test added) |
| RA-02 | Reset and snapshot guards compare path text, not real paths (symlinks) | 2 | Open, accepted |
| RA-03 | Setup file path for the 2-step secret is stored in the database and later truncated and deleted | 2 | Open, accepted |
| RA-04 | Hosted CRM demo runs with admin 2-step codes off and a rate-limit service that has no token if `CRM_AUTH_SECRET` is empty | 2 | Open, by design |
| RA-05 | Reset step output is written to `data/logs/<id>-reset.log` and may include whatever a seed script prints | 2 | Open, accepted |

## RA-01: reset path guard accepted other drives (fixed)
`checkPath` (used by `reset-fs.mjs` and `snapshot.mjs`) is meant to allow only paths inside `data/`. On Windows, `path.relative` returns an absolute path unchanged when the target is on a different drive or a UNC share, and that passed every check. Confirmed by running it: `D:\other\x\y` and `\\server\share\a\b` were allowed. Reachable only through a registry entry (the registry is trusted), so impact was low, but the guard did not do what its comment said. Fix: also refuse when the relative result is absolute (`supervisor/reset-fs.mjs`). The existing test now includes both cases.

## RA-02: symlinks in reset and snapshot (open, accepted)
The guards work on path text. If code running inside a demo clone replaced a registry-listed path with a symlink or junction pointing outside `data/`, a restore could write through it. This needs a compromised demo app and a registry path that is a link, and removal of a link removes the link, not its target. Mitigation if wanted: resolve with `realpath` before acting.

## RA-03: 2-step setup file path stored in the database (open, accepted)
`auth-cli enable-totp --start` stores the chosen file path so `--code` can delete the file afterwards. Whoever can edit the dashboard database could name another file and have the owner's next `--code` run truncate and delete it. Someone with write access to that database already controls the console, so this adds little. Mitigation if wanted: only delete a path that is inside the folder the file was written to, and check it still starts with the setup text.

## RA-04: hosted CRM demo stand-ins (open, by design)
Production mode needed stand-ins, which the compose file supplies: admin 2-step codes off (`REQUIRE_ADMIN_MFA=0`), mail to a closed port, MFA and cron keys derived from `CRM_AUTH_SECRET`. This matches the local demo and the demo holds only sample data. The rate-limit service accepts any caller if `CRM_AUTH_SECRET` is empty, but it is on the internal network only, and the CRM image refuses to start with an empty secret.

## RA-05: reset logs (open, accepted)
Step output goes to a log file under `data/logs/` (git-ignored), the same as app logs. The console and gateway only see "step failed, see the log"; step output is not returned to the browser.

## Checked and found sound
- **SEC-01:** apps receive an allow-listed environment; the supervisor and console keep theirs. Registry `env` and `envFile` values are added after filtering.
- **SEC-04:** certificate validation is on by default; the opt-out prints a warning.
- **Link redemption (SEC-07):** a GET never spends a use; a POST does. The token is still the only secret, and the same rate limits apply before either. The device cookie is a random value stored hashed; a client-supplied value is only hashed, never trusted.
- **Cookies (SEC-18):** `__Host-` names over HTTPS; gateway cookies and `Domain` attributes are stripped from upstream `Set-Cookie`.
- **WebSocket origin (SEC-06):** a browser `Origin` must match the host; clients without one (non-browser) still work.
- **Console script policy (SEC-08):** per-response nonce; JSON and redirects get `script-src 'none'`.
- **Sign-in (SEC-10, 11, 12):** scrypt runs off the main thread with at most two at once (about 270 MB, inside the 512 MB container limit); parameters in a stored hash are bounded; the 2-step secret is encrypted with AES-256-GCM when `ADMIN_DATA_KEY` is set and sign-in fails closed if the key is wrong.
- **Reset endpoints:** the console route is behind sign-in and the same-origin check, product names are matched against the registry (names like `__proto__` return 404), malformed JSON returns 400, and concurrent resets are refused. The host script validates product names before use and the state tool validates them again.
- **Hosted images (SEC-02/16):** production builds, no `.next` volumes, `no-new-privileges`, all capabilities dropped, process and memory limits, the rate-limit service and one-off reset service are on the internal network only with no published ports. Only Caddy publishes ports.
- **Supply chain (SEC-15):** workflow token is read-only; actions are pinned to commit SHAs; `npm audit` runs in CI; Dependabot covers npm, actions and Docker. The pinned SHAs were not re-checked against GitHub from here.

## Not verifiable here
- The hosted ClaudeWorkspace reset against a real Supabase project (only a dummy address was available).
- `deploy/reset-demos.sh` on a Linux host (it was run from Git Bash on Windows).
- The pinned action SHAs and Docker base image versions against their upstream registries.
- Installed Next.js versions in the demo clones (`npm audit` inside `data/demo-src/*`), unchanged from the first audit.

---

# Second pass: after "one private demo copy per link" (`ad5386d`)

Compared: `e1a59d3` to `ad5386d` plus the fix below. Read in full: `demo-gateway/instances.mjs`, `lib/instance-app.mjs`, the gateway, supervisor, snapshot and registry changes, the console change, and the new registry blocks. Checks: `npm audit` 0 vulnerabilities, lint clean, 143 tests (142 pass, 1 skipped, 0 fail), secret scan of changed files clean, plus a live run (real gateway, real supervisor, real Airfinder copies, two customers) and a check that every copy listens on `127.0.0.1` only.

## Result
No new high or medium issue. One real defect found and fixed (RB-01). Three low observations remain.

| ID | Finding | Importance | Status |
|---|---|---|---|
| RB-01 | A browser cancelling a request marked the customer's copy as down, which restarted it and deleted their data | 4 | **Fixed** (2 tests added) |
| RB-02 | Copies are separated by data and ports, not sandboxed; they run as the dashboard's OS user | 3 | Open, documented |
| RB-03 | A seat whose copy cannot be stopped stays taken (retried every 30 s, logged) | 2 | Open, accepted |
| RB-04 | Running copies are not listed in the console's process status, only counted per product | 2 | Open, accepted |

## RB-01: cancelled request treated as a crash (fixed)
When the gateway could not reach a customer's copy, it marked the copy failed so the next request would start a new one. A browser that navigates away mid-request makes the gateway abort its own upstream request, which raises the same kind of error, so an ordinary page change could trigger it. The restart builds a fresh copy and deletes the old data folder, so the customer would silently lose what they had entered. Confirmed with a failing test first. Fix: only a refused connection (nothing is listening) marks a copy down (`demo-gateway/gateway.mjs`). Tests cover both a cancelled request (copy kept, no restart) and a genuinely dead copy (restarted once).

## RB-02: no OS-level isolation between copies (open, documented)
Each copy has its own data folder, port and database, and the gateway only ever routes a customer to their own port. A compromised demo app could still read another copy's folder, because they share one OS user. This is the same trust level as before (all demos already ran as that user). Documented in `demo-gateway/README.md`. Real isolation would need separate OS users or containers.

## RB-03 and RB-04 (open, accepted)
If stopping a copy fails, its seat stays occupied and is retried every 30 seconds, with an error logged, so a stuck process cannot be silently reused. The console shows seats in use per product but not each copy's processes; `data/instances/` and the log files show them.

## Checked and found sound
- **Link handling:** a seat is checked before a link's use is counted; only valid, active, rate-limited links reach the code that starts a copy; one link can only hold one seat.
- **Paths and commands:** slot numbers must be whole numbers within the product's limit, ids come from the registry (letters, digits, `_`, `-`), and the instance folder is built from those only, so it cannot leave `data/instances/`. `restore-to` accepts only folders inside that location.
- **Routing:** the upstream port comes from the customer's own seat, never from the request. WebSocket upgrades are refused until the copy is ready, and an open socket counts as use.
- **Clean-up:** copies stop and their data is deleted when the link ends, after 2 hours idle, after a failed start, and after a gateway restart; copies with no seat record are removed at start-up.
- **Exposure:** all copy processes (ImageApp, Airfinder, ClaudeOS UI and API) listen on `127.0.0.1` only, which also settles the earlier "does Airfinder bind to all interfaces" question for this configuration.
- **Resets and console:** private products are skipped by the automatic reset and have no Reset route (404). The console reads the seat table only.

## Not verified here
End-to-end browser use of a ClaudeOS or ImageApp copy through the gateway (their copies were started and probed directly; the gateway path was exercised live with Airfinder and in unit tests). Behaviour with all 11 seats busy on a small machine.
