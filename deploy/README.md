# Hosting the dashboard (Docker Compose)

Runs the public showcase, the owner console, the customer demo gateway and a Postgres database on one Linux server,
behind Caddy, which gets and renews HTTPS certificates automatically. This is the "hosted" way; running it on your own
PC (`npm run console`, `npm run gateway`) keeps working as before.

```
                      internet
                         |
                   Caddy  :80 :443        automatic HTTPS
        ┌────────────────┼───────────────────┐
   example.com     admin.example.com   *.demo.example.com
   (showcase)      (owner console)     (customer demos)
                         |                   |
                      console             gateway ──> app containers (ImageApp demo, ...)
                         └────── Postgres ───┘
```

## What you need
- A Linux server with Docker and the Compose plugin, ports **80** and **443** open to the internet.
- Three DNS records pointing at the server: `example.com`, `admin.example.com` and a **wildcard** `*.demo.example.com`
  (use your own names). Customers' links look like `https://imageapp.demo.example.com/d/<token>`.
- This repository on the server (`git clone`).

## First start
```bash
cd deploy
cp .env.example .env                  # fill in POSTGRES_PASSWORD, the three domains, ACME_EMAIL
cp ../registry/apps.hosted.example.json ../registry/apps.hosted.json    # which demos exist (edit later)
docker compose up -d --build          # dashboard only
docker compose --profile apps up -d --build   # ...and the app containers (needs the app folders, see below)
```
The **console refuses to start until you set a password** (it is reachable from the internet, so a launch token is not
enough). Set it once:
```bash
docker compose run --rm console node admin-console/auth-cli.mjs set-password
docker compose run --rm console node admin-console/auth-cli.mjs enable-totp     # 2-step codes: strongly recommended
docker compose up -d console
```
Then sign in at `https://admin.example.com`, create a demo link under *Customer demos* and send it.

## How HTTPS for demos works
Each demo address (`imageapp.demo.example.com`) gets its own certificate the first time someone visits it. Before
Caddy asks the certificate authority, it asks the gateway (`/_pd/tls-ask`) whether that name is a real demo product, so
the server never requests certificates for names nobody configured. The first visit to a new product takes a few
seconds longer. Let's Encrypt limits how many certificates one domain can get per week; a handful of products is far below it.

## Apps in containers
`--profile apps` builds each app from **its own folder** using a recipe owned by the dashboard
(`deploy/apps/<app>/Dockerfile`). The app's folder is only read; nothing is added to it. Set `APPS_ROOT` in `.env` to
the folder that contains the apps. Recipes exist for **ImageApp**, **Airfinder**, **CRM** and **ClaudeWorkspace** (the four demo-ready apps). Every recipe
excludes the app's real `.env` files, databases and caches from the build (`Dockerfile.dockerignore` next to it), so a demo
can never contain production secrets or data. Demos start empty; none of them has email, payment, AI or monitoring keys.

| Demo | Needs in `.env` | One-time step |
|---|---|---|
| ImageApp | nothing | none |
| Airfinder | `AIRFINDER_*` (own SQLite file in a volume) | none; staff login is the `AIRFINDER_ADMIN_*` pair |
| CRM | `CRM_*` (its own Postgres container) | `docker compose --profile apps run --rm crm-demo seed` (wipes and fills the demo database only) |
| ClaudeWorkspace | `CW_SUPABASE_*` of a **separate** demo Supabase project | apply its 14 migrations and seed to that project (as for the local demo) |

CRM and ClaudeWorkspace run `next dev`, like the verified local demos. Production mode (`next start`) refuses to boot
without a real email provider, Redis, and other services a demo should not have. First page loads are slower while Next
compiles them. These two recipes are for demos only, never for real customer data.

In `registry/apps.hosted.json` a process is either a host process (`cmd`) or an existing container
(`container` = its name, `host` = its service name on the compose network, `port` = the port inside the container).
The gateway reaches demo instances by `host:port`.

The console runs *inside* a container and has no access to Docker, so its Start/Stop buttons do not control app
containers here (they show status only). Manage containers with `docker compose`. This is deliberate: giving a
web-facing service the Docker socket would give it control of the whole server.

## Everyday operations
```bash
docker compose ps                         # health of every service
docker compose logs -f gateway            # JSON log lines (set LOG_FORMAT=text for readable lines)
docker compose pull && docker compose up -d --build     # update
curl -H "Authorization: Bearer $METRICS_TOKEN" https://x.demo.example.com/_pd/metrics   # Prometheus metrics
```
Health checks: `/_pd/healthz` on the gateway and console (no login, no data). Metrics are hidden unless you set
`METRICS_TOKEN`. Services stop cleanly on `docker stop` (about half a second).

**Backups.** Everything that matters is in Postgres (demo links, sessions, audit log). Back it up regularly:
```bash
docker compose exec postgres pg_dump -U dashboard dashboard | gzip > dashboard-$(date +%F).sql.gz
```
Restore into an empty database with `gunzip -c file | docker compose exec -T postgres psql -U dashboard dashboard`.
The `caddy_data` volume holds the certificates; losing it only means they are re-issued.

## Trying it locally first (no domain, no HTTPS)
```bash
cd deploy
cp .env.example .env     # any values; domains can stay as the examples
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile apps up -d --build
```
Showcase `http://localhost:8080/`, console `http://admin.localhost:8080/` (set the password first, as above),
demo links `http://imageapp.demo.localhost:8080/d/<token>`. On Docker Desktop every visitor appears with the same
address (the Docker network's gateway); on a real Linux server the real client address is recorded.
Stop and remove it with `docker compose -f docker-compose.yml -f docker-compose.local.yml --profile apps down -v`.

## Security notes
- Postgres is not published to the internet; only Caddy's ports 80/443 are.
- Caddy's address inside the compose network is fixed (172.30.0.2) and is the only address whose `X-Forwarded-For`
  the gateway and console believe (`TRUSTED_PROXIES`).
- `deploy/.env` and `registry/apps.hosted.json` are git-ignored. Never commit `.env`.
- Demo apps must not share data with production: give every demo instance its own database, as for the local setup.

## Not done yet
- Recipes for RMM and ClaudeOS (not demo-ready yet).
- Moving existing demo links from a local SQLite database into Postgres (new links are simply created on the server).
- ClaudeOS and RMM UI demos still need their own demo data before they can be marked demo-ready.
