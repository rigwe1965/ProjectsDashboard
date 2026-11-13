#!/bin/sh
# Put the RMM DEMO back to its seeded state. Runs INSIDE the RMM API image, with the demo database and Redis reachable and the API
# stopped (deploy/reset-demos.sh does that). Not part of the image: it is mounted for the one reset run, together with
# reset_db.py (as /pd-reset-db.py) and supervisor/demo-fixes/seed-rmm-demo.py (as /pd-seed-demo.py).
set -e
cd /app
flask --app app:create_app db upgrade
python /pd-reset-db.py
python seed.py
python /pd-seed-demo.py
