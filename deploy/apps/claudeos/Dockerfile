# Container recipe for the ClaudeOS DEMO instance. Owned by the dashboard: the app's own folder is only READ (as the build
# context) and never modified. Its real .env, databases, vault and logs are excluded by Dockerfile.dockerignore, so the demo can
# never contain production data or secrets.
#   docker build -f deploy/apps/claudeos/Dockerfile -t pd-claudeos ../ClaudeOS
FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928

WORKDIR /app
COPY requirements.txt ./
# Left out of the demo image: pytest (tests only) and sentence-transformers (it pulls in PyTorch, over 2 GB; the app already treats it as
# optional: without it semantic search is switched off with a warning and the rest works).
RUN grep -viE '^(pytest|pytest-cov|sentence-transformers)' requirements.txt > /tmp/req.txt && pip install --no-cache-dir -r /tmp/req.txt

COPY . .
# The agent definitions and a few input hints name the owner's real client and the owner (reci-transport, RECI Transport Ltd, Rigwe). The
# demo shows the sample client (acme-logistics) instead, to match the sample namespaces seeded by seed_namespaces.py.
RUN grep -rlE 'reci|Reci|RECI|Rigwe' agents/definitions dashboard/_pages/_admin.py dashboard/_pages/_memory.py dashboard/components/login_form.py     | xargs -r sed -i -e 's/RECI Transport Ltd/Acme Logistics Ltd/g; s/RECI Transport/Acme Logistics/g; s/Reci Transport/Acme Logistics/g; s/reci-transport/acme-logistics/g; s/RECI fleet/Acme fleet/g; s/what Rigwe needs/what the user needs/g; s/tags: \[transport, reci, ops, nigeria\]/tags: [transport, acme, ops]/'

# Two demo-only fixes to the app's code (the app's own folder is never modified; this edits the copy inside the image). Each one stops the
# build if the line it changes is no longer there, so a change in the app cannot silently undo it (tests/unit/dockerfiles.test.mjs).
# 1. The overview, projects and tickets pages fetch in worker threads. A worker cannot see the signed-in session, so without a developer API
#    key (the demo has none) every one of those calls answers 401 and the page shows "API unreachable" with empty lists. Run them one after
#    another on the page's own thread instead.
COPY <<'PY' /app/pd_seq_executor.py
import concurrent.futures as _cf

Future = _cf.Future
as_completed = _cf.as_completed  # re-exported: the pages import both names from here


class ThreadPoolExecutor:
    """Same calls as concurrent.futures.ThreadPoolExecutor, but each job runs at once on the calling thread."""
    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *exc): return False

    def submit(self, fn, *args, **kwargs):
        f = Future()
        try:
            f.set_result(fn(*args, **kwargs))
        except BaseException as e:  # the caller sees it from .result(), as with a real worker
            f.set_exception(e)
        return f
PY
RUN for f in dashboard/_pages/_overview.py dashboard/_pages/_projects.py dashboard/_pages/_tickets.py; do \
      grep -qx 'from concurrent.futures import ThreadPoolExecutor, as_completed' "$f" || { echo "demo patch: expected import not found in $f" >&2; exit 1; }; \
      sed -i 's/^from concurrent.futures import ThreadPoolExecutor, as_completed$/from pd_seq_executor import ThreadPoolExecutor, as_completed/' "$f"; \
    done
# 2. The API allows 100 requests an hour per client address, but every request comes from inside this container (127.0.0.1), so all visitors
#    and the health check (180 an hour on its own) share one budget and get 429. Raise the shared default; routes with their own limit keep it.
RUN test "$(grep -c '"500/day", "100/hour"' core/api/limiter.py)" = 3 || { echo "demo patch: limiter defaults not found" >&2; exit 1; } \
 && sed -i 's#"500/day", "100/hour"#"50000/day", "5000/hour"#' core/api/limiter.py

# Fail closed: an empty secret must stop the demo, never silently fall back to an app default. (The API itself refuses to start without an
# Anthropic key, so that one is required too.) One container runs both parts:
# the API (waitress, loopback only) and the Streamlit dashboard (the only thing the gateway can reach). If either stops, the container
# stops, so Docker restarts both together.
COPY --chmod=755 <<'SH' /usr/local/bin/pd-entrypoint
#!/bin/sh
for v in CLAUDEOS_SECRET_KEY ANTHROPIC_API_KEY; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "$v is empty: set the CLAUDEOS_* values in deploy/.env" >&2; exit 1; }
done
exec "$@"
SH
COPY --chmod=755 <<'SH' /usr/local/bin/pd-run
#!/bin/bash
mkdir -p "$LOG_PATH" "$CHROMADB_PATH" /app/data/vault-workspaces /app/data/outputs-store
# Create the tables on first start (a reset re-seeds them; see deploy/apps/claudeos/reset.sh).
python scripts/migrate.py >/dev/null || { echo "database migration failed" >&2; exit 1; }
FLASK_HOST=127.0.0.1 FLASK_PORT=5100 python scripts/serve_api.py 5100 &
FLASK_PORT=5100 python -m streamlit run dashboard/app.py --server.port 8601 --server.address 0.0.0.0 --server.headless true --browser.gatherUsageStats false &
wait -n
exit 1
SH
# The app writes workspace folders (vault/workspaces) and generated outputs (outputs/store) next to its code, which is read-only in compose:
# both are redirected into the data volume.
RUN useradd --create-home --uid 10001 app && mkdir -p /app/data && rm -rf /app/vault/workspaces /app/outputs/store && ln -s /app/data/vault-workspaces /app/vault/workspaces && ln -s /app/data/outputs-store /app/outputs/store && chown -R app /app
USER app

# The demo's own database, vector files and logs live in /app/data (a volume in compose). Mail, cloud sync and memory import are never configured.
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app CLAUDEOS_ENV=development SQLITE_PATH=/app/data/claudeos.db CHROMADB_PATH=/app/data/chromadb LOG_PATH=/app/data/logs HF_HUB_OFFLINE=1
EXPOSE 8601
ENTRYPOINT ["pd-entrypoint"]
CMD ["pd-run"]
