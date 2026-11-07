# Container recipe for the CRM DEMO instance. Owned by the dashboard: the app's folder is only READ (build context).
# Its real .env files, .next cache and node_modules are excluded by Dockerfile.dockerignore.
#   docker build -f deploy/apps/crm/Dockerfile -t pd-crm ../CRM
#
# It runs `next dev`, exactly like the verified local demo. `next start` (production mode) refuses to boot without a
# real email provider, Upstash Redis, MFA key, CRON_SECRET and so on, none of which a demo should have. In dev mode
# emails are only printed to the log and nothing is sent. Demo only: never use this recipe for real customer data.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependencies first (cached). `postinstall` runs `prisma generate`, so the schema must be present.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
RUN mkdir -p /app/.next && chown -R node:node /app

COPY --chmod=755 <<'SH' /usr/local/bin/pd-entrypoint
#!/bin/sh
set -e
cd /app
# Fail closed: an empty secret must stop the demo, never silently fall back to a default.
for v in NEXTAUTH_SECRET SEED_USER_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "$v is empty: set the CRM_* values in deploy/.env" >&2; exit 1; }
done
# Migrations run as the database owner (DIRECT_URL); the app itself connects as the restricted role.
npx prisma migrate deploy
if [ "$1" = "seed" ]; then
  # One-off, on purpose: the app's seed WIPES the demo database and refuses unless told. The name is the demo database.
  WIPE_FORCE=1 CONFIRM_WIPE="${CRM_DB_NAME:-crm}" exec npx tsx prisma/seed.ts
fi
exec npx next dev -H 0.0.0.0 -p 3101
SH

USER node
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3101
ENTRYPOINT ["tini", "--", "pd-entrypoint"]
