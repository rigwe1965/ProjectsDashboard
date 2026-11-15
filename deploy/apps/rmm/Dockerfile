# Container recipe for the Remote Management (RMM) DEMO API. Owned by the dashboard: the app's own folder is only READ (as the build
# context) and never modified. Real .env files, databases, screenshots, reports and backups are excluded by Dockerfile.dockerignore.
# The build context is the RMM's TOP folder (seed.py reads ../scripts_library). The dashboard UI has its own recipe (Dockerfile.ui):
# the two parts pin different redis libraries, so they cannot share an image.
#   docker build -f deploy/apps/rmm/Dockerfile -t pd-rmm-api ../RemoteManagementSystem
FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928

WORKDIR /app
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./
COPY scripts_library /scripts_library

# Fail closed: a missing secret must stop the demo, never fall back to an app default.
COPY --chmod=755 <<'SH' /usr/local/bin/pd-entrypoint
#!/bin/sh
for v in DATABASE_URL REDIS_URL SECRET_KEY JWT_SECRET_KEY ORG_REGISTRATION_TOKEN SUPERADMIN_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "$v is empty: set the RMM_* values in deploy/.env" >&2; exit 1; }
done
exec "$@"
SH
# Create or update the tables, then serve (waitress, inside the compose network only). No Celery worker runs in the demo.
COPY --chmod=755 <<'SH' /usr/local/bin/pd-run
#!/bin/sh
flask --app app:create_app db upgrade || { echo "database migration failed" >&2; exit 1; }
exec python app.py
SH
# The root is read-only in compose; the folders the app writes to are tmpfs there.
RUN useradd --create-home --uid 10001 app && mkdir -p /app/screenshots /app/reports /app/backups /app/instance && chown -R app /app
USER app

ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app API_HOST=0.0.0.0 API_PORT=5000 BACKUP_DIR=/app/backups FLASK_DEBUG=0
EXPOSE 5000
ENTRYPOINT ["pd-entrypoint"]
CMD ["pd-run"]
