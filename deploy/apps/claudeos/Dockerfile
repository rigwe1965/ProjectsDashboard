# Container recipe for the ClaudeOS DEMO instance. Owned by the dashboard: the app's own folder is only READ (as the build
# context) and never modified. Its real .env, databases, vault and logs are excluded by Dockerfile.dockerignore, so the demo can
# never contain production data or secrets.
#   docker build -f deploy/apps/claudeos/Dockerfile -t pd-claudeos ../ClaudeOS
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

WORKDIR /app
COPY requirements.txt ./
# Left out of the demo image: pytest (tests only) and sentence-transformers (it pulls in PyTorch, over 2 GB; the app already treats it as
# optional: without it semantic search is switched off with a warning and the rest works).
RUN grep -viE '^(pytest|pytest-cov|sentence-transformers)' requirements.txt > /tmp/req.txt && pip install --no-cache-dir -r /tmp/req.txt

COPY . .

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
