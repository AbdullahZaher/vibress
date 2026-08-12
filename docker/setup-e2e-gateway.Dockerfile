FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
RUN apk upgrade --no-cache
USER 101
COPY infrastructure/nginx/nginx.setup-e2e.conf /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=10 \
  CMD wget -qO- http://127.0.0.1:8080/nginx-health >/dev/null 2>&1 || exit 1
