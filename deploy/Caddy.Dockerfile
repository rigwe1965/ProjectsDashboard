# Caddy (HTTPS reverse proxy) with the built showcase site baked in. Build context = repository root.
FROM node:24-slim AS showcase
WORKDIR /app
COPY showcase showcase
RUN node showcase/build.mjs

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/Caddyfile.local /etc/caddy/Caddyfile.local
COPY --from=showcase /app/showcase/dist /srv
