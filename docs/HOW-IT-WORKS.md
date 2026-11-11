# How ProjectsDashboard works

ProjectsDashboard is the control and showcase layer for your separate apps (CRM, ImageApp, Airfinder, ClaudeWorkspace, ClaudeOS, Remote Management System). It **references the apps by path and never modifies them**. Each app stays in its own Desktop folder with its own `.env`, database and repository.

## 1. The big picture

```text
                         registry/apps.json  (what exists, where, how to start it, which port)
                                  |
        ┌─────────────────────────┼─────────────────────────────┐
   Supervisor               Admin console :4100            Demo gateway :4300
   start/stop apps          owner-only web UI              time-limited customer links
        |                          |   uses supervisor,           |
        |                          |   grants and audit           |
   your apps (real)                +──────────────────────────────+
   crm :3101 ...                                             demo instances (isolated copies)
                                                             crm-demo :3111 ...
   Showcase :4200  ── static public product pages, built from showcase/products.json
   Store: data/dashboard.db (SQLite)  ── process records, demo grants, audit log
```

| Part | Folder | Port | Who uses it | What it does |
| --- | --- | --- | --- | --- |
| Registry | `registry/apps.json` | – | everything | The single list of apps: path, start command, port, health URL, demo support |
| Supervisor | `supervisor/` | – | you / console | Starts, stops, restarts and reports on apps |
| Admin console | `admin-console/` | 4100 | you only | Web UI: app status and controls, logs, demo links, activity feed |
| Showcase | `showcase/` | 4200 | the public | Static marketing pages for each product |
| Demo gateway | `demo-gateway/` | 4300 | customers | Gives one customer time-limited access to one product's demo copy, and counts what they did with it |
| MCP server | `mcp/` | – (stdin/stdout) | your AI assistant | Lets an assistant read the dashboard (and, if you allow it, create and revoke links) |
| Store | `lib/store/`, `data/` | – | all | SQLite database (`data/dashboard.db`) or Postgres when hosted |

Ports 4100, 4200 and 4300 can be changed with `CONSOLE_PORT`, `SHOWCASE_PORT` and `GATEWAY_PORT`.

## 2. Double-click launchers

All four are in the project root. Each starts its service, waits until it really responds (not just a fixed delay), opens your browser, and will not start a second copy if the service is already running. If something fails they print the reason and pause.

| File | Starts | Opens |
| --- | --- | --- |
| `start-console.bat` | Admin console | `http://127.0.0.1:4100/` |
| `start-showcase.bat` | Builds and serves the showcase | `http://127.0.0.1:4200/` |
| `start-crm.bat` | Your **real** CRM from `Desktop\CRM` | `http://localhost:3101/sign-in` |
| `start-customer-demo.bat` | Gateway + the chosen product's **demo** instance | `http://<product>.localhost:4300/d/<token>` |

- `start-customer-demo.bat` shows a menu (1 CRM, 2 ImageApp, 3 Airfinder, 4 ClaudeWorkspace, 5 ClaudeOS, 6 Remote Management). From a terminal you can pass the name instead, for example `start-customer-demo.bat imageapp`.
- The console and showcase run in their own minimized window; closing that window stops them. The apps, gateway and demo instances run in the background and keep running when you close the console.
- Each demo launch creates a fresh 8-hour link for a customer named "Local owner", recorded in the audit log.
- Logs are in `data\logs\`.

## 3. Real apps vs demo copies

This is the most important distinction.

- **Real apps** (for example CRM on :3101) use your real data and your real accounts.
- **Demo instances** (for example `crm-demo` on :3111) are separate copies with their own database and sample data. They run from a clone under `data/demo-src/` and read their settings from the dashboard's own env files in `data/` (for example `data/crm-demo.env`), never from the app's `.env`.
- Customers only ever reach a demo instance, through the gateway.

Demo-ready products today: **CRM, ImageApp, Airfinder, ClaudeWorkspace, ClaudeOS, Remote Management (RMM)**. Set `demoReady: true` only after confirming the demo shares no data with the real app.

**ClaudeOS demo** (`claudeos-demo`, UI :8611, API :5110): runs from a clone in `data/demo-src/claudeos` with its own SQLite/Chroma files, freshly seeded agents and one demo admin (`demo`). Supabase sync, email and memory import are unset. It uses the real ClaudeOS Python venv read-only and carries the owner's Anthropic key (`data/claudeos-demo.env`), so AI actions cost money.

**RMM demo** (`rmm-demo`, UI :8711, API :5310): runs from a clone in `data/demo-src/rmm` against its own Postgres (:5433) and Redis (:6380) Docker containers (`pd-rmm-demo-pg`, `pd-rmm-demo-redis`, started automatically by `supervisor/demo-fixes/rmm_demo_api.py`). All customers, devices, alerts and tickets are simulated (`supervisor/demo-fixes/seed-rmm-demo.py`). The API listens on 127.0.0.1 only, so no real agent can enrol. There is no Celery worker, so scheduled jobs, backups and email do not run. The AI assistant uses the RMM's own Anthropic key with agentic tools and triage switched off. Demo logins are the seeded values in `data/rmm-demo.env` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

Demo CRM sample users are `admin@crm.test`, `sales@crm.test` and `support@crm.test`. Their shared password is the `SEED_USER_PASSWORD` value in `data/crm-demo.env`.

## 4. The registry (`registry/apps.json`)

One entry per app, with these key fields:

- `path`: the app's folder (`${APPS_ROOT}` expands to the Desktop, `${DASHBOARD_ROOT}` to this project).
- `processes[]`: each process has a `cmd`, `cwd`, `port`, `health` path, optional `env` and `envFile`, an optional `passEnv` list (names or `PREFIX_*` copied from the supervisor's own environment; only the dashboard's own gateway uses it), and may be `optional` (started only with `--only=`).
- `demoOf` and `demoReady`: mark a demo instance and whether the gateway may serve it.
- Placeholders in commands and env values: `{port}`, `{url}`, `{port:NAME}`.

| Entry | Ports |
| --- | --- |
| airfinder / airfinder-demo | 5200 / 5210 |
| claudeos (api, ui) | 5100, 8601 |
| rmm (api, ui) | 5300, 8701 |
| crm / crm-demo | 3101 / 3111 |
| claudeworkspace (web, admin) / demo | 3102, 3103 / 3112, 3113 |
| imageapp / imageapp-demo | 5400 / 5410 |
| gateway | 4300 |

Port 3000 is reserved because it belongs to an unrelated process.

## 5. Supervisor

```text
node supervisor/index.mjs status
node supervisor/index.mjs start <app> [--only=proc]
node supervisor/index.mjs stop <app> [--only=proc]
node supervisor/index.mjs restart <app> [--only=proc]
```

Safety rules built in:

- It never reads or writes an app's `.env` and never writes into an app folder.
- It refuses to start a process whose port is already in use or reserved, and checks all ports before starting anything.
- It records each PID it starts. `stop` only kills PIDs it recorded, and only if the process start time still matches (this guards against a reused PID). It never kills by port or by name.
- App environment variables are set on the child process only.

## 6. Admin console

Run `npm run console` (or `start-console.bat`). It binds to localhost only.

- **Token mode (default):** each launch prints a one-time URL containing `?t=<token>`.
- **Password mode (recommended):** set up with `npm run console:auth -- set-password`, then `enable-totp` for authenticator codes. The token URL is then switched off. Other commands: `status`, `disable-totp`, `remove-password`, `sign-out-all`. Sign-in attempts are rate limited and every login and credential change is audited.
- **Panels:** each app's processes with status and Start/Stop/Restart/Open/Log buttons, the Demos panel (create and revoke links), and a read-only Activity panel (sign-ins, changes, demo opens and refusals).
- **Activity column:** each link shows *Not opened*, *Opened*, *Engaged* (a minute or more of use) or *Came back* (two or more days), with a Details view of days and busiest pages. The numbers come from the gateway's activity counting (section 7); the console only reads them.
- To reach it from another machine you must set `ADMIN_BIND`, `ADMIN_ALLOWED_HOSTS` and `ADMIN_SCHEME=https`, and it refuses to listen beyond localhost until a password is set.

## 7. Demo gateway and demo links

```text
npm run gateway
npm run demo -- create --customer "Acme" --app crm --hours 48 [--max-uses 3] [--device-lock]
npm run demo -- list
npm run demo -- revoke <id>
```

How a customer visit works:

1. You create a link for one customer and one product. The link is shown **once**; only a SHA-256 hash is stored.
2. The customer opens `http://<product>.localhost:4300/d/<token>`.
3. The gateway checks the grant (not expired, not revoked, within its use limit, device lock if set), then gives the browser a separate random session cookie. The link token itself is never reused as a cookie.
3b. The page where the customer opens the link can be branded: a name ("Prepared for ..."), a welcome note, the time the link has left, your brand name (`DEMO_BRAND_NAME`) and a "Book a call" link (`DEMO_BOOKING_URL`). See `demo-gateway/README.md`.
4. The session is re-checked on every request, so expiry and revocation apply immediately. Open WebSockets are re-checked every few seconds.
5. Requests are proxied to that product's demo instance only. A link works only on its own product's host.

Protections: per-IP and per-link rate limits, a temporary ban for repeated bad links, strict security headers on the gateway's own pages, and an audit entry (with IP and browser) for every grant, open, denial and revocation. Audit events are kept 90 days (`AUDIT_RETENTION_DAYS`). The gateway also counts, per link and day, how many requests were made, for how long the customer was active and which pages they used (never the address, the query string or what was typed); the console shows this as an Activity column, it is kept as long as the audit events, and "Forget" deletes it. The customer is told on the page where they open the link. Details: `demo-gateway/README.md`, "What is recorded about a link".

Links look like `localhost:4300` addresses today, so they only work on your own computer. They become public once the dashboard is hosted and `DEMO_BASE_HOST` / `DEMO_SCHEME=https` are set.

## 8. Showcase

Edit `showcase/site.json` (brand, contact) and `showcase/products.json` (product copy), then run `npm run showcase`. It builds static HTML into `showcase/dist/` and serves it at `http://127.0.0.1:4200/`. The output has no scripts and no links to running apps, so it can be hosted anywhere. `"published": false` keeps a product off the site. Keep ports, paths and vendor internals out of the copy.

## 9. Data and storage

- `data/` is git-ignored and holds runtime data: `dashboard.db`, `logs/`, demo env files, demo source clones.
- The SQLite database stores process records, demo grants, the audit log and the per-link activity counts (`grant_activity`). Set `DASHBOARD_DB=postgres` to use Postgres instead (used when hosted).
- Older JSON files are imported automatically the first time and kept as a backup. `npm run migrate` re-checks the import.

## 10. Commands

| Command | Purpose |
| --- | --- |
| `npm run status` | Which registered apps are responding (read-only) |
| `npm run console` | Start the admin console |
| `npm run console:auth -- <cmd>` | Console password and 2-step codes |
| `npm run gateway` | Start the demo gateway |
| `npm run demo -- <cmd>` | Create, list and revoke demo links |
| `npm run showcase` / `showcase:build` | Build and preview / build only |
| `npm run mcp` | MCP server for an AI assistant (read-only unless `MCP_WRITE=1`; normally started by the assistant, see `mcp/README.md`) |
| `npm test` | Unit tests |
| `npm run lint` | ESLint |
| `npm run test:e2e` | Customer journeys (needs demo instances running) |

CI (`.github/workflows/ci.yml`) runs lint, unit tests and the showcase build on Windows, and the store tests against Postgres on Linux.

## 11. Hosting later

Hosting is planned for later; the local setup is the working state. `deploy/README.md` describes the intended setup: Docker Compose with Postgres, Caddy for automatic HTTPS, three domains (showcase, console, wildcard for demos), and optional app containers. The hosted console refuses to start until a password is set. Locally everything keeps working on SQLite with no Docker.

## 12. Rules to keep

- Never edit the apps, their `.env` files, databases or repositories without explicit approval.
- Never mark a demo `demoReady` unless it has its own data.
- Never put real credentials in the registry or showcase copy.
- Timestamps in the CRM database are stored as UTC without a time zone. When writing to it directly, use `now() at time zone 'UTC'`, or sessions will be rejected.

## 13. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| CRM sign-in says "Invalid email or password" on the demo | You are using a real-CRM or default password; the demo uses `SEED_USER_PASSWORD` from `data/crm-demo.env` |
| Signs in, then bounces back to the sign-in page | Password-change time in the database is in the future (time zone mistake, see rule above) |
| Launcher says "already running" but the page is wrong | A different process owns the port; check `node supervisor/index.mjs status` |
| Demo link says expired or revoked | Create a new one; links cannot be recovered |
| An app will not start | Read `data\logs\<app>-<process>.log` |
| A demo menu choice is missing | That product is not `demoReady` in the registry |
