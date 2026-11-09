# Caddy (HTTPS reverse proxy) with the built showcase site baked in. Build context = repository root.
FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS showcase
WORKDIR /app
COPY showcase showcase
RUN node showcase/build.mjs

FROM caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/Caddyfile.local /etc/caddy/Caddyfile.local
COPY --from=showcase /app/showcase/dist /srv
