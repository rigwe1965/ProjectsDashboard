# Production audit: Airfinder (demo at airfinder.demo.facyke.com), 2026-11-16

Status: audit complete. One change was made with the owner's approval and deployed 2026-11-16: dependency refresh (commit 8ed15b6 on branch `fix/dependency-refresh`; see 'Deployed change').

## Environments
Only the Hetzner demo is live (shared `pd-airfinder-demo` container, SQLite in a volume). render.yaml exists but nothing answers at the expected Render hosts.

## Architecture / accounts
Flask + SQLAlchemy + JWT + bcrypt; vanilla JS frontend. Roles: super_admin > admin > agent > finance > customer.
Live demo database (read-only look): 1 staff account (SUPER_ADMIN `demo@facyke.com`, active, `must_change_password` = 0 by design), 10 seeded customers, 30 seeded bookings.
The Super Admin comes from the server settings AIRFINDER_ADMIN_EMAIL / AIRFINDER_ADMIN_PASSWORD (never hard-coded in the source; the app refuses to start without them and rejects weak/default values outside development).
The demo reset (`deploy/apps/airfinder/reset.sh`) deliberately clears the forced-change flag: the demo is re-seeded on every reset and the admin is the owner-only login.

## Security (code read + tests + live)
- Auth: JWT HS256 (12 h) re-validated against the DB on every request (role, active flag, token_version); role/email/active/password changes bump token_version; bcrypt; login rate limits per IP and per email; forgot-password never reveals whether an email exists; reset tokens expire (staff 1 h, customer 15 min).
- Forced first-login change, verified end to end on a scratch database (13 checks): the initial-password token gets 403 on every admin route; change to the same password refused (400); short or wrong-current refused (400); after the change the old token is dead (401) and the initial password no longer logs in.
- RBAC: hierarchy enforced when creating/modifying staff and resetting passwords (an admin cannot touch an equal or higher role; only super_admin deletes); customers reach only their own bookings; a customer token on `/api/admin/dashboard` -> 403 (live).
- Booking prices are server-signed quotes (QUOTE_ENFORCE); card fields are formatted in the browser only and never sent to or stored by the backend.
- Headers: strict CSP (`script-src 'self'`, no inline scripts), nosniff, X-Frame-Options DENY, HSTS; names/emails reject `<` and `>` server-side; admin tables escape customer-supplied text (spot-checked, not exhaustive).
- Tests: 63 passed locally (including `test_security.py`, 377 lines).

## Links and buttons (live, headless Chrome, temporary link now revoked)
Home page: 9 internal links, none broken; featured route cards load; flight-status lookup works; LOS to LHR search returns 5 flights; multi-city page loads; all auth pages and staff login/forgot pages load.
Customer: wrong password refused; sign-in; dashboard, bookings and profile load; a real booking made end to end (passengers, add-ons, payment step, confirmation) and cancelled from My Bookings; signed-out visit to the account is bounced to login.
Staff: wrong password refused; sign-in; dashboard, bookings, customers, finance, staff, settings, profile and change-password pages all load with data; the four admin APIs return 200; change-password with a wrong current password is refused. No page errors; the only HTTP errors were the two deliberate wrong-password 401s.
Side effect: one new booking (made and then cancelled) was left in the shared demo data; the next demo reset removes it.

## Dependency scan (pip-audit on requirements.txt)
| Package | Advisory | Reachable here? |
|---|---|---|
| flask 3.0.3 | PYSEC-2026-2151: `Vary: Cookie` missed in some session accesses | No: the app uses JWT, not Flask sessions |
| flask-cors 4.0.1 | PYSEC-2024-71 (Private-Network header), PYSEC-2026-1383/1384/1385 (path matching: case, regex order, `+`) | Not exploitable in this config: one rule `/api/*`, explicit origin list, Flask routes are case-sensitive; low |
| python-dotenv 1.0.1 | PYSEC-2026-2270 symlink in `set_key`/`unset_key` | No: the app only reads .env |
| pytest 8.2.2 | PYSEC-2026-1845 | Dev only; not installed in the demo image |
Tested in a throwaway environment: flask 3.1.3 + flask-cors 6.0.2 + python-dotenv 1.2.2 (+ pytest 9.0.3): 63 tests pass and pip-audit reports no known vulnerabilities.

## Deployed change (approved by the owner)
`requirements.txt`: flask 3.0.3 -> 3.1.3, flask-cors 4.0.1 -> 6.0.2, python-dotenv 1.0.1 -> 1.2.2, pytest 8.2.2 -> 9.0.3. Nothing else changed.
Before: image tagged `pd-airfinder:rollback-20261116`. Server `/srv/apps/Airfinder` fast-forwarded 5d464cc -> 8ed15b6 (git bundle); `docker compose --profile apps build airfinder-demo`; `up -d --no-deps airfinder-demo`.
Rollback: `docker tag pd-airfinder:rollback-20261116 pd-airfinder:latest`, then `docker compose --profile apps up -d --no-deps airfinder-demo` in deploy/, and `git reset --hard 5d464cc` in /srv/apps/Airfinder.
Verified after deploy: container healthy, 0 restarts, no errors in its logs; pip list shows the new versions; CORS probe inside the container (unknown origin gets no Access-Control-Allow-Origin, the allowed origin does, no Private-Network header, a case-variant path `/API/...` gets nothing); headless Chrome through a temporary link (revoked): home links, search, customer sign-in and pages, customer token -> 403 on the staff API, staff sign-in, all 8 staff pages with data, change-password refusal; no page errors; the only HTTP errors were the two deliberate wrong-password 401s. Other containers unaffected.
Not pushed to GitHub yet: the local origin is the dead Obinwanne1 URL; the server's is github.com/rigwe1965/Airfinder.

## Outstanding / recommendations (not changed)
1. (done, see above)
2. The app keeps no password history: after the forced change, a staff member could later set the password back to the initial one. The initial password stops working after the change, and it is never stored in code. A real fix needs a new column (migration); judged not worth it for a demo.
3. Staff and customer login: an unknown email is rejected faster than a wrong password (timing could reveal registered emails; registration already reveals "Email already registered"). A JSON `null` body gives a generic 500 instead of a 400. Low.
4. The `finance` role can cancel any booking via `POST /api/bookings/<id>/cancel`; confirm whether that is intended.
5. `seed_demo.py` sets every demo customer's password to `Demo@2024!`: fine for the sandbox, but it must never be run against real data.
6. Reset tokens are stored unhashed in the database (they expire in 15 to 60 minutes).
7. `localStorage` holds the login token; the strict CSP limits script injection.
8. Not exercised: forgot-password email flow (the demo has no mail account), and the multi-city booking submit.
