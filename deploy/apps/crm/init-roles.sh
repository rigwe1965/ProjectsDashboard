#!/bin/sh
# Runs once, when the demo database volume is first created. Creates the restricted role the CRM connects as, so that
# row-level security binds in the demo exactly as in production. The owner (POSTGRES_USER) runs migrations.
set -e
psql -v ON_ERROR_STOP=1 -v pw="$CRM_APP_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE crm_app LOGIN PASSWORD :'pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SQL
