# ProjectsDashboard

Orchestration and showcase layer for independent apps. It references the apps by path and never modifies them.

**Source of truth for each app is its Desktop folder** (`C:\Users\rigwe\Desktop\<App>`). The same-named folders inside this directory are stale copies, git-ignored and not used.

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
`npm run console` prints a tokenized localhost URL. It shows each app's processes with status, Start/Stop/Restart, Open and Log buttons. Closing the console never stops the apps.

## Showcase
`npm run showcase` builds the static public site from `showcase/products.json` and previews it at http://127.0.0.1:4200/.

## Demo gateway
See `demo-gateway/README.md`. Ready now: `imageapp` (no database). Other apps need a separate demo database before `demoReady` is set.
