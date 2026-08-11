# Syntax: docker build --build-arg APP=admin -f docker/spa.Dockerfile .
# Build context must be the repository root. APP is admin or portal.
# Serves the built SPA with nginx-unprivileged (non-root, uid 101).

ARG APP=admin

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

FROM base AS builder
ARG APP
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@vibress/${APP}" build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG APP
ENV APP=${APP}
COPY docker/nginx.spa.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder --chown=101:101 /repo/apps/${APP}/dist /usr/share/nginx/html/${APP}
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:8080/${APP}/" >/dev/null 2>&1 || exit 1