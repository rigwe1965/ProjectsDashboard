"""Empty the hosted RMM DEMO database and its Redis so the demo can be seeded again. Runs INSIDE the RMM API image (see reset.sh).
Refuses to run unless DATABASE_URL is the demo database (host rmm-demo-db, database rmm_demo) and REDIS_URL is the demo Redis
(host rmm-demo-cache). The schema is kept; every row is removed."""
import os, sys

url = os.environ.get("DATABASE_URL", "")
redis_url = os.environ.get("REDIS_URL", "")
if "@rmm-demo-db:5432/rmm_demo" not in url:
    sys.exit("Refusing: DATABASE_URL is not the demo database.")
if "@rmm-demo-cache:6379" not in redis_url:
    sys.exit("Refusing: REDIS_URL is not the demo Redis.")

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
