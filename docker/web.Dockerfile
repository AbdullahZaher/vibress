# Syntax: docker build -f docker/web.Dockerfile .
# Build context must be the repository root.
# Requires apps/web/next.config.mjs output: 'standalone'.

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

FROM base AS builder
COPY . .
ENV NX_WORKSPACE_ROOT=
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @vibress/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=7778
WORKDIR /app
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./public
USER node
EXPOSE 7778
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7778/ >/dev/null 2>&1 || exit 1
CMD ["node", "apps/web/server.js"]