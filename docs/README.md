# Vibress Architecture Documentation

Vibress is a modern publishing, membership, newsletter, analytics, and extensibility platform inspired by the architectural strengths of Ghost while avoiding legacy coupling.

The system is designed as a **TypeScript modular monolith** with strong domain boundaries, a separate editor product called **Vibress Studio**, and a plugin ecosystem for storage, integrations, editor extensions, analytics, and payments.

## Core principles

1. **Modular monolith first**
   - Keep deployment simple.
   - Keep domain boundaries strict.
   - Extract services only when scale or isolation requires it.

2. **Domain-oriented architecture**
   - Business logic lives inside domain packages.
   - HTTP controllers, database code, UI code, and workers must not own domain rules.

3. **Vibress Studio is independent**
   - The editor is a separate repository/package family.
   - Vibress consumes it as a dependency.
   - Studio must not depend on Vibress Core.

4. **Provider-independent infrastructure**
   - Storage, cache, queues, email, and integrations use interfaces and adapters.
   - S3-compatible storage supports AWS S3, Cloudflare R2, Wasabi, Backblaze B2, DigitalOcean Spaces, Hetzner Object Storage, MinIO, and compatible custom providers.

5. **Extensibility by contract**
   - Plugins integrate through a controlled SDK.
   - Plugins must not reach directly into internal implementation details.

6. **Security by default**
   - Least privilege.
   - Encrypted external credentials.
   - CSRF, SSRF, XSS, upload, rate-limit, and session protections are first-class platform concerns.

## Repositories

```text
vibress-ecosystem/
├── vibress/             # Main CMS/platform
├── vibress-studio/      # Independent editor product
├── vibress-plugins/     # Official plugins/providers
├── vibress-sdk/         # Developer/client SDKs
└── vibress-docs/        # Product and developer documentation
```

## Recommended stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Monorepo | pnpm + Nx |
| Admin | React + Vite |
| Public Web | Next.js |
| Portal | React |
| API | Fastify |
| Validation | Zod |
| Database | PostgreSQL |
| ORM | Drizzle |
| Cache | Redis |
| Queue | BullMQ |
| Editor | Lexical via Vibress Studio |
| UI | Tailwind CSS + shadcn/ui |
| Object Storage | S3-compatible + provider plugins |
| Tests | Vitest |
| E2E | Playwright |
| Logging | Pino |
| Tracing | OpenTelemetry |
| Errors | Sentry |
| Containers | Docker |
| CI/CD | GitHub Actions |

## Documentation map

- `01-architecture/` — system architecture and dependency rules
- `02-apps/` — runtime applications
- `03-domains/` — business domains and boundaries
- `04-data/` — PostgreSQL, Drizzle, migrations, transactions
- `05-platform/` — events, queues, cache, observability, config
- `06-security/` — authentication, authorization, secrets, SSRF, uploads
- `07-storage/` — provider abstraction, S3 compatibility, direct uploads
- `08-plugins/` — plugin lifecycle, SDK, permissions, extension points
- `09-studio/` — Vibress Studio architecture and integration
- `10-api/` — API conventions and contracts
- `11-testing/` — test strategy
- `12-infrastructure/` — development and production deployment
- `13-roadmap/` — recommended implementation phases

This documentation defines **Architecture v1** for Vibress.
