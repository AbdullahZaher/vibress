# Development Environment

## Recommended local model

Run infrastructure in Docker:

```text
PostgreSQL
Redis
MinIO
Mailpit
```

Run application processes on the host:

```text
Admin
Web
API
Worker
Portal
```

This gives faster hot reload than containerizing every Node process during daily development.

## Example compose services

```text
postgres
redis
minio
mailpit
```

## Local storage

Use MinIO to test the same object-storage abstraction used by S3/R2.

## Local email

Use Mailpit or equivalent SMTP capture.

## Developer scripts

Recommended root scripts:

```text
pnpm dev
pnpm dev:infra
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm db:migrate
pnpm db:seed
```

## Environment configuration

Provide:

```text
.env.example
.env.test.example
```

Never commit actual secrets.

## Canonical development ports

Vibress uses a unified development gateway.

```text
Main development URL:
http://localhost:7777
```

| Service | Port |
|---|---:|
| Gateway | **7777** |
| Web | 7778 |
| Admin | 7779 |
| API | 7780 |
| Portal | 7781 |
| Worker health/metrics | 7782 |

Routing:

```text
localhost:7777
├── /        → Web
├── /admin   → Admin
├── /portal  → Portal
└── /api     → API
```

See `14-decisions/ADR-011-development-ports.md`.
