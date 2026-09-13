# Self-Hosting Vibress

This guide provides step-by-step instructions for self-hosting **Vibress** on your own server or VPS (e.g. Hetzner, DigitalOcean, AWS EC2, Linode) using Docker Compose.

---

## 1. System Requirements

* **Operating System:** Linux (Ubuntu 22.04 / 24.04 LTS, Debian 12, Rocky Linux 9, Arch Linux)
* **CPU:** 2 vCPU cores minimum (4 vCPU recommended for high concurrency)
* **RAM:** 4 GB RAM minimum (8 GB recommended)
* **Storage:** 20 GB SSD / NVMe minimum (adjust based on media storage requirements)
* **Software:** Docker Engine 24+ and Docker Compose v2

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
```

### Step 3: Run Canonical Production Deployment
Execute the canonical deployment script which handles preflight, backups, migrations, container startup, and health verification:
```bash
./scripts/deploy-production.sh
```

---

## 3. Reverse Proxy & TLS Termination

The Vibress gateway listens on port `7777` by default. Place a reverse proxy (Caddy, NGINX, or Cloudflare Tunnel) in front of port 7777 to provide HTTPS / TLS termination.

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
3. Configure your publication name, default locale (e.g. English `en` or Arabic `ar`), and design theme.
4. Once completed, the setup endpoint locks permanently (`OWNER_ALREADY_EXISTS`).

---

## 5. Maintenance, Backups & Upgrades

### Database Backups
Run a database backup at any time:
```bash
./scripts/backup.sh /opt/vibress/backups
```

To schedule daily backups via cron:
```bash
crontab -e
# Add the following line to run backups every day at 02:00 UTC:
0 2 * * * /opt/vibress/scripts/backup.sh /opt/vibress/backups >/dev/null 2>&1
```

### Restoring Backups
```bash
./scripts/restore.sh /opt/vibress/backups/vibress_backup_YYYYMMDD_HHMMSS.sql.gz
```

### Upgrading to New Releases
```bash
./scripts/backup.sh /opt/vibress/backups
git pull origin main --tags
git checkout v1.0.0
./scripts/deploy-production.sh
```
