#!/bin/sh
# Put the Airfinder DEMO back to its seeded state. Runs INSIDE the Airfinder image, with the demo's data volume mounted and the
# app stopped (deploy/reset-demos.sh does that). Not part of the image: it is mounted for the one reset run.
set -e
cd /app
rm -f /app/instance/airfinder.db /app/instance/airfinder.db-wal /app/instance/airfinder.db-shm
python seed_demo.py
# The app creates its staff account as "must change password", so the first customer in would be forced to choose a new one and
# the demo password would stop working for everyone after them. Clear that flag in the demo database.
python - <<'PY'
import sqlite3
con = sqlite3.connect('/app/instance/airfinder.db')
n = 0
for (t,) in con.execute("select name from sqlite_master where type='table'").fetchall():
    cols = [r[1] for r in con.execute('pragma table_info("%s")' % t.replace('"', ''))]
    if 'must_change_password' in cols:
        n += con.execute('update "%s" set must_change_password = 0' % t.replace('"', '')).rowcount
con.commit(); con.close()
print('Cleared the forced password change on %d staff account(s).' % n)
PY
