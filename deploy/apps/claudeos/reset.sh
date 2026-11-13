#!/bin/sh
# Put the ClaudeOS DEMO back to its seeded state. Runs INSIDE the ClaudeOS image, with the demo's data volume mounted and the app
# stopped (deploy/reset-demos.sh does that). Not part of the image: it is mounted for the one reset run.
set -e
cd /app
: "${CLAUDEOS_DEMO_PASSWORD:?set CLAUDEOS_DEMO_PASSWORD in deploy/.env}"
rm -rf /app/data/claudeos.db /app/data/claudeos.db-wal /app/data/claudeos.db-shm /app/data/chromadb /app/data/vault-workspaces /app/data/outputs-store
mkdir -p /app/data/logs /app/data/chromadb /app/data/vault-workspaces /app/data/outputs-store
python scripts/migrate.py
python scripts/seed_agents.py
python scripts/seed_namespaces.py
python scripts/create_admin.py --username demo --password "$CLAUDEOS_DEMO_PASSWORD"
# A new account may be marked "must change password": the first customer in would be forced to choose a new one and the demo password
# would stop working for everyone after them. Clear that flag in the demo database.
python - <<'PY'
import sqlite3
con = sqlite3.connect('/app/data/claudeos.db')
n = con.execute('update users set must_change_password = 0').rowcount
con.commit(); con.close()
print('Cleared the forced password change on %d account(s).' % n)
PY
