# Production audit: ClaudeWorkspace / RECI Transport (car rental), 2026-11-16

Status: audit complete and fixes deployed, except the customer-site production deploy (see "Deployment status" at the end).

## Environment
- Source: monorepo rigwe1965/RECI (private), `ClaudeWorkspace/reci-transport` locally. Customer web (Next.js 15, port 3002), admin portal (`/admin`), mobile app (Expo, not deployed), Supabase (Postgres + RLS + Auth), Stripe, Resend, Anthropic.
- Production: Vercel (web `web-lilac-nine-19.vercel.app`, admin `admin-umber-seven.vercel.app/admin`) on Supabase project `ewrknf...`. Manual deploys (`vercel deploy --prod`), see the RECI notes.
- Hosted demo: Hetzner `pd-claudeworkspace-web` + `pd-claudeworkspace-admin` (one image), behind the demo gateway, on a SEPARATE Supabase demo project (`xexlrw...`, confirmed different from production). Payments, email, AI and monitoring keys are deliberately not set in the demo.
- The server's copy of the source is a plain file copy from 2026-11-06 (not a git checkout).

## Accounts
- Production: no new account created or changed. The only admin is the owner's own login (promoted 2026-11-15); roles are customer / staff / admin (admin is the top role, there is no separate Super Admin).
- Demo: `admin@reci-demo.example` (admin) and `customer@reci-demo.example` (customer); passwords come from the server settings and are restored by the demo reset. Both entries are in the owner's credentials file (entry 7).
- Forced first-login change: admin-created users get a generated temporary password (`Reci-XXXXXXXX!`, shown once) and `password_reset_required = true`. Verified live: the new user is forced to the reset screen, cannot skip it by address, cannot keep the temporary password ("different from the old password"), and a short password is refused. **But finishing the change did not work (finding 1).** The temporary users created by this audit were deleted.

## Findings

### 1. High (functional): new staff/admin users can never finish the forced password change
The admin middleware refuses every API call while `password_reset_required` is set, including `POST /api/admin/users/<id>/clear-reset`, the call that clears the flag. The reset screen showed "Password updated", then sat on "Redirecting to dashboard..." and the flag stayed `true` (verified by reading it back), so the user was sent back to the reset screen at every sign-in. Every account created from the admin portal was unusable. Also present in production code. The owner's own admin account is unaffected (no flag).
Fix: allow exactly that one POST through the middleware (`isClearResetPath`, 2 tests); the route already checks the caller is that user.

### 2. High (functional): Calendar returns 500 for anyone in a timezone east of UTC (Berlin)
The page sent `start=...T00:00:00+01:00` unencoded; the `+` reached the server as a space and Postgres rejected it (`invalid input syntax for type timestamp with time zone`). Fix: the page encodes both dates, and the API also reads the stray space back (`normalizeIsoOffset`, 3 tests).

### 3. High (functional): the AI licence and damage review queues can never show anything
Human review of AI results is the product's safety net ("AI never auto-commits"), and it was dead twice over:
- Licence list: the query joined `licence_verifications` to `user_profiles`, but the foreign key points at `auth.users`, so PostgREST answered 500 every time.
- Both lists and the dashboard counters filtered on `admin_override IS NULL`, but the column defaults to FALSE (migration 003), so no row ever matched.
Fix: licences wait while `status = 'pending'` (a decision changes the status) and people are looked up in a second query; damage reports wait while `admin_override_at IS NULL` (a decision stamps it). No database change needed. NOT yet verified with real data: the demo has no pending licence or damage rows, so after deploy the list should load empty with no 500; a real end-to-end check needs one AI licence upload.

### 4. Low: invalid Content-Security-Policy source on every page
`connect-src ... https://o*.ingest.sentry.io` is not a valid source (a wildcard may only replace a whole leading label); browsers log an error on every page and ignore the token, so error reports to Sentry would be blocked. Fixed in both middlewares with `*.ingest.sentry.io` (plus `.de.` and `.us.`).

### 5. High (security, demo only): the hosted demo runs Next.js 15.5.24
Production was upgraded to 15.5.29 on 2026-11-14 for a critical remote-code-execution fix; the Hetzner demo images were built from the 2026-11-06 copy and still run 15.5.24 in both containers (the admin container is also an older image than the web one). The demo is only reachable through the gateway's links and holds only the demo Supabase service key, but it should be rebuilt from current `main`. Plan: replace the server copy with a git checkout of the fixed branch, rebuild `pd-claudeworkspace`, recreate both containers, then reset the demo.

## Security review (read, no change needed)
- Production seen from outside (read-only): all security headers set on both sites (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, CSP with nonce); every admin API and page refuses an anonymous caller (401, or 307 to the login); account, loyalty, delete-account, cron and API-key routes answer 401/403; the Stripe webhook answers 400 without a signature.
- The public database key (anon) reads ZERO rows from user_profiles, bookings, payments, licence_verifications, ai_conversations, api_keys, admin_audit_log, loyalty and corporate tables; only the vehicle catalogue (24), extras (18) and locations (2) are public. The privileged functions are not callable by the public key. No write was attempted against production.
- Code (read): prices computed on the server; booking availability re-checked; loyalty points redeemed in a locked database function; Stripe webhook signature-verified and idempotent; payment intent amount taken from the stored booking; image upload checks type, size and file signature; account deletion anonymises bookings; cron route uses a timing-safe secret compare; API keys stored hashed with an atomic daily limit; admin routes wrapped in `withAdminAuth` with an admin-only variant.
- Dependencies (`pnpm audit --prod`, whole workspace): 162 findings, but 85+ are in the unpublished mobile app and the web/admin ones are almost all build tooling (postcss, rollup, brace-expansion, browserslist, nanoid, fast-uri, source-map-js). On the runtime path: `dompurify` 3.4.12 (critical, only via posthog-js analytics), `qs` 6.15.1 (via the Stripe SDK; needs attacker-controlled stringify input), `zod` 3.25.76 (memory exhaustion on oversized arrays; upgrade is a major version). Not changed: a dependency refresh of a payments app belongs in its own change with a build and checkout test. Recommended next step: add package overrides for `qs >= 6.16.1` and `dompurify >= 3.4.17`, rebuild, test a booking, deploy.

## Not changed, owner decisions
1. **Unpaid bookings never expire.** Every guest booking is created as `pending` and blocks the vehicle's dates until cancelled; nothing cancels or ignores stale pending bookings. A stranger (10 requests per minute per address) can block a vehicle's dates, or the whole fleet, without paying. Proposed fix: ignore `pending` bookings older than 30 minutes in the availability and conflict checks (and a periodic cleanup). It changes a business rule, so it is waiting for the owner.
2. Creating a staff user for an email that already has an account silently replaces that person's password and role (admin-only action; the temporary password is shown to the admin). Suggest a confirmation or refusing existing customer accounts.
3. Password policy at the reset screen is "at least 8 characters" only.
4. `x-powered-by: Next.js` is sent (cosmetic).
5. GitHub Actions on RECI does not start (billing), so none of these changes have run in CI; they were checked locally: type-check (web and admin), lint (warnings that were already there), unit tests (web 31, shared utils 20), and a production build of the admin app.
6. Production Stripe and Resend settings are still missing (see the RECI notes); payments and email cannot work in production until they are set. Not testable in the demo by design.

## Tests and live check
- Local on a clean clone of `main`: type-check web and admin clean; web jest 31 passed; shared utils vitest 15 passed (20 with the new tests); admin production build OK. (The owner's local checkout is behind `main` and its global pnpm is broken; a scratch clone with pnpm 9.15.0 was used.)
- Hosted demo, headless Chrome through a temporary link (now revoked): customer site home, 45 internal links (all vehicle and booking links), privacy, terms, register, login, forgot-password, vehicle page, wrong password refused, account page redirects to login; admin: anonymous redirected, wrong password refused, demo admin signs in, all 14 admin pages open with content, the 13 sidebar links resolve, sign-out works. Only HTTP errors seen: the two 500s above (calendar, licence reviews). No page errors.
- Not exercised: payment (no Stripe in demo), email, AI features (no key in the demo), the mobile app, the booking flow past the driver step.

## Follow-up the same day: owner approved the fixes, the 30-minute rule and the dependency refresh
Added on top of the findings above (all PRs on rigwe1965/RECI, NONE merged):
- #3 `fix/admin-calendar-and-licence-reviews`: findings 1-4, plus two more things found while verifying live: after the flag was cleared the reset screen still stuck on "Redirecting..." because the client router reused a cached bounce-back answer (now a full page load), and the calendar's arrow icons were empty boxes because the CSP blocked the inline icon font (`font-src` now allows `data:`).
- #4 `fix/pending-booking-expiry`: unpaid bookings hold their car for 30 minutes (owner decision), in booking create, vehicle search, vehicle availability, AI search, pricing signals and the demand cron; `payments/intent` answers 410 for an expired hold. Paid bookings never expire.
- #5 `chore/dependency-overrides-qs-dompurify`: qs 6.15.1 -> 6.17.1, dompurify 3.4.12 -> 3.4.18. A PaymentIntent request built by the real Stripe SDK against a local stand-in server encodes correctly; web build, tsc and tests pass.
Checks on the merged deploy branch: utils vitest 24, web jest 31, tsc web and admin clean.

## Deployment status (2026-11-16)
- Hetzner demo: DEPLOYED. Source replaced by the deploy branch (old copy kept at `/srv/apps/ClaudeWorkspace/reci-transport.bak-20261116`, old image tagged `pd-claudeworkspace:rollback-20261116`). Both containers now run Next.js 15.5.29 and are healthy. Verified live with a temporary link: the forced change now finishes and opens the dashboard, a short password and the temporary password are refused, the staff user cannot reach Users (403), calendar returns 200 even with a raw `+01:00`, licence and damage review lists return 200, dated vehicle search (new 30-minute filter) returns vehicles, calendar icons load, no CSP errors. The temporary staff user was deleted. The demo has not been reset yet (other demo links must end first).
- Production ADMIN (Vercel): DEPLOYED (deployment `dpl_5ZqtkuD48Ndyu96CbYau7GFEM9ou`, `admin-bfiustuai-obinwanne1s-projects.vercel.app`). Rollback: promote the previous admin deployment `admin-nhqx6l2ir`. Smoke test: new CSP is served, anonymous callers still get 401 on every admin API including clear-reset.
- Production WEB (Vercel): NOT deployed. It carries the 30-minute rule, the qs/dompurify refresh and the Sentry CSP fix. Waiting for the owner's explicit approval; rollback target would be `web-mtjr9dqpq`.
- Still open: the demo reset; a real end-to-end check of the licence and damage queues needs one AI upload with data; owner decisions on the existing-user password overwrite and the 8-character minimum.
