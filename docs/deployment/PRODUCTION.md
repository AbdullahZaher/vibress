# Vibress Production Operations & Deployment Manual

This manual contains the official architecture specification, security controls,
operational runbooks, and disaster recovery procedures for running **Vibress**
in production.

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

All production settings are validated at boot by `@vibress/config`. If any
required variable is missing or insecure, the process halts immediately with
`ConfigError`.

| Environment Variable            | Required | Description                                                        |
| :------------------------------ | :------: | :----------------------------------------------------------------- |
| `NODE_ENV`                      |   Yes    | Must be set to `production`.                                       |
| `POSTGRES_PASSWORD`             |   Yes    | Strong database password (no default).                             |
| `VIBRESS_ENCRYPTION_KEY`        |   Yes    | 32-byte hex string for AES-256-GCM field encryption.               |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` |   Yes    | 32-byte hex secret for cryptographic unsubscribe tokens.           |
| `STRIPE_SECRET_KEY`             | Optional | Live Stripe API secret key (`sk_live_...`).                        |
| `STRIPE_WEBHOOK_SECRET`         | Optional | Stripe webhook signing secret (`whsec_...`).                       |
| `SMTP_HOST`                     |   Yes    | Production SMTP relay hostname.                                    |
| `SMTP_PORT`                     |   Yes    | Production SMTP port (e.g. `587` or `465`).                        |
| `SMTP_USER` / `SMTP_PASS`       |   Yes    | Production SMTP relay credentials.                                 |
| `SMTP_FROM`                     |   Yes    | Outbound sender identity (`Vibress <no-reply@domain.com>`).        |
| `STORAGE_PROVIDER`              |   Yes    | `local` for container volumes, or `s3` for AWS S3 / Cloudflare R2. |

---

## 3. Database Deployment & Migration Safety

- **Database Version:** PostgreSQL 16+ with extensions: `pg_trgm`, `btree_gin`,
  `uuid-ossp`.
- **Migration Strategy:** All 37 schema migrations (0000 to 0036) are strictly
  additive and backwards-compatible. Rolling container replacement does not
  cause schema lock conflicts.
- **Execution:**
  ```bash
  docker compose -f compose.prod.yml run --rm migrate
  ```

---

## 4. Disaster Recovery & Backup Runbook

### Database & Storage Backup Architecture

Vibress supports both local Docker named volume storage and S3-compatible cloud
object storage (AWS S3, MinIO, Cloudflare R2). Backups produce compressed,
structurally validated archives with SHA-256 integrity checksums:

```bash
# Database backup only (PostgreSQL logical snapshot)
./scripts/backup.sh /path/to/backup/storage

# Database + persistent local Docker volume (vibress_content media & themes)
./scripts/backup.sh /path/to/backup/storage --with-content

# Database + S3-compatible object storage (all media, themes, and manifests)
# (Automatically triggered if STORAGE_PROVIDER=s3 or via explicit flag)
./scripts/backup.sh /path/to/backup/storage --with-s3 --s3-bucket my-production-bucket
```

#### S3 Backup Requirements & Fail-Closed Guarantees

The S3 backup engine (`scripts/s3-backup.mjs`) connects to any standard
S3-compatible API using `@aws-sdk/client-s3`.

- **Fail-Closed Behavior:** If S3 is the active storage provider or `--with-s3`
  is passed, the backup script aborts immediately with a non-zero exit code if
  credentials are missing, the bucket is unreachable, or any object transfer
  fails. A partial or corrupted S3 backup will **never** report full-site
  success.
- **Integrity Validation:** Every object is SHA-256 hashed and recorded in
  `inventory.json` inside the archive. The archive itself is verified with
  `gzip -t` and accompanied by a standalone `.sha256` checksum file.
- **Required IAM Permissions:**
  ```json
  {
     "Version": "2012-10-17",
     "Statement": [
        {
           "Effect": "Allow",
           "Action": [
              "s3:ListBucket",
              "s3:GetObject"
           ],
           "Resource": [
              "arn:aws:s3:::my-production-bucket",
              "arn:aws:s3:::my-production-bucket/*"
           ]
        }
     ]
  }
  ```

### Database & Storage Restoration

Restoration operations enforce strict safety gates:

- Database restores execute with `ON_ERROR_STOP=1` to fail immediately upon any
  SQL error.
- Destructive confirmation (`--confirm` or interactive operator confirmation) is
  mandatory.
- S3 restores validate the archive format and companion `.sha256` checksum
  **before** modifying any destination.

```bash
# Interactive database restore (prompts operator for confirmation)
./scripts/restore.sh /path/to/backup/storage/vibress_backup_TIMESTAMP.sql.gz

# Automated restore to target database with non-interactive confirmation
./scripts/restore.sh /path/to/backup/storage/vibress_backup_TIMESTAMP.sql.gz target_db --confirm

# Full-site restore including local Docker named volume vibress_content
./scripts/restore.sh /path/to/backup/storage/vibress_backup_TIMESTAMP.sql.gz target_db --with-content --confirm

# Full-site restore including S3 object storage into an isolated target bucket or staging prefix
./scripts/restore.sh /path/to/backup/storage/vibress_backup_TIMESTAMP.sql.gz target_db \
  --with-s3 /path/to/backup/storage/vibress_s3_TIMESTAMP.tar.gz \
  --s3-bucket isolated-restore-bucket \
  --s3-prefix staging/ \
  --confirm
```

Restored S3 objects are verified byte-for-byte against the backup's
`inventory.json` hashes before the restore reports success.

### Automated Disaster Recovery Drills

Execute automated end-to-end backup, restore, checksum verification, and entity
parity assertion against an isolated disposable database:

```bash
./scripts/disaster-recovery-drill.sh
```

### Theme Storage & Generation Retention

Theme packages in object storage follow the **N-1 Bounded Generation Retention**
contract:

- **Active Generation ($G_n$)**: Preserved in storage and referenced by
  `manifest.generation`.
- **Immediate Previous Generation ($G_{n-1}$)**: Explicitly retained for
  in-flight readers and referenced by `manifest.previousGeneration`.
- **Generations Older than $G_{n-1}$**: Cleaned up during package replacement
  once $G_n$ is authoritative.
- Details: See
  [`packages/domains/themes/THEME_STORAGE_LIFECYCLE.md`](/vibress/packages/domains/themes/THEME_STORAGE_LIFECYCLE.md).

### Continuous WAL Archiving & Point-In-Time Recovery (PITR)

> [!IMPORTANT]
> A logical `pg_dump` SQL snapshot is **not** a physical base backup and cannot
> be used for PostgreSQL Write-Ahead Log (WAL) replay. For continuous
> point-in-time recovery, physical base backups and continuous WAL archiving are
> required.

`compose.prod.yml` pre-configures PostgreSQL with continuous WAL archiving to
the dedicated `postgres_wal` volume:

```ini
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /var/lib/postgresql/wal_archive/%f && cp %p /var/lib/postgresql/wal_archive/%f'
archive_timeout = 900 # Forces a WAL segment switch every 15 minutes during low activity
```

#### Production RPO Analysis by Failure Scenario

Recovery Point Objectives (RPO) depend strictly on the failure scenario and
storage durability:

| Failure Scenario                                  | Recovery Mechanism                                      |    Effective RPO Guarantee     | Prerequisites & Operational Notes                                                                                                                                         |
| :------------------------------------------------ | :------------------------------------------------------ | :----------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PostgreSQL Process Crash / Restart**            | Local WAL replay during container startup               |  **RPO = 0 (Zero data loss)**  | Handled automatically by PostgreSQL crash recovery using local `pg_wal`.                                                                                                  |
| **Single-Host Disk / Host Loss (Local WAL only)** | N/A (Storage lost with host)                            |   **Unbounded / Data Loss**    | A local named volume `postgres_wal` resides on the same host and offers **no protection** against host loss.                                                              |
| **Host Loss with Off-Host WAL Shipping**          | Replay of archived WAL segments from S3 / remote target |    **RPO $\le$ 15 minutes**    | Bounded by `archive_timeout = 900`. High write activity archives segments faster, but worst-case loss is 15 minutes unless synchronous streaming replication is deployed. |
| **Scheduled Snapshot Restoration**                | Restore from latest off-host cron backup                |    **RPO $\le$ 15 minutes**    | For installations using 15-minute cron snapshots (`backup.sh`).                                                                                                           |
| **Point-In-Time Replay Boundary**                 | Physical `pg_basebackup` + WAL replay to target second  | **Exact Transaction Boundary** | Valid for all transactions committed within successfully archived segments up to the target timestamp.                                                                    |

> [!TIP]
> For production cloud deployments requiring true zero-RPO failover under
> complete host loss, configure an off-host `archive_command` (e.g. shipping WAL
> segments directly to durable S3 storage via `aws s3 cp` or `wal-g`) and pair
> it with PostgreSQL synchronous streaming replication to a remote standby.

#### Executing Physical Base Backup & WAL PITR

Vibress provides an automated PITR drill (`scripts/wal-pitr-drill.sh`)
demonstrating point-in-time recovery using physical backups:

1. **Take Physical Base Backup:**
   ```bash
   docker compose -f compose.prod.yml exec -T postgres pg_basebackup -U postgres -D - -Ft -z > base_backup.tar.gz
   ```
2. **Replay WAL to Target Timestamp:** Unpack the base backup into an isolated
   PostgreSQL data directory, mount the `postgres_wal` archive, and configure
   recovery signals:
   ```bash
   touch /path/to/isolated/data/recovery.signal
   ```
   Add to `postgresql.conf`:
   ```ini
   restore_command = 'cp /var/lib/postgresql/wal_archive/%f %p'
   recovery_target_time = '2026-10-14 12:00:00 UTC'
   recovery_target_action = 'promote'
   ```
3. Start the isolated PostgreSQL container. The database replays transactions
   committed up to the specified second and promotes automatically, preserving
   transaction boundaries.

### Production Backup & Snapshot Schedule (Cron)

Configure crontab entries on the production management node according to your storage provider:

**For Local Storage Deployments (`STORAGE_PROVIDER=local`):**
```cron
# Every 15 minutes: Logical database snapshot (satisfies RPO <= 15 min for scheduled snapshots)
*/15 * * * * /repo/scripts/backup.sh /var/backups/vibress >> /var/log/vibress-backup.log 2>&1

# Daily at 02:00 UTC: Database + persistent media & themes volume (vibress_content)
0 2 * * * /repo/scripts/backup.sh /var/backups/vibress --with-content >> /var/log/vibress-backup.log 2>&1
```

**For S3 Cloud Storage Deployments (`STORAGE_PROVIDER=s3`):**
```cron
# Every 15 minutes: Logical database snapshot
*/15 * * * * /repo/scripts/backup.sh /var/backups/vibress >> /var/log/vibress-backup.log 2>&1

# Daily at 02:00 UTC: Database + S3 object storage bucket
0 2 * * * /repo/scripts/backup.sh /var/backups/vibress --with-s3 --s3-bucket my-production-bucket >> /var/log/vibress-backup.log 2>&1
```

**For Hybrid Deployments (Local cache volume + S3 cloud storage):**
```cron
0 2 * * * /repo/scripts/backup.sh /var/backups/vibress --with-content --with-s3 --s3-bucket my-production-bucket >> /var/log/vibress-backup.log 2>&1
```

### Recovery Time Objective (RTO): Measured Drill vs Production Target

The automated disaster recovery drill (`scripts/disaster-recovery-drill.sh`)
measures and benchmarks local recovery duration on disposable infrastructure.
This provides a baseline for core engine performance, distinct from full-scale
production cluster failover:

| Recovery Phase                                             |  Measured Local Drill Duration  | Full Production Target (SLA) | Operational Scope & Verification Mechanism                                    |
| :--------------------------------------------------------- | :-----------------------------: | :--------------------------: | :---------------------------------------------------------------------------- |
| **Database Restore & Schema Indexing**                     |            **1.5s**             |         < 3 minutes          | `psql -v ON_ERROR_STOP=1` streaming decompressed SQL dump (local seed data)   |
| **Persistent Volume Unpack (Media/Themes)**                |            **1.0s**             |         < 2 minutes          | Ephemeral Alpine container unpacking tar.gz into isolated volume              |
| **S3 Object Storage Restoration**                          |            **1.0s**             |         < 2 minutes          | `s3-restore.mjs` uploading objects and verifying SHA-256 hashes               |
| **Data & Referential Integrity Parity**                    |           **< 0.5s**            |         < 30 seconds         | 100% match across 7 core entities + 0 orphaned references                     |
| **Storage Asset Checksum Verification**                    |           **< 0.5s**            |         < 30 seconds         | Byte-for-byte SHA-256 match on media, theme files, and manifests              |
| **Application Boot & Real HTTP Readiness**                 |            **1.9s**             |          < 1 minute          | Isolated Fastify API boot, Redis connection, `/health/ready` 200 OK           |
| **Total Measured Local Recovery Harness**                  |           **~5.98s**            |              —               | **Measured local DR drill on baseline test dataset**                          |
| _Full Production Orchestration (Web SSR, Worker, Ingress)_ | _Pending Staging Certification_ |         < 3 minutes          | Full multi-container startup, Next.js warm-up, and background queue reconnect |
| _Edge DNS / CDN Cutover (Estimated)_                       |        _15 - 30s (est.)_        |         < 2 minutes          | Edge LB / Anycast DNS TTL propagation to new cluster ingress                  |
| **Total Production-Wide Target RTO**                       |                —                |       **< 10 minutes**       | **Target SLA to be certified on multi-GB staging deployment**                 |

> [!NOTE]
> The ~5.98-second benchmark certifies the speed and correctness of the
> automated recovery scripts and core API initialization on isolated local
> infrastructure. Full production RTO certification requires testing against
> customer-scale data volumes and the complete multi-service Docker Compose
> deployment.

---

## 5. Automated Health Probes

Load balancers and monitoring systems should scrape the following health probes:

- **Gateway Health:** `http://127.0.0.1:7777/nginx-health` (HTTP 200)
- **API Liveness:** `http://127.0.0.1:7777/health/live` (HTTP 200)
- **API Readiness:** `http://127.0.0.1:7777/health/ready` (HTTP 200 when
  PostgreSQL & Redis are connected; HTTP 503 if degraded)
- **Worker Readiness:** `http://127.0.0.1:7777/worker-health/ready` (HTTP 200)
- **Prometheus Metrics:** `http://127.0.0.1:7777/metrics` (Restricted to
  internal RFC1918 subnets)

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

---

## 7. Reverse Proxy, CDN & Trusted Proxy Configuration (Cloudflare / AWS ALB)

### Default Compose Topology (Gateway -> API)
In the default `compose.prod.yml` topology, the Nginx gateway is the single public entry point:
- The gateway listens externally (port 7777/8080) and sets `proxy_set_header X-Forwarded-For $remote_addr;` when proxying to internal upstream apps. Client-supplied `X-Forwarded-For` headers are intentionally overwritten, preventing spoofed IP injection.
- Fastify defaults to `TRUST_PROXY=1` (1 hop), trusting the immediate gateway peer and resolving `req.ip` from the gateway-provided address.

### Deploying Behind Cloudflare, AWS ALB, or Reverse Proxies
When placing Vibress behind an external CDN or Layer 7 Load Balancer, **do not change `TRUST_PROXY=1`** in the application container. Because the shipped Nginx gateway always overwrites `X-Forwarded-For` with `$remote_addr`, attempting to set `TRUST_PROXY=2` in Fastify does not work: the external load balancer's forwarded header is discarded at the gateway, collapsing all visitors into the load balancer's IP address and causing shared rate-limit buckets and self-inflicted lockouts.

The **only supported approach** with the shipped gateway is configuring the Nginx `realip` module in `infrastructure/nginx/nginx.prod.conf`:

1. **Nginx Gateway (`infrastructure/nginx/nginx.prod.conf`):**
   Configure `set_real_ip_from` for each upstream CDN or load balancer CIDR block, set `real_ip_header`, and enable `real_ip_recursive on`:
   ```nginx
   # Cloudflare IPv4 ranges (or AWS VPC CIDRs / ALB subnet)
   set_real_ip_from 173.245.48.0/20;
   set_real_ip_from 103.21.244.0/22;
   set_real_ip_from 10.0.0.0/8;        # Internal ALB/VPC range
   real_ip_header   X-Forwarded-For;   # Or CF-Connecting-IP for Cloudflare
   real_ip_recursive on;
   ```
   With `realip` active, Nginx validates the upstream proxy IP and safely rewrites `$remote_addr` to the true originating client IP before setting `X-Forwarded-For: $remote_addr` upstream to Fastify.

2. **Application Environment (`TRUST_PROXY`):**
   Keep `TRUST_PROXY=1` unchanged in `.env`. Fastify continues to trust exactly 1 hop (the internal Nginx gateway).

   > [!NOTE]
   > Setting `TRUST_PROXY=2` or passing a CIDR list in Fastify is only applicable if deploying the API container directly exposed to the external load balancer without the shipped Nginx gateway.

   > [!WARNING]
   > Never set `TRUST_PROXY=true` (trust all) in production. Setting `TRUST_PROXY=true` trusts all hops unconditionally, allowing malicious clients to spoof their IP address by injecting arbitrary `X-Forwarded-For` headers. The API logs a security warning at startup if this misconfiguration is detected.

### Account-Level Throttling & Lockout
To protect against credential stuffing attacks rotating across multiple IP addresses, Vibress enforces Redis-backed account-level throttling:
- **Staff Login (`/api/admin/v1/auth/login`):** Maximum 5 failed attempts per normalized email + client subnet (IPv4 `/24`, IPv6 `/64`) within a 15-minute window triggers a 15-minute lockout (HTTP 429) for that subnet. To defend against distributed attacks across rotating subnets without locking out the owner, a global per-email ceiling (20 failures) applies a progressive delay (100ms to 1000ms, capped). This global ceiling slows down distributed attacks, but deliberately does not cap or hard-lock the account across all IPs. If Redis is unreachable, login fails closed (HTTP 503) to prevent brute-forcing during cache outages.
- **Member Authentication (`/api/members/v1/auth/*`):** Rate limits magic link requests (5 per normalized email per 10-minute window) and token verification attempts (5 per token per 15-minute window), resetting on successful authentication.

