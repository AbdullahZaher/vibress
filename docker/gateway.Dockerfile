# Syntax: docker build -f docker/gateway.Dockerfile .
# Build context must be the repository root.
# nginx-unprivileged reverse proxy: single public entry point (port 8080 inside
# the container; map to ${VIBRESS_PORT:-7777} on the host).

FROM nginxinc/nginx-unprivileged:1.27-alpine
# Update alpine packages to patched builds (OS-level CVEs: openssl, zlib, etc.)
USER root
RUN apk upgrade --no-cache
USER 101
COPY infrastructure/nginx/nginx.prod.conf /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/nginx-health >/dev/null 2>&1 || exit 1