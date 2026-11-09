"""Starts the RMM DEMO API on 127.0.0.1 only. First makes sure the demo Postgres and Redis containers are running.
Run from data/demo-src/rmm/api with data/rmm-demo.env loaded (the supervisor does this). Usage: rmm_demo_api.py <port>"""
import os, sys
from rmm_demo_services import ensure_demo_services, require_demo_database

port = int(sys.argv[1])
require_demo_database(os.environ.get("DATABASE_URL", ""))
ensure_demo_services()

sys.path.insert(0, os.getcwd())
from app import create_app
from waitress import serve
serve(create_app(), host="127.0.0.1", port=port, threads=8)
