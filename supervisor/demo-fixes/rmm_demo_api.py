"""Starts the RMM DEMO API on 127.0.0.1 only. First makes sure the demo Postgres and Redis containers are running.
Run from data/demo-src/rmm/api with data/rmm-demo.env loaded (the supervisor does this). Usage: rmm_demo_api.py <port>"""
import os, subprocess, sys, time, socket

port = int(sys.argv[1])
if "@127.0.0.1:5433/rmm_demo" not in os.environ.get("DATABASE_URL", ""):
    sys.exit("Refusing to start: DATABASE_URL is not the demo database.")

for name in ("pd-rmm-demo-pg", "pd-rmm-demo-redis"):
    subprocess.run(["docker", "start", name], capture_output=True)
for p in (5433, 6380):
    for _ in range(60):
        try:
            socket.create_connection(("127.0.0.1", p), timeout=1).close(); break
        except OSError:
            time.sleep(1)
    else:
        sys.exit(f"Port {p} did not come up. Docker Desktop must be running (start it, wait until it says Engine running, then start the RMM demo again).")
time.sleep(2)

sys.path.insert(0, os.getcwd())
from app import create_app
from waitress import serve
serve(create_app(), host="127.0.0.1", port=port, threads=8)
