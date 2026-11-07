# Container recipe for ImageApp. Owned by the dashboard: the app's own folder is only READ (as the build context)
# and is never modified. Build context = the ImageApp folder; the compose file wires this up.
#   docker build -f deploy/apps/imageapp/Dockerfile -t pd-imageapp ../ImageApp
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd --create-home --uid 10001 app && mkdir -p /tmp/imageapp /var/log/imageapp && chown -R app /tmp/imageapp /var/log/imageapp /app
USER app

# Uploads are temporary files that the app clears itself; nothing is kept between restarts.
ENV IMAGEAPP_TEMP_DIR=/tmp/imageapp LOG_DIR=/var/log/imageapp PYTHONUNBUFFERED=1
EXPOSE 5400
CMD ["waitress-serve", "--host=0.0.0.0", "--port=5400", "--call", "wsgi:create_app"]
