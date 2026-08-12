# Syntax: docker build -f docker/worker.Dockerfile .
# Build context must be the repository root.

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @vibress/worker build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN npm install -g pnpm@11.17.0 && \
    # Remove the bundled npm CLI (not needed at runtime; carries unpatched
    # bundled deps: brace-expansion, tar, undici, ip-address)
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /repo
COPY --from=builder --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/worker
EXPOSE 7782
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7782/health/ready >/dev/null 2>&1 || exit 1
CMD ["pnpm", "run", "start"]