# Production Deployment

## Architecture

```text
   Internet
      │
      ▼
   [LB / CDN] TLS termination
      │
      ▼
   Gateway (nginx-unprivileged, port 8080 → host 7777)
      ├── /           → Web       (Next.js standalone, SSR)
      ├── /admin/     → Admin SPA (nginx-unprivileged)
      ├── /portal/    → Portal SPA(nginx-unprivileged)
      ├── /api/       → API       (Node 24, tsx)
      ├── /health/*   → API
      └── /worker-health/ → Worker (health + metrics)
            │
    ┌───────┴────────┐
    ▼                ▼
 PostgreSQL 16     Redis 7     ← `backend` network: internal-only,
   (private)        (private)     no external exposure, no host ports
```

Two compose networks:

- `frontend` — gateway, api, worker, web, admin, portal.
- `backend` — `internal: true`; only api, worker, and the one-shot
  `migrate` job connect. Postgres/Redis publish **no host ports**; the only
  host-exposed port in the whole stack is the gateway's `7777`.

All containers run as non-root: Node images use `USER node` (uid 1000),
nginx images are `nginxinc/nginx-unprivileged` (uid 101), and the official
postgres/redis images run their built-in non-root users.

## Images

| Dockerfile        | Builds                                  | Runtime                      |
|-------------------|-----------------------------------------|------------------------------|
| `docker/api.Dockerfile`    | @vibress/api via tsc       | node:24-alpine, `pnpm run start` |
| `docker/worker.Dockerfile` | @vibress/worker via tsc    | node:24-alpine, `pnpm run start` |
| `docker/web.Dockerfile`    | Next standalone (`output: 'standalone'`) | node:24-alpine, `node apps/web/server.js` |
| `docker/spa.Dockerfile`    | `--build-arg APP=admin\|portal` (Vite)   | nginx-unprivileged |
| `docker/gateway.Dockerfile`| copies `infrastructure/nginx/nginx.prod.conf` | nginx-unprivileged |

`start` scripts run `tsx src/main.ts`: the workspace packages are consumed
as TypeScript sources (`main: src/index.ts`), which Node's native loader
cannot resolve; tsx is the supported runtime in containers. `tsc` still
validates the build inside the image.

## First boot

```bash
cp infrastructure/env.prod.example .env   # fill every value
pnpm prod:up                              # build images + start all services
pnpm prod:migrate                         # one-shot drizzle migrations
pnpm bootstrap:owner                      # create the first staff owner
```

`migrate` reuses the API image with `command: db:migrate`, attaches only to
the `backend` network, and exits (`restart: "no"`). Follow-up rollouts of
schema changes run the same command.

## Required environment

See `infrastructure/env.prod.example`. Notably:

```text
DATABASE_URL              # set by compose (service name `postgres`)
REDIS_URL                 # set by compose (service name `redis`)
VIBRESS_ENCRYPTION_KEY    # master key for encrypted credentials
NEWSLETTER_UNSUBSCRIBE_SECRET
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
ADMIN_ORIGIN / PORTAL_ORIGIN / CORS_ORIGINS
SMTP_*                    # for member-auth email links
```

The config layer (`@vibress/config`) refuses to boot in production without
these (`enforceProductionGuards`). Compose additionally fails fast via
`${VAR:?}` interpolation when required variables are missing.

## Reverse proxy

`infrastructure/nginx/nginx.prod.conf` enforces request body limits
(600m for media), forwards `X-Forwarded-*`, disables buffering for media
streaming, and exposes `/metrics` only to private RFC1918 ranges (metrics
must never be public). TLS is expected to terminate at the LB/CDN in front
of the gateway.

## Container scan

`container-scan` CI job (after `build`): builds the API and worker images
with `docker/build-push-action` (GitHub Actions layer cache) and scans them
with Trivy (`aquasecurity/trivy-action`), failing on HIGH/CRITICAL
findings with known fixes. Discoveries that cannot be fixed upstream are
`.trivyignore`-d or pinned via image digests during rollout.

## Secrets provisioning

Everything the app reads comes from environment variables (see
`packages/config/src/index.ts` for the full schema, including
`METRICS_ENABLED`/`TRACING_ENABLED`). Supply the `.env` from a secret
manager at deploy time; it is gitignored and required by compose.

## Backups

Back up independently:

1. PostgreSQL (e.g. `pg_dump` from the `backend` network: `docker compose
   -f compose.prod.yml exec -T postgres pg_dump -U vibress`; see
   `docs/12-infrastructure/backup-restore.md`)
2. object storage/content volume
3. encryption master key (`VIBRESS_ENCRYPTION_KEY`)

Without the encryption master key, encrypted integration/storage
credentials cannot be recovered.

## Observability

Logs, `/metrics`, and request tracing are documented in
`docs/12-infrastructure/observability.md`. Every container logs structured
JSON to stdout; the API and worker expose Prometheus `/metrics` on their
internal ports (also via the gateway at `/metrics`, private ranges only).