# Container recipe for the CRM DEMO instance. Owned by the dashboard: the app's folder is only READ (build context).
# Its real .env files, .next cache and node_modules are excluded by Dockerfile.dockerignore.
#   docker build -f deploy/apps/crm/Dockerfile -t pd-crm ../CRM
#
# It runs a PRODUCTION build (`next build`, then `next start`), not a dev server: no error overlays with source code and no
# development-only endpoints are reachable. Production mode insists on settings a demo does not really have, so the compose
# file supplies harmless stand-ins (see docker-compose.yml): mail goes to a port nobody listens on (nothing is ever sent), and
# rate limits are kept by the crm-demo-ratelimit service. The MFA and cron keys are derived below from the demo's own auth
# secret. Demo only: never use this recipe for real customer data.
FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependencies first (cached). `postinstall` runs `prisma generate`, so the schema must be present.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
# The build needs no secrets and no database: every page is rendered when requested.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build && chown -R node:node /app

COPY --chmod=755 <<'SH' /usr/local/bin/pd-entrypoint
#!/bin/sh
set -e
cd /app
# Fail closed: an empty secret must stop the demo, never silently fall back to a default.
for v in NEXTAUTH_SECRET SEED_USER_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "$v is empty: set the CRM_* values in deploy/.env" >&2; exit 1; }
done
# Production mode needs these two keys. A demo keeps no real encrypted secrets, so derive them from the auth secret instead of
# asking for more values (the same secret always gives the same keys, so a restart keeps working).
[ -n "${MFA_ENCRYPTION_KEY:-}" ] || export MFA_ENCRYPTION_KEY="$(printf 'mfa:%s' "$NEXTAUTH_SECRET" | openssl dgst -sha256 -binary | openssl base64)"
[ -n "${CRON_SECRET:-}" ] || export CRON_SECRET="$(printf 'cron:%s' "$NEXTAUTH_SECRET" | openssl dgst -sha256 -hex | sed 's/^.* //')"
# Three modes. "migrate" and "seed" are the one-off crm-migrate service, which holds the database owner's password; the running app
# (no argument) holds none and changes nothing in the database.
setup_platform_login() {
  # The app's platform connection is its own login, not the table owner: row-level security bypassed, table read/write rights, no schema changes.
  [ -n "${CRM_PLATFORM_PASSWORD:-}" ] || { echo "CRM_PLATFORM_PASSWORD is empty: set the CRM_* values in deploy/.env" >&2; exit 1; }
  case "$CRM_PLATFORM_PASSWORD" in *[!A-Za-z0-9]*) echo "CRM_PLATFORM_PASSWORD may only contain letters and digits" >&2; exit 1 ;; esac
  npx prisma db execute --stdin --url "$DIRECT_URL" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_platform') THEN
    CREATE ROLE crm_platform LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END \$\$;
ALTER ROLE crm_platform PASSWORD '$CRM_PLATFORM_PASSWORD';
GRANT USAGE ON SCHEMA public TO crm_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crm_platform;
SQL
}
case "${1:-}" in
  migrate) npx prisma migrate deploy && setup_platform_login; exit $? ;;
  seed)
    # One-off, on purpose: the app's seed WIPES the demo database and refuses unless told. The name is the demo database.
    npx prisma migrate deploy && setup_platform_login || exit 1
    WIPE_FORCE=1 CONFIRM_WIPE="${CRM_DB_NAME:-crm}" exec npx tsx prisma/seed.ts ;;
esac
exec npx next start -H 0.0.0.0 -p 3101
SH

USER node
EXPOSE 3101
ENTRYPOINT ["tini", "--", "pd-entrypoint"]
