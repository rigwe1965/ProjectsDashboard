# Container recipe for the Airfinder DEMO instance. Owned by the dashboard: the app's own folder is only READ
# (as the build context) and never modified. Its real .env, database and logs are excluded by Dockerfile.dockerignore,
# so the demo can never contain production data or secrets.
#   docker build -f deploy/apps/airfinder/Dockerfile -t pd-airfinder ../Airfinder
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

WORKDIR /app
COPY requirements.txt ./
# pytest is listed in the app's requirements but is not needed at runtime; install everything else as pinned.
RUN grep -viE '^(pytest|pytest-flask)' requirements.txt > /tmp/req.txt && pip install --no-cache-dir -r /tmp/req.txt

COPY . .

# Fail closed: an empty secret must stop the demo, never silently fall back to an app default.
COPY --chmod=755 <<'SH' /usr/local/bin/pd-entrypoint
#!/bin/sh
for v in SECRET_KEY JWT_SECRET SUPER_ADMIN_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "$v is empty: set the AIRFINDER_* values in deploy/.env" >&2; exit 1; }
done
exec "$@"
SH
# The demo's own database lives in /app/instance (a volume in compose); mail is never configured, so nothing is sent.
RUN useradd --create-home --uid 10001 app && mkdir -p /app/instance && chown -R app /app
USER app

ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app FLASK_ENV=production
EXPOSE 5200
ENTRYPOINT ["pd-entrypoint"]
# One worker: the app creates its tables on boot, and two workers racing to do so crash with "table already exists".
CMD ["gunicorn", "--bind=0.0.0.0:5200", "--workers=1", "--threads=4", "--access-logfile=-", "backend.app:create_app()"]
