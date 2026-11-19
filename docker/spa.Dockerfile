# Syntax: docker build --build-arg APP=admin -f docker/spa.Dockerfile .
# Build context must be the repository root. APP is admin or portal.
# Serves the built SPA with nginx-unprivileged (non-root, uid 101).

ARG APP=admin

FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
RUN node --version && test "$(node -v)" = v24.22.3 && npm install -g pnpm@11.22.0 && test "$(pnpm -v)" = 11.22.0
WORKDIR /repo

FROM base AS builder
ARG APP
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@vibress/${APP}" build

FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
ARG APP
ENV APP=${APP}
# Update alpine packages to patched builds (OS-level CVEs: openssl, zlib, etc.)
USER root
RUN apk upgrade --no-cache
USER 101
COPY docker/nginx.spa.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder --chown=101:101 /repo/apps/${APP}/dist /usr/share/nginx/html/${APP}
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:8080/${APP}/" >/dev/null 2>&1 || exit 1