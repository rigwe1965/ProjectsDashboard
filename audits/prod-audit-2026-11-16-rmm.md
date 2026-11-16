# Production audit: RMM / Remote Management System (demo at rmm.demo.facyke.com), 2026-11-16

Status: audit complete. NO code, configuration or deployment change was needed or made.

## Environment
Hetzner demo: `pd-rmm-demo` (Streamlit), `pd-rmm-demo-api` (Flask), `pd-rmm-demo-db` (Postgres), `pd-rmm-demo-cache` (Redis). Only the Streamlit app is reachable, through the gateway; the API, database and Redis have no published ports. The product's source repo is rigwe1965/remotemanagementsystem (main protected, CI required); the owner's own install is local and was not touched.

## Accounts (live demo database, read-only look)
| Account | Role | Notes |
|---|---|---|
| admin@rmm-demo.test | admin | the demo login shown to prospects; last login 2026-11-15 |
| superadmin@rmm-demo.invalid | superadmin | built-in; never logged in before this audit |
Both are active, no MFA, `must_change_password` = false. Their passwords differ from each other and come from the server settings (RMM_DEMO_ADMIN_PASSWORD, RMM_SUPERADMIN_PASSWORD), never from code. Demo data: 3 customers, 8 devices, 3 tickets, 3 alerts.
By design `ensure_superadmin()` re-syncs the built-in superadmin's password to SUPERADMIN_PASSWORD at every API start and the product treats it as an emergency account, so a forced first-login change cannot apply to it (it would be reverted at the next restart). The demo reset restores both passwords. Nothing was created or changed; both logins were written to the owner's credentials file.
Forced change for ordinary accounts is implemented (`must_change_password`, `/auth/me/force-change-password`) and covered by the API tests.

## Security
- Dependencies: pip-audit on the exact package lists of both live containers (82 packages in the API image, 38 in the dashboard image): no known vulnerabilities in either.
- Code (read): login rate limit 5/min per IP, lockout after 3 wrong passwords for 5 minutes, TOTP MFA (secret encrypted), refresh tokens, password-reset tokens made single-use, central role/customer-scope decorators, fail-closed credential encryption, list-argv subprocess calls only. The earlier audit in the repo (`audits/security_audit.md`) reports all its findings fixed; consistent with what was read.
- Network: API/DB/Redis unreachable from outside; HTTPS and security headers come from Caddy (checked for the dashboard in the Dashboard audit).
- Remote terminal and script features: in the demo there is no real agent, so nothing can execute on a real host; the demo admin only queues records.

## Tests
- API: 566 tests; 561 passed locally and 5 failed, all in `tests/test_snmp_get.py`, because the local virtual environment still has pysnmp 4.4.12 while requirements.txt moved to 7.1.32 (SNMP rewrite, 2026-11-11; the live container has 7.1.32). With pysnmp 7.1.32 overlaid from a temporary folder (the local environment was not changed) all 7 SNMP tests pass, so the suite is green with the right dependency. The local environment should be refreshed (`pip install -r api/requirements.txt`).
- Dashboard: 86 passed. Frontend (vitest): 40 passed. The agent test folder is empty.

## Links and buttons (live, headless Chrome, temporary link now revoked)
Sign-in: an unknown user with a wrong password is refused ("Invalid credentials."); the forgot-password control is present; demo admin and built-in superadmin both sign in; Sign Out returns to the sign-in form.
Pages opened with their own content confirmed: Overview, Devices, Alerts, Tickets, Customers (3 of 3), Automation, OS Patches, Software Patches, Scripts, Remote Terminal, Disk Management, Maintenance, Network Discovery, IoT Sensors, Reports, Billing, Usage Monitoring (admin and superadmin), Admin Panel with its 6 tabs (System Info, Audit Log, Users, Departments, Org Settings, AI Triage). No exceptions, no HTTP errors, no page errors.
Not exercised: creating or editing records, report generation, invoices, the AI Triage and assistant features (no AI key is wired into the hosted demo's dashboard), real agent enrolment, Mobile Enrollment, Client Portal.
Method note: Streamlit renders slowly; an earlier pass with short waits showed the previous page's content, so Reports, Billing, Usage and the Admin Panel were re-checked with content-based waits.

## Outstanding / recommendations (not changed)
1. Refresh the local virtual environment so the SNMP tests pass locally (above).
2. Lockout: three wrong passwords lock an account for 5 minutes, so anyone who knows an email can lock that user out briefly (rate limit 5/min per IP softens it). A product trade-off; the superadmin email is not public.
3. `reset_superadmin.py` takes the new password on the command line (visible in shell history); the superadmin's `must_change_password` is cleared by it and by startup.
4. Per the repo's CLAUDE.md, audits in that repo go to `audits/<type>-audit-<date>.md` as a separate PR; this report lives with the Dashboard audits instead.

---

## Follow-up (2026-11-16, same day): fixes requested by the owner

Four pull requests on rigwe1965/remotemanagementsystem, each from `main`, each with its own tests; CI (Backend, Dashboard, Agent, Frontend Build) is green on all four. NONE is merged and NONE is deployed to the hosted demo yet.

| PR | What | Evidence |
|---|---|---|
| #57 | Sign-in lockout per address instead of per account. Before: 3 wrong passwords locked the WHOLE account for 5 min (anyone who knew an email could keep that person out), and behind a proxy the login limit (5/min) was one bucket for everybody (5 bad logins from anywhere made another user's correct login fail with 429; reproduced with a real, enabled limiter). New: `utils/login_guard.py` (3 failures from one address lock that address; 30 failures in 15 min from never-seen addresses lock unfamiliar addresses only; familiar `known_ips` exempt; good sign-in / admin Unlock / completed reset clears the count; counted from the audit log, no migration), `utils/client_ip.py` (`TRUSTED_PROXY_COUNT`, default 0 = unchanged), dashboard sends the visitor address on sign-in / two-step / reset-request (`DASHBOARD_TRUSTED_PROXY_COUNT`). HANDOVER_GUIDE corrected (it claimed the superadmin could never be locked out; the code never exempted it). | 21 API + 23 dashboard tests, 4 fail on the old code; end-to-end probe with the limiter on: attacker locked, bob and alice sign in. |
| #58 | `reset_superadmin.py` rebuilt: no password on the command line (hidden prompt twice, `--generate`, `--stdin`); app password rules; updates `SUPERADMIN_PASSWORD` in `.env` (the API re-syncs the superadmin to it at every start, so the old script's reset was silently undone at the next restart); unlocks, ends sessions, audit row, `--reset-mfa`; file output never overwrites and is written before any change. | 28 tests; real command line checked for the refusal paths. |
| #59 | `REPORTS_INLINE=1` (opt-in): build a report inside the request when there is no Celery worker. The hosted demo has none, so Generate Report said success and never produced a file. | 5 tests, 2 fail on the old code. |
| #60 | A forced first-login password change can no longer keep the temporary password (the endpoint never compared; found on the live demo: a new client user was let in with the password the admin had set); the voluntary change refuses the current password too. | 5 tests, 2 fail on the old code. |

Live demo features exercised after the audit (headless Chrome, temporary link, revoked): creating a customer, a ticket and an invoice works; Generate Report accepts the request (the file is the #59 issue); creating a CLIENT user works, the new user is forced to the "Set New Password" screen at first sign-in (and, until #60 is deployed, could keep the temporary password); the client portal shows only that client's own ticket (1 ticket, 0 devices), no admin controls, and the Admin page refuses it by address.
Not exercised: real agent enrolment (no agent can reach the demo; covered by the API tests), Mobile Enrollment (needs Google's Android Management API), AI features (no AI key in the hosted demo, by design), the React frontend.

Test data left in the hosted RMM demo by this testing (the product's delete only partly removed it): 2 customers "ZZ Audit Test Co", 1 ticket "ZZ audit ticket", 1 soft-deleted client user row (`__deleted__...@rmm.local`), 3 generated report rows. The two invoices were deleted. Remove them by resetting the RMM demo (`deploy/reset-demos.sh rmm`), which restores the seeded state.
Local setup note: the owner's virtual environment still has pysnmp 4.4.12 (CI has 7.1.32), so 5 SNMP tests fail locally only.
