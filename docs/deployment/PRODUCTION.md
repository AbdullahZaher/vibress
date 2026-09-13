# Vibress Production Operations & Deployment Manual

This manual contains the official architecture specification, security controls, operational runbooks, and disaster recovery procedures for running **Vibress** in production.

---

## 1. Production Architecture Overview

```text
                                Internet
                                   │
                                   ▼
                    [Edge Load Balancer / TLS CDN]
                      (Terminates HTTPS / 443)
                                   │
                                   ▼
                    [Gateway Ingress Container]
                     (nginx-unprivileged:8080)
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       ▼                           ▼                           ▼
[apps/web (SSR)]           [apps/admin (SPA)]          [apps/portal (SPA)]
 (Next.js Node 24)           (Vite/React Shell)          (Vite/React Shell)
       │                           │                           │
       └───────────────────────────┼───────────────────────────┘
                                   │
                                   ▼
                           [apps/api (Core)]
                         (Fastify REST Server)
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       ▼                           ▼                           ▼
[PostgreSQL 16]              [Redis 7 (AOF)]            [Object Storage]
 (Persisted Data)           (BullMQ & Caching)         (Local S3 / MinIO)
                                   │
                                   ▼
                          [apps/worker (Jobs)]
                      (Outbox, Email, Search sync)
```

---

## 2. Configuration & Secret Management

All production settings are validated at boot by `@vibress/config`. If any required variable is missing or insecure, the process halts immediately with `ConfigError`.

| Environment Variable | Required | Description |
| :--- | :---: | :--- |
| `NODE_ENV` | Yes | Must be set to `production`. |
| `POSTGRES_PASSWORD` | Yes | Strong database password (no default). |
| `VIBRESS_ENCRYPTION_KEY` | Yes | 32-byte hex string for AES-256-GCM field encryption. |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` | Yes | 32-byte hex secret for cryptographic unsubscribe tokens. |
| `STRIPE_SECRET_KEY` | Optional | Live Stripe API secret key (`sk_live_...`). |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhook signing secret (`whsec_...`). |
| `SMTP_HOST` | Yes | Production SMTP relay hostname. |
| `SMTP_PORT` | Yes | Production SMTP port (e.g. `587` or `465`). |
| `SMTP_USER` / `SMTP_PASS` | Yes | Production SMTP relay credentials. |
| `SMTP_FROM` | Yes | Outbound sender identity (`Vibress <no-reply@domain.com>`). |
| `STORAGE_PROVIDER` | Yes | `local` for container volumes, or `s3` for AWS S3 / Cloudflare R2. |

---

## 3. Database Deployment & Migration Safety

* **Database Version:** PostgreSQL 16+ with extensions: `pg_trgm`, `btree_gin`, `uuid-ossp`.
* **Migration Strategy:** All 26 schema migrations are strictly additive. Rolling container replacement does not cause schema lock conflicts.
* **Execution:**
  ```bash
  docker compose -f compose.prod.yml run --rm migrate
  ```

---

## 4. Disaster Recovery & Backup Runbook

### Physical Database Backup
Backups produce compressed SQL archives with SHA-256 integrity checksums:
```bash
./scripts/backup.sh /path/to/backup/storage
```

### Physical Database Restore
```bash
./scripts/restore.sh /path/to/backup/storage/vibress_backup_TIMESTAMP.sql.gz
```

### Recovery Targets
* **Recovery Point Objective (RPO Target):** < 15 minutes (with continuous WAL archiving).
* **Recovery Time Objective (RTO Target):** < 10 minutes.

---

## 5. Automated Health Probes

Load balancers and monitoring systems should scrape the following health probes:

* **Gateway Health:** `http://127.0.0.1:7777/nginx-health` (HTTP 200)
* **API Liveness:** `http://127.0.0.1:7777/health/live` (HTTP 200)
* **API Readiness:** `http://127.0.0.1:7777/health/ready` (HTTP 200 when PostgreSQL & Redis are connected; HTTP 503 if degraded)
* **Worker Readiness:** `http://127.0.0.1:7777/worker-health/ready` (HTTP 200)
* **Prometheus Metrics:** `http://127.0.0.1:7777/metrics` (Restricted to internal RFC1918 subnets)

---

## 6. Observability & Alerting Guidelines

Configure the following Prometheus alerts for production monitoring:

1. **High Error Rate Alert:**
   ```promql
   sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01
   ```
2. **PostgreSQL Pool Saturation:**
   ```promql
   db_pool_active_connections / db_pool_max_connections > 0.85
   ```
3. **BullMQ Stalled Jobs Alert:**
   ```promql
   bullmq_stalled_jobs_total > 5
   ```
4. **Outbox Lag Alert:**
   ```promql
   outbox_oldest_unpublished_age_seconds > 600
   ```
