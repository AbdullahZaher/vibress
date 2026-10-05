# Syntax: docker build -f docker/worker.Dockerfile .
# Build context must be the repository root.

FROM node:24-alpine AS base
RUN apk upgrade --no-cache && npm install -g pnpm@11.22.0
WORKDIR /repo

# ---- Dependencies + build ----
FROM base AS builder
ARG VIBRESS_VERSION=1.0.0
ARG GIT_SHA=HEAD
ARG BUILD_DATE=""

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# Remove development-only tools and dependencies that are not needed at runtime
RUN rm -rf node_modules/.pnpm/axios* \
           node_modules/.pnpm/nx* \
           node_modules/.pnpm/@nx* \
           node_modules/nx \
           node_modules/@nx \
           node_modules/.cache \
           tests docs .github

FROM node:24-alpine AS runtime
ARG VIBRESS_VERSION=1.0.0
ARG GIT_SHA=HEAD
ARG BUILD_DATE=""

LABEL org.opencontainers.image.title="vibress-worker" \
      org.opencontainers.image.description="Vibress Background Task & Queue Worker" \
      org.opencontainers.image.version="${VIBRESS_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.vendor="Vibress"

ENV NODE_ENV=production
ENV VIBRESS_VERSION=${VIBRESS_VERSION}
ENV GIT_SHA=${GIT_SHA}

# Upgrade Alpine packages and remove npm/npx
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Provide a lightweight /usr/local/bin/pnpm runner without bundling vulnerable global pnpm/undici
RUN printf '#!/bin/sh\nset -e\nif [ "$1" = "start" ]; then\n  exec node /repo/node_modules/tsx/dist/cli.mjs src/main.ts\nelse\n  exec node /repo/node_modules/tsx/dist/cli.mjs "$@"\nfi\n' > /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm

WORKDIR /repo
RUN mkdir -p /repo/content && chown -R node:node /repo

COPY --from=builder --chown=node:node /repo/package.json /repo/pnpm-workspace.yaml /repo/tsconfig.base.json /repo/
COPY --from=builder --chown=node:node /repo/packages /repo/packages
COPY --from=builder --chown=node:node /repo/apps/worker /repo/apps/worker
COPY --from=builder --chown=node:node /repo/node_modules /repo/node_modules

USER node
WORKDIR /repo/apps/worker
EXPOSE 7782

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7782/health/ready >/dev/null 2>&1 || exit 1

CMD ["pnpm", "start"]