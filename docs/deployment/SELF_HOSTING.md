# Self-Hosting Vibress

This guide provides step-by-step instructions for self-hosting **Vibress** on
your own server or VPS (e.g. Hetzner, DigitalOcean, AWS EC2, Linode) using
Docker Compose.

---

## 1. System Requirements

- **Operating System:** Linux (Ubuntu 22.04 / 24.04 LTS, Debian 12, Rocky Linux
  9, Arch Linux)
- **CPU:** 2 vCPU cores minimum (4 vCPU recommended for high concurrency)
- **RAM:** 4 GB RAM minimum (8 GB recommended)
- **Storage:** 20 GB SSD / NVMe minimum (adjust based on media storage
  requirements)
- **Software:** Docker Engine 24+ and Docker Compose v2

---

## 2. Quick Self-Hosting Installation

### Step 1: Clone Repository

```bash
git clone https://github.com/AbdullahZaher/vibress.git /opt/vibress
cd /opt/vibress
```

### Step 2: Configure Production Environment

Copy the production environment template:

```bash
cp infrastructure/env.prod.example .env
```

Edit `.env` with your domain and secrets:

```bash
nano .env
```

Key variables to configure:

```dotenv
# Your public domain
SITE_URL=https://yourdomain.com
ADMIN_ORIGIN=https://yourdomain.com
PORTAL_ORIGIN=https://yourdomain.com

# Database password
POSTGRES_PASSWORD=generate-a-strong-postgres-password

# Application Secrets (Generate with: openssl rand -hex 32)
VIBRESS_ENCRYPTION_KEY=your-32-byte-hex-encryption-key
NEWSLETTER_UNSUBSCRIBE_SECRET=your-32-byte-hex-unsubscribe-secret
VIBRESS_SETUP_TOKEN=your-32-byte-hex-setup-token

# SMTP Email Relay
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=Vibress <no-reply@yourdomain.com>

# Storage Configuration (Local canonical storage root)
# Note: Containers mount the persistent Docker named volume `vibress_content` at `/repo/content`.
# Setting STORAGE_LOCAL_ROOT=/repo/content/media ensures all uploaded assets persist across container recreation.
STORAGE_PROVIDER=local
STORAGE_LOCAL_ROOT=/repo/content/media
```

### Step 3: Run Canonical Production Deployment

Execute the canonical deployment script which handles preflight, backups,
migrations, container startup, and health verification:

```bash
./scripts/deploy-production.sh
```

---

## 3. Reverse Proxy & TLS Termination

The Vibress gateway listens on port `7777` by default. Place a reverse proxy
(Caddy, NGINX, or Cloudflare Tunnel) in front of port 7777 to provide HTTPS /
TLS termination.

### Option A: Caddyfile Example (Recommended for Automatic SSL)

```caddy
yourdomain.com {
    reverse_proxy 127.0.0.1:7777 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### Option B: Host NGINX Example

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    client_max_body_size 600M;

    location / {
        proxy_pass http://127.0.0.1:7777;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

---

## 4. First-Run Setup Wizard

1. Open your browser and navigate to `https://yourdomain.com/admin/`.
2. Follow the setup wizard to create your primary **Owner** account.
3. Configure your publication name, default locale (e.g. English `en` or Arabic
   `ar`), and design theme.
4. Once completed, the setup endpoint locks permanently
   (`OWNER_ALREADY_EXISTS`).

---

## 5. Maintenance, Backups & Upgrades

### Database & Storage Backups

Run a backup at any time (produces verified compressed archives and standalone
SHA-256 checksums):

```bash
# Database backup only
./scripts/backup.sh /opt/vibress/backups

# Include persistent media and themes (Docker named volume vibress_content)
./scripts/backup.sh /opt/vibress/backups --with-content

# Include S3-compatible cloud object storage (AWS S3, MinIO, Cloudflare R2)
# (Fails closed if bucket is unreachable or credentials are missing)
./scripts/backup.sh /opt/vibress/backups --with-s3 --s3-bucket my-backup-bucket
```

To schedule automated production backups via cron:

```bash
crontab -e
```

**Option A: For Local Storage Installations (`STORAGE_PROVIDER=local`):**
```cron
# 1. Every 15 minutes: Logical database snapshot (satisfies RPO < 15 min for scheduled snapshots)
*/15 * * * * /opt/vibress/scripts/backup.sh /opt/vibress/backups >> /var/log/vibress-backup.log 2>&1

# 2. Daily at 02:00 UTC: Database + persistent media & themes volume (vibress_content)
0 2 * * * /opt/vibress/scripts/backup.sh /opt/vibress/backups --with-content >> /var/log/vibress-backup.log 2>&1
```

**Option B: For S3 / Cloud Storage Installations (`STORAGE_PROVIDER=s3`):**
```cron
# 1. Every 15 minutes: Logical database snapshot
*/15 * * * * /opt/vibress/scripts/backup.sh /opt/vibress/backups >> /var/log/vibress-backup.log 2>&1

# 2. Daily at 02:00 UTC: Database + S3 object storage bucket
0 2 * * * /opt/vibress/scripts/backup.sh /opt/vibress/backups --with-s3 --s3-bucket my-backup-bucket >> /var/log/vibress-backup.log 2>&1
```

**Option C: For Hybrid Installations (Local cache volume + S3 offsite storage):**
```cron
0 2 * * * /opt/vibress/scripts/backup.sh /opt/vibress/backups --with-content --with-s3 --s3-bucket my-backup-bucket >> /var/log/vibress-backup.log 2>&1
```

> [!TIP]
> For continuous data protection and Point-In-Time Recovery (PITR) to exact
> transaction boundaries, `compose.prod.yml` pre-configures PostgreSQL
> continuous Write-Ahead Log (WAL) archiving to the `postgres_wal` volume. For
> catastrophic host loss protection, ship WAL segments off-host to durable S3
> storage. See
> [`docs/deployment/PRODUCTION.md`](/vibress/docs/deployment/PRODUCTION.md) for
> detailed failure-scenario RPO analysis and PITR instructions.

### Restoring Backups

Restores require explicit confirmation before proceeding (`--confirm`) and
execute with strict error handling (`ON_ERROR_STOP=1`):

```bash
# Interactive database restore (prompts operator for confirmation)
./scripts/restore.sh /opt/vibress/backups/vibress_backup_YYYYMMDD_HHMMSS.sql.gz

# Full-site restore (Database + Persistent Volume Media/Themes)
./scripts/restore.sh /opt/vibress/backups/vibress_backup_YYYYMMDD_HHMMSS.sql.gz target_db --with-content --confirm

# Full-site restore including S3 object storage into an isolated target bucket
./scripts/restore.sh /opt/vibress/backups/vibress_backup_YYYYMMDD_HHMMSS.sql.gz target_db \
  --with-s3 /opt/vibress/backups/vibress_s3_YYYYMMDD_HHMMSS.tar.gz \
  --s3-bucket isolated-restore-bucket \
  --confirm
```

### Full-Site Disaster Recovery Drills

Verify full-site recovery execution, SHA-256 checksums, data entity parity,
storage asset parity, and real Fastify HTTP application boot readiness on
isolated disposable targets:

```bash
./scripts/disaster-recovery-drill.sh
```

### Upgrading to New Releases

Pre-upgrade backups are mandatory. Run the backup command matching your storage provider:

```bash
# For Local Storage (default):
./scripts/backup.sh /opt/vibress/backups --with-content

# For S3 Cloud Storage:
# ./scripts/backup.sh /opt/vibress/backups --with-s3 --s3-bucket my-backup-bucket

# Pull release and deploy (deploy-production.sh automatically enforces pre-deployment upgrade backups):
git pull origin main --tags
git checkout v1.2.0
./scripts/deploy-production.sh
```
