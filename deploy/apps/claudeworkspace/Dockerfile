# Container recipe for the ClaudeWorkspace (CarRental) DEMO instance: one image, run twice (customer site and admin portal).
# Owned by the dashboard: the app's folder is only READ (build context). Every .env file (including apps/*/.env.local,
# which holds real keys) is excluded by Dockerfile.dockerignore.
#   docker build -f deploy/apps/claudeworkspace/Dockerfile -t pd-claudeworkspace ../ClaudeWorkspace/reci-transport
#
# Runs PRODUCTION builds (`next build`, then `next start`), not dev servers. The public addresses and the public Supabase
# values are fixed into the build, so they are build arguments (compose passes them): change DEMO_DOMAIN and you must rebuild.
# Lint is skipped in the build because the app has a failing lint rule of its own; type checking still runs. The backend is a
# hosted Supabase project reached over the internet: use a separate, empty demo project, never the production one.
# Payments, email, AI and monitoring keys are not set.
FROM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY . .
# Only the two web apps and what they depend on (the Expo mobile app is not needed).
RUN pnpm install --frozen-lockfile --filter "@reci/web..." --filter "@reci/admin..." \
 && mkdir -p node_modules && ln -s /app/apps/web/node_modules/@supabase node_modules/@supabase
# (the link lets the root-level seed_demo.mjs find the Supabase client, which pnpm only installs inside apps/web; the host-side
# reset script runs that file to restore the demo vehicles)

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_ADMIN_URL
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
RUN (cd apps/web && pnpm exec next build --no-lint) && (cd apps/admin && pnpm exec next build --no-lint) \
 && chown -R node:node /app

USER node
ENV HOME=/home/node
EXPOSE 3102 3103
ENTRYPOINT ["tini", "--"]
# Default: the customer site. The compose file runs the admin portal from the same image with another command.
WORKDIR /app/apps/web
CMD ["pnpm", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3102"]
