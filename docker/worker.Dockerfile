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
RUN node scripts/build-production-bundles.mjs && \
    find apps/worker/dist -name "*.map" -delete

# Extract production runtime native dependencies into an isolated directory
RUN mkdir -p /repo/runtime_node_modules && \
    cp -rL node_modules/.pnpm/argon2@*/node_modules/argon2 /repo/runtime_node_modules/argon2 && \
    cp -rL node_modules/.pnpm/argon2@*/node_modules/@phc /repo/runtime_node_modules/@phc && \
    cp -rL node_modules/.pnpm/node-gyp-build@*/node_modules/node-gyp-build /repo/runtime_node_modules/node-gyp-build

# ---- Runtime: non-root, minimal immutable runtime, hardened container ----
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

WORKDIR /repo
RUN mkdir -p /repo/content && chown -R node:node /repo

# Copy only production compiled artifacts and runtime native modules
COPY --from=builder --chown=node:node /repo/runtime_node_modules /repo/node_modules
COPY --from=builder --chown=node:node /repo/apps/worker/dist /repo/apps/worker/dist

USER node
WORKDIR /repo/apps/worker
EXPOSE 7782

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7782/health/ready >/dev/null 2>&1 || exit 1

CMD ["node", "dist/main.js"]