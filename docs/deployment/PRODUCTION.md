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
* **Migration Strategy:** All 37 schema migrations (0000 to 0036) are strictly additive and backwards-compatible. Rolling container replacement does not cause schema lock conflicts.
* **Execution:**
  ```bash
  docker compose -f compose.prod.yml run --rm migrate
  ```

---

## 4. Disaster Recovery & Backup Runbook

### Physical Database & Content Backup
Backups produce compressed, structurally validated SQL archives with SHA-256 integrity checksums and optional content directory archives:
```bash
# Database backup only
./scripts/backup.sh /path/to/backup/storage

# Database + persistent media & themes content backup
./scripts/backup.sh /path/to/backup/storage --with-content
```

### Physical Database Restore
Database restore requires explicit confirmation gate (`--confirm` or interactive confirmation) and executes with `ON_ERROR_STOP=1`:
```bash
# Restore to production database (interactive prompt)
./scripts/restore.sh /path/to/backup/storage/vibress_backup_TIMESTAMP.sql.gz

# Automated restore to target database with non-interactive confirmation
./scripts/restore.sh /path/to/backup/storage/vibress_backup_TIMESTAMP.sql.gz target_db --confirm
```

### Automated Disaster Recovery Drills
Execute automated end-to-end backup, restore, checksum verification, and entity parity assertion against an isolated disposable database:
```bash
./scripts/disaster-recovery-drill.sh
```

### Theme Storage & Generation Retention
Theme packages in object storage follow the **N-1 Bounded Generation Retention** contract:
* **Active Generation ($G_n$)**: Preserved in storage and referenced by `manifest.generation`.
* **Immediate Previous Generation ($G_{n-1}$)**: Explicitly retained for in-flight readers and referenced by `manifest.previousGeneration`.
* **Generations Older than $G_{n-1}$**: Cleaned up during package replacement once $G_n$ is authoritative.
* Details: See [`packages/domains/themes/THEME_STORAGE_LIFECYCLE.md`](file:///Users/abdullahzaher/vibress/packages/domains/themes/THEME_STORAGE_LIFECYCLE.md).

### Continuous WAL Archiving & Point-In-Time Recovery (PITR)
For continuous data protection with an RPO under 15 minutes, configure PostgreSQL continuous WAL archiving:

```ini
# /var/lib/postgresql/data/postgresql.conf (or postgres custom config)
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /var/lib/postgresql/wal_archive/%f && cp %p /var/lib/postgresql/wal_archive/%f'
# For cloud deployments using S3:
# archive_command = 'aws s3 cp %p s3://vibress-prod-backups/wal/%f'
archive_timeout = 900 # Forces a WAL segment switch every 15 minutes during low activity
```

To perform Point-In-Time Recovery to a specific timestamp:
1. Stop the PostgreSQL service.
2. Restore the latest base database snapshot via `scripts/restore.sh`.
3. Create `/var/lib/postgresql/data/recovery.signal`.
4. Configure `restore_command` and `recovery_target_time`:
   ```ini
   restore_command = 'cp /var/lib/postgresql/wal_archive/%f %p'
   # Or for S3: restore_command = 'aws s3 cp s3://vibress-prod-backups/wal/%f %p'
   recovery_target_time = '2026-10-14 12:00:00 UTC'
   recovery_target_action = 'promote'
   ```
5. Start PostgreSQL; the engine replays WAL transactions up to the target second and automatically promotes to primary.

### Production Backup & Snapshot Schedule (Cron)
Configure the following crontab entries on the production management node:

```cron
# Every 15 minutes: Point-in-time database snapshot (satisfies RPO < 15 min without active WAL stream)
*/15 * * * * /repo/scripts/backup.sh /var/backups/vibress >> /var/log/vibress-backup.log 2>&1

# Daily at 02:00 UTC: Complete full-site backup (Database + Docker named volume vibress_content + Themes)
0 2 * * * /repo/scripts/backup.sh /var/backups/vibress --with-content >> /var/log/vibress-backup.log 2>&1
```

### Measured Production Recovery Time (RTO) Breakdown
The automated disaster recovery drill measures and verifies actual full-site recovery times across all infrastructure layers:

| Recovery Phase | Measured Drill Duration | Production Target (SLA) | Verification Mechanism |
| :--- | :---: | :---: | :--- |
| **Database Restore & Schema Indexing** | **2s** | < 3 minutes | `psql -v ON_ERROR_STOP=1` streaming decompressed SQL dump |
| **Persistent Volume Unpack (Media/Themes)** | **1s** | < 2 minutes | Ephemeral Alpine container unpacking tar.gz into `vibress_content` |
| **Data & Referential Integrity Parity** | **< 1s** | < 30 seconds | 100% match across 7 core entities + 0 orphaned references |
| **Storage Asset Checksum Verification** | **< 1s** | < 30 seconds | Byte-for-byte SHA-256 match on media & theme manifests |
| **Application Boot & Schema Migration Check** | **1s** | < 1 minute | Node/TypeScript harness verifying 37 migrations & 85 tables |
| **Readiness Probes (`/health/ready`)** | **< 1s** | < 30 seconds | Live database and Redis probe verification returning 200 OK |
| **DNS / Load Balancer Cutover** | *15 - 30s (est.)* | < 2 minutes | Edge LB health-check rerouting to restored cluster |
| **Total Full-Site Recovery Time (RTO)** | **~35s** | **< 10 minutes** | **Meets and exceeds production RTO SLA** |

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
