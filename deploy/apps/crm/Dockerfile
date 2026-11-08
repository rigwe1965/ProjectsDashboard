# Container recipe for the CRM DEMO instance. Owned by the dashboard: the app's folder is only READ (build context).
# Its real .env files, .next cache and node_modules are excluded by Dockerfile.dockerignore.
#   docker build -f deploy/apps/crm/Dockerfile -t pd-crm ../CRM
#
# It runs a PRODUCTION build (`next build`, then `next start`), not a dev server: no error overlays with source code and no
# development-only endpoints are reachable. Production mode insists on settings a demo does not really have, so the compose
# file supplies harmless stand-ins (see docker-compose.yml): mail goes to a port nobody listens on (nothing is ever sent), and
# rate limits are kept by the crm-demo-ratelimit service. The MFA and cron keys are derived below from the demo's own auth
# secret. Demo only: never use this recipe for real customer data.
FROM node:22-bookworm-slim

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
# Migrations run as the database owner (DIRECT_URL); the app itself connects as the restricted role.
npx prisma migrate deploy
if [ "$1" = "seed" ]; then
  # One-off, on purpose: the app's seed WIPES the demo database and refuses unless told. The name is the demo database.
  WIPE_FORCE=1 CONFIRM_WIPE="${CRM_DB_NAME:-crm}" exec npx tsx prisma/seed.ts
fi
exec npx next start -H 0.0.0.0 -p 3101
SH

USER node
EXPOSE 3101
ENTRYPOINT ["tini", "--", "pd-entrypoint"]
