# Production Deployment

## Baseline deployment

```text
Reverse Proxy / CDN
        │
        ├── Admin
        ├── Web
        └── API
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
 PostgreSQL  Redis   Worker
                        │
                        ▼
                     Storage
```

## Containers

Recommended production images:

```text
api.Dockerfile
worker.Dockerfile
admin.Dockerfile
web.Dockerfile
```

Use:

- multi-stage builds
- non-root runtime users
- minimal runtime dependencies
- explicit health checks
- read-only application filesystem where practical
- mounted writable content only where required

## Reverse proxy

Enforce:

- TLS
- request body limits
- upload-specific limits
- security headers
- trusted proxy configuration
- no direct database/Redis exposure

## Secrets

Supply secrets from deployment environment or secret manager.

Examples:

```text
DATABASE_URL
REDIS_URL
VIBRESS_ENCRYPTION_KEY
SESSION_SECRET
```

## Backups

Back up independently:

1. PostgreSQL
2. object storage/content
3. encryption master key
4. deployment configuration

Without the encryption master key, encrypted integration/storage credentials cannot be recovered.
