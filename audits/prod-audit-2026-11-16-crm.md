# Production audit: CRM (demo + Vercel production), 2026-11-16

No CRM code, database or setting was changed. Everything below was read-only; temporary credential files were deleted.

## Environments
- Hetzner demo `crm.demo.facyke.com` (shared sandbox, wiped on reset; seed accounts are the public demo logins).
- Vercel Preview (throwaway, own database `ivycandy-preview`).
- Vercel Production `ivycandy-crm` (https://ivycandy-crm.vercel.app, deployed 2026-11-05; no custom domain yet).

## Security
| Check | Result |
|---|---|
| `npm audit --omit=dev` | 0 vulnerabilities |
| `tsc --noEmit` | clean |
| Sign-in / reset / sessions (code read) | dummy-hash timing equalisation, per-IP+account throttle, sessions invalidated by `passwordChangedAt`, suspended or deactivated users refused, admins held to a restricted session until 2-step enrolment, magic links refused for 2-step accounts |
| Public sign-up | closed (`/sign-up` 404; `/api/signup` off unless `SIGNUP_ENABLED`) |
| Production headers | nonce CSP, HSTS (2y, includeSubDomains), X-Frame-Options DENY, nosniff, Permissions-Policy; cookies `__Host-` / `__Secure-`, HttpOnly, Secure |
| Production unauthenticated API | `/api/me`, `/api/contacts`, `/api/admin/users` -> 401 |
| Production database (read-only) | restricted role `crm_app` exists (no superuser, no RLS bypass); RLS on for 36 tables, off only for Account, Session, VerificationToken, JobRun, _prisma_migrations (expected); 52 migrations applied, latest matches the repo |
| Earlier audit | SECURITY_AUDIT.md: 13 findings, all fixed, consistent with the code read today |

## Links and buttons (demo, signed in as demo admin, read-only)
Visited dashboard, contacts (+ detail pages), companies (+ detail), deals, invoices (+ detail), stock, tasks, activities, reports, settings, terms, privacy, dpa, forgot-password, sign-in: all 200, no page errors, no HTTP >= 400 at normal pace. A fast crawl hit the gateway's 429 rate limit (600 req/min per link): working as designed.

## Tests
`vitest run`: 134 files passed, 14 skipped; 1370 tests passed, 187 skipped (DB-backed tests need a test database: NOT verified).

## Accounts
Production has exactly one user: the owner's own ADMIN account (active, 2-step on, password set by the owner), in tenant "Ivycandy Hair" (plan starter). Production data: 2 contacts, 0 deals, 0 invoices. No admin was created or changed. Decision (owner, 2026-11-16): skip the forced-first-login code change, since no first admin is needed and the live sign-in path stays untouched. If admin-created users should get temporary passwords later, plan: `mustChangePassword` column (additive), reuse the `mfaPending` gate, `make-admin --temp-password`.

## Outstanding
1. The live Production app does NOT use Neon project `ivycandy-crm` (Frankfurt; its `production` branch has been archived since 2026-11-11, last compute activity 2026-11-01). It uses a different Neon project on `ep-tiny-surf-b86hc7ck.c-14.us-east-1.aws.neon.tech` (Vercel integration, US-East, not visible to the Neon MCP). The app's own `DATABASE_URL` is masked, so "same database" is inferred (full CRM schema + the owner's admin found there, `/api/health` OK), not proven. LAUNCH_RUNBOOK says Frankfurt; EU residency and latency (functions are pinned to fra1) are open. Owner decided: plan only, later; nothing moved.
2. The Frankfurt `ivycandy-crm` project looks like an unused leftover; not inspected, not deleted.
3. 187 DB-backed tests unverified.
