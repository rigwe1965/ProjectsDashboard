#!/bin/sh
# Scheduled backup of the dashboard's Postgres database (audit F-19). Runs inside the `db-backup` service of docker-compose.yml.
#   db-backup.sh           take a backup now, then every BACKUP_INTERVAL_HOURS (default 24), for ever
#   db-backup.sh --once    take one backup and exit (0 = made, 1 = failed)
# A backup is written under a temporary name and renamed when complete, so a failed or interrupted dump never leaves a file that looks like a
# backup. The newest BACKUP_KEEP (default 14) are kept. It uses the usual PG* variables (PGHOST, PGUSER, PGDATABASE, PGPASSWORD).
# These stay on the same machine as the database: copy them off the server too (see deploy/README.md).
set -u
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-14}"
HOURS="${BACKUP_INTERVAL_HOURS:-24}"

backup_once() {
  f="$DIR/dashboard-$(date +%Y%m%d-%H%M%S).dump"
  if pg_dump -Fc > "$f.part" && [ -s "$f.part" ]; then
    mv "$f.part" "$f" && echo "backup written: $(basename "$f")"
  else
    rm -f "$f.part"; echo "backup FAILED" >&2; return 1
  fi
  # keep the newest $KEEP (the names sort by time)
  ls -1 "$DIR"/dashboard-*.dump 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
  return 0
}

mkdir -p "$DIR"
[ "${1:-}" = "--once" ] && { backup_once; exit $?; }
while true; do
  backup_once || true
  sleep "$((HOURS * 3600))"
done
