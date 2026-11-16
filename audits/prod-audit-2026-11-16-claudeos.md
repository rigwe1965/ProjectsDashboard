# Production audit: ClaudeOS / FacykeOS (demo at claudeos.demo.facyke.com), 2026-11-16

Status: audit complete. One small fix (rigwe1965/claudeOS#51, commit 30dd6e5) was deployed to the demo on 2026-11-16 with the owner's approval.

## Environments
Hetzner demo `pd-claudeos-demo` (Flask API on loopback + Streamlit dashboard; SQLite and ChromaDB in a volume; runs as uid 10001; read-only root; the Anthropic key of workspace `facyke-demos` is its only secret of value). The owner's own install runs locally on Windows (not hosted, not touched).

## Accounts
Demo database (read-only look): `demo` (admin, active, must_change_password = 0 by design: the demo reset clears the flag, see deploy/apps/claudeos/reset.sh) and `Ikechuwku` (admin, namespace "personal", must_change_password = 1, never logged in). The second account was not created by this audit and was not touched; the next reset removes it. Self-registration is off (`allow_self_register` = 0).
First-admin tooling: `scripts/create_admin.py` creates the first admin with `must_change_password = False` and takes the password on the command line (visible in shell history/process list); the demo reset passes it from an env var. Not changed (the live demo does not need it; a real install should change the password after first use, or create users from the Admin panel, which marks them must-change).
Forced change is enforced in `require_auth` (everything except change-password returns 403 while the flag is set); `change-password` refuses the same password, revokes all other sessions and tokens, and the project's tests cover it.

## Security
- Dependencies: pip-audit on the live container's exact package list (140 packages): 5 advisories in 2 packages, none reachable: chromadb 0.5.5 x3 (all concern ChromaDB's HTTP server mode/RBAC; ClaudeOS only uses the embedded `PersistentClient`, verified by grep) and pyarrow 21.0.0 (Arrow IPC-file reading with pre-buffering; the app never reads IPC files; cannot move to 23.x because chromadb 0.5.5 needs NumPy 1.x). Left unchanged.
- No command-execution path: the only subprocess is the `get_git_log` tool (fixed argument list, no shell, numeric values). The Anthropic key is never returned by any API route.
- Auth code (read): bcrypt, 5 failed logins lock for 15 minutes, hashed refresh tokens, token revocation by generation, role gates, namespace isolation enforced server-side, generic registration errors; tests cover these.
- Container: no secrets other than the demo key, non-root, read-only root; stray `*.tmp.*` editor files are git-ignored and absent from the image.
- Cost control: agent run 30/min and stream 20/min limits in the API, the gateway's per-link 600/min limit, and the $5/month spend limit on the `facyke-demos` workspace as the hard backstop.
- Tests: 933 passed, 7 skipped (931 + 2 new).

## Links and buttons (live, headless Chrome, temporary link now revoked)
Sign-in: a wrong password shows "Invalid username or password."; the demo admin signs in; Logout returns to the sign-in form.
Pages loaded through the dashboard URL parameter: Overview, Agents, Memory, Projects, Outputs, Tickets, Observability, Settings, Admin: all fine, no exceptions, no HTTP errors, no page errors. Workflows: showed "API unreachable" (finding below).
AI path: Agents > Chat: 12 agents listed, one agent answered a one-word prompt in 1.5 s using 121 tokens.
Not exercised: workflow runs, webhooks, ticket creation, file uploads, voice, Supabase sync, email (no mail account in the demo).

## Finding fixed in the repo (not yet deployed)
The Workflows page said "API unreachable" although the API answered 200: `api_get()` returns `None` on failure and `[]` for an empty list, and the page tested `if not data`, so the existing "No workflows found" message could never show. The demo has 0 workflows (the reset does not seed any, deliberately: scheduled workflows would spend the AI key). Fix: `if data is None` + `tests/test_workflows_empty_state.py` (fails before, passes after). Branch `fix/workflows-empty-state-message`, commit 30dd6e5, PR #51.
Deployed (approved): fast-forwarded `/srv/apps/ClaudeOS` 6f0d4d9 -> 30dd6e5 (bundle), tagged `pd-claudeos:rollback-20261116` first, `docker compose --profile apps build claudeos-demo`, `up -d --no-deps claudeos-demo`; the data volume is kept. Rollback: `docker tag pd-claudeos:rollback-20261116 pd-claudeos:latest`, `docker compose --profile apps up -d --no-deps claudeos-demo`, `git reset --hard 6f0d4d9` in /srv/apps/ClaudeOS.
Verified after deploy: container healthy, 0 restarts, no tracebacks; headless Chrome through a temporary link (revoked): wrong password refused, demo admin signs in, all 10 pages load with no exceptions or HTTP errors, Workflows now shows 'No workflows found', logout works. The PR is open, not merged.

## Outstanding / recommendations (not changed)
- `audits/security-audit-2026-10-17.md` lists known gaps, e.g. M-14 (operators can create API keys); not re-audited here.
- The demo image contains the project's own audit documents and CLAUDE.md (no route serves files from there; path-traversal tests exist).
- `create_admin.py` password on the command line (above).
