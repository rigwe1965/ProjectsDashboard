# The dashboard image: demo gateway, admin console and the supervisor CLI. Build context = repository root.
#   docker build -f deploy/Dockerfile -t projects-dashboard .
# One image, several roles; the compose file picks the command (gateway or console).
FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# iproute2 (ss) and procps (ps): the supervisor's Linux driver uses them. tini: reaps child processes and forwards
# SIGTERM so `docker stop` shuts the services down cleanly. curl: health checks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends iproute2 procps tini ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY lib lib
COPY admin-console admin-console
COPY demo-gateway demo-gateway
COPY supervisor supervisor
COPY registry registry
COPY showcase showcase
COPY tests/linux tests/linux

# All runtime data (SQLite file if used, logs) lives in /data: mount a volume there.
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production DASHBOARD_DATA=/data LOG_FORMAT=json
USER node
VOLUME /data

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "demo-gateway/server.mjs"]
