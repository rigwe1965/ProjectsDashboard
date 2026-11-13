#!/bin/sh
# Refuses to go on when a secret or password that the app containers need is missing or empty in deploy/.env.
#
# Why a script: docker compose reads every ${VAR:?message} in the file even for services outside the profile you start, so
# making these required inside docker-compose.yml would also break `docker compose up -d` (no apps). The app services therefore
# default to empty (${VAR:-}), and this check is what stops an empty value from reaching a container.
#
# Usage (from deploy/):   ./check-apps-env.sh [airfinder] [crm] [claudeworkspace] [claudeos] [rmm]      (no argument: all five)
#                         ./check-apps-env.sh crm && docker compose --profile apps up -d --build
set -eu
cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || { echo "check-apps-env: $ENV_FILE not found (copy .env.example to .env and fill it in)" >&2; exit 2; }

vars_for() {
  case "$1" in
    airfinder)       echo "AIRFINDER_SECRET_KEY AIRFINDER_JWT_SECRET AIRFINDER_ADMIN_PASSWORD" ;;
    crm)             echo "CRM_DB_PASSWORD CRM_APP_PASSWORD CRM_PLATFORM_PASSWORD CRM_AUTH_SECRET CRM_DEMO_PASSWORD" ;;
    rmm)             echo "RMM_DB_PASSWORD RMM_REDIS_PASSWORD RMM_SECRET_KEY RMM_JWT_SECRET_KEY RMM_ORG_TOKEN RMM_SUPERADMIN_PASSWORD RMM_DEMO_ADMIN_PASSWORD" ;;
    claudeos)        echo "CLAUDEOS_SECRET_KEY CLAUDEOS_DEMO_PASSWORD CLAUDEOS_ANTHROPIC_API_KEY" ;;
    claudeworkspace) echo "CW_SUPABASE_URL CW_SUPABASE_ANON_KEY CW_SUPABASE_SERVICE_ROLE_KEY" ;;
    *) echo "check-apps-env: unknown demo '$1' (use airfinder, crm, claudeworkspace, claudeos or rmm)" >&2; exit 2 ;;
  esac
}

[ "$#" -gt 0 ] || set -- airfinder crm claudeworkspace claudeos rmm
for demo in "$@"; do case "$demo" in airfinder|crm|claudeworkspace|claudeos|rmm) ;; *) echo "check-apps-env: unknown demo $demo (use airfinder, crm, claudeworkspace, claudeos or rmm)" >&2; exit 2 ;; esac; done
missing=""
for demo in "$@"; do
  for v in $(vars_for "$demo"); do
    # last assignment wins, like compose; strip quotes and surrounding blanks
    val=$(sed -n "s/^[[:space:]]*$v[[:space:]]*=//p" "$ENV_FILE" | tail -n 1 | sed "s/^[[:space:]\"']*//; s/[[:space:]\"']*$//")
    [ -n "$val" ] || missing="$missing $v"
  done
done

if [ -n "$missing" ]; then
  echo "check-apps-env: these are empty or missing in $ENV_FILE:" >&2
  for v in $missing; do echo "  $v" >&2; done
  echo "Fill them in (long random values for secrets and passwords), then run this again." >&2
  exit 1
fi
echo "check-apps-env: all required values are set for: $*"
