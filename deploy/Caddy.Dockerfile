# Caddy (HTTPS reverse proxy) with the built showcase site baked in. Build context = repository root.
FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS showcase
WORKDIR /app
COPY showcase showcase
RUN node showcase/build.mjs

FROM caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/Caddyfile.local /etc/caddy/Caddyfile.local
COPY --from=showcase /app/showcase/dist /srv
