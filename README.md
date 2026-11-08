# ProjectsDashboard

Orchestration and showcase layer for independent apps. It references the apps by path and never modifies them.

**Source of truth for each app is its Desktop folder** (`C:\Users\rigwe\Desktop\<App>`). The same-named folders inside this directory are stale copies, git-ignored and not used.

Full explanation of how everything fits together: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Layout
- `registry/apps.json`: one entry per app (path, start command, proposed port, health URL, demo support)
- `supervisor/`: process control (only `status` exists so far)
- `admin-console/`: owner-only console (placeholder)
- `showcase/`: public product pages (placeholder)
- `demo-gateway/`: time-limited, single-app demo links (placeholder)
- `data/`: the dashboard's own runtime data (git-ignored)

## Try it
`npm run status` checks which registered apps are currently responding. It is read-only.

## Rules
Never edit the apps, their .env files, databases or repos. Anything that would need that requires explicit approval first.

## Supervisor commands
```
node supervisor/index.mjs status
node supervisor/index.mjs start <app> [--only=proc]
node supervisor/index.mjs stop <app> [--only=proc]
node supervisor/index.mjs restart <app> [--only=proc]
```
Apps: airfinder, claudeos, rmm, crm, claudeworkspace, imageapp. Optional processes (e.g. the RMM Streamlit UI) start only with `--only=`.
Logs go to `data/logs/`; PIDs are tracked in the database (`data/dashboard.db`, one row per process). Stop only ever kills PIDs the supervisor started itself.

## Admin console
`npm run console` prints a tokenized localhost URL (token mode).

**Password login (recommended):** run `npm run console:auth -- set-password`, then `npm run console:auth -- enable-totp` to add a 2-step code from an authenticator app. After that the console shows a sign-in page instead of the token URL (the token URL stops working). Other commands: `status`, `disable-totp`, `remove-password`, `sign-out-all`, `gen-key`. To keep the 2-step secret encrypted in the database, run `npm run console:auth -- gen-key` and set the printed value as `ADMIN_DATA_KEY` in the console's environment (outside the dashboard folder); the console encrypts the stored secret the next time it starts, and warns while the key is missing. If the key is lost, run `disable-totp` and `enable-totp` again. Passwords use scrypt at the current recommended cost; an older hash is upgraded automatically at your next sign-in. Sign-in attempts are limited (8 per IP and 40 overall per 15 minutes) and every login, failed login and credential change is in the audit log. To reach the console from another machine set `ADMIN_BIND`, `ADMIN_ALLOWED_HOSTS` and `ADMIN_SCHEME=https`; it refuses to listen beyond localhost until a password is set.

It shows each app's processes with status, Start/Stop/Restart, Open and Log buttons. Closing the console never stops the apps.

## Showcase
`npm run showcase` builds the static public site from `showcase/products.json` and previews it at http://127.0.0.1:4200/.

## Hosting it online
See `deploy/README.md`: Docker Compose with Postgres, Caddy (automatic HTTPS) and optional app containers. Locally it still runs on SQLite with no Docker needed.

## Tests
`npm test` (unit tests), `npm run lint`, `npm run test:e2e` (customer journeys; needs the demo instances running). With `TEST_DATABASE_URL=postgres://...` set, the same store tests also run against Postgres. CI runs everything on Windows and Linux.

## Demo gateway
See `demo-gateway/README.md`. Ready now: `imageapp`, `airfinder`, `crm`, `claudeworkspace`, `claudeos`, `rmm` (each runs as its own isolated demo instance).
