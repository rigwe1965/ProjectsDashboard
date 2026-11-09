"""Empty the Remote Management DEMO database and its Redis so the demo can be seeded again.

Run from data/demo-src/rmm/api with data/rmm-demo.env loaded (the supervisor's reset steps do this), with the RMM virtualenv's
Python. Refuses to run unless DATABASE_URL is the demo Postgres (127.0.0.1:5433, database rmm_demo) and REDIS_URL is the demo
Redis (port 6380). The schema is kept; every row is removed. The steps after this one (seed.py, then seed-rmm-demo.py) put the
sign-in accounts and the simulated customers, devices, alerts and tickets back."""
import os, sys
from rmm_demo_services import ensure_demo_services, require_demo_database

url = os.environ.get("DATABASE_URL", "")
redis_url = os.environ.get("REDIS_URL", "")
require_demo_database(url)
if "127.0.0.1:6380" not in redis_url and "localhost:6380" not in redis_url:
    sys.exit("Refusing: REDIS_URL is not the demo Redis.")

# The two demo containers may be stopped (the whole demo was shut down): start them the way the demo API does.
ensure_demo_services()

sys.path.insert(0, os.getcwd())
from app import create_app          # noqa: E402  (importing the app also imports every model, so the table list is complete)
from extensions import db           # noqa: E402

app = create_app()
with app.app_context():
    tables = [t.name for t in db.metadata.sorted_tables]
    db.session.execute(db.text("TRUNCATE %s RESTART IDENTITY CASCADE" % ", ".join('"%s"' % t.replace('"', "") for t in tables)))
    db.session.commit()
    print("Emptied %d tables." % len(tables))

import redis                         # noqa: E402
redis.Redis.from_url(redis_url).flushdb()
print("Emptied the demo Redis.")
