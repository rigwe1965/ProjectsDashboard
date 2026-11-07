# Container recipe for the ClaudeWorkspace (CarRental) DEMO instance: one image, run twice (customer site and admin portal).
# Owned by the dashboard: the app's folder is only READ (build context). Every .env file (including apps/*/.env.local,
# which holds real keys) is excluded by Dockerfile.dockerignore.
#   docker build -f deploy/apps/claudeworkspace/Dockerfile -t pd-claudeworkspace ../ClaudeWorkspace/reci-transport
#
# Runs `next dev` like the verified local demo. The backend is a hosted Supabase project reached over the internet:
# use a separate, empty demo project, never the production one. Payments, email, AI and monitoring keys are not set.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY . .
# Only the two web apps and what they depend on (the Expo mobile app is not needed).
RUN pnpm install --frozen-lockfile --filter "@reci/web..." --filter "@reci/admin..." \
 && mkdir -p apps/web/.next apps/admin/.next && chown -R node:node /app

USER node
ENV NEXT_TELEMETRY_DISABLED=1 HOME=/home/node
EXPOSE 3102 3103
ENTRYPOINT ["tini", "--"]
# Default: the customer site. The compose file runs the admin portal from the same image with another command.
WORKDIR /app/apps/web
CMD ["pnpm", "exec", "next", "dev", "-H", "0.0.0.0", "-p", "3102", "--turbo"]
