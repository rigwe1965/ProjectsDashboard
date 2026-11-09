"""What the RMM demo scripts share: the demo database check, and starting the demo Postgres and Redis containers and waiting for them.

Imported by rmm_demo_api.py (starts the demo API) and rmm_reset.py (empties the demo before it is seeded again). Both are run by
path, so this file's folder is already on sys.path."""
import socket
import subprocess
import sys
import time

CONTAINERS = ("pd-rmm-demo-pg", "pd-rmm-demo-redis")
PORTS = (5433, 6380)


def require_demo_database(url):
    """Stop unless DATABASE_URL is the demo Postgres (127.0.0.1:5433, database rmm_demo)."""
    if "@127.0.0.1:5433/rmm_demo" not in url:
        sys.exit("Refusing: DATABASE_URL is not the demo database.")


def ensure_demo_services():
    """Start the two demo containers (they may be stopped if the whole demo was shut down) and wait up to 60 s for each port."""
    for name in CONTAINERS:
        subprocess.run(["docker", "start", name], capture_output=True)
    for port in PORTS:
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=1).close()
                break
            except OSError:
                time.sleep(1)
        else:
            sys.exit(f"Port {port} did not come up. Docker Desktop must be running (start it, wait until it says Engine running, then try again).")
    time.sleep(2)
