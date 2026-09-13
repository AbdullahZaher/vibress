# Vibress

[![CI](https://github.com/AbdullahZaher/vibress/actions/workflows/ci.yml/badge.svg)](https://github.com/AbdullahZaher/vibress/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/AbdullahZaher/vibress?color=blue)](https://github.com/AbdullahZaher/vibress/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node: >=24.0.0](https://img.shields.io/badge/Node-%3E%3D24.0.0-brightgreen.svg)](package.json)
[![pnpm: >=11.17.0](https://img.shields.io/badge/pnpm-%3E%3D11.17.0-orange.svg)](package.json)

**Vibress** is a modern, high-performance, open-source Content Management System (CMS) and publication platform designed as a self-hosted, full-stack alternative to existing CMS engines.

The name **Vibress** represents:
- **Vibe**: Fast, modern, AI-assisted development and elegant creator workflows.
- **Press**: Robust publishing, content management, and audience monetization.

---

## Key Capabilities

* **API-First Modular Architecture**: Decoupled Fastify REST API backend, Next.js Server-Side Rendered (SSR) public web, and Vite + React Admin & Portal SPAs.
* **Studio Block Editor**: High-fidelity collaborative block editor supporting all 13 canonical Studio cards (`Callout`, `Button`, `Bookmark`, `Gallery`, `Video`, `Audio`, `File`, `Divider`, `Product`, `Embed`, `Header`, `Markdown`, `HTML`).
* **Arabic-First Multilingual & RTL**: Built-in RTL layout detection, Umm al-Qura Hijri calendar formatting, and multilingual translation management.
* **Subscriptions & Monetization**: Tiered subscription plans, member access gating, Stripe billing integration, and paid newsletters.
* **Search 2.0**: High-speed full-text and trigram fuzzy search powered by PostgreSQL `pg_trgm` GIN indexes with sub-millisecond query latencies.
* **Secure Sandbox & Extensibility**: Sandboxed plugin architecture, SHA-256 verified themes with Liquid templating, and Webhook event dispatching.
* **Enterprise Reliability**: Real-time collaborative CRDT document editing (Yjs), transactional outbox event delivery, Prometheus metrics, and OpenTelemetry tracing.

---

## Architecture Overview

```
                          ┌──────────────────────────┐
                          │   Host / Ingress Gateway │
                          │       (Port: 7777)       │
                          └─────────────┬────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
   ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
   │    apps/web       │      │    apps/admin     │      │   apps/portal     │
   │  Next.js 14 SSR   │      │  Vite/React SPA   │      │  Vite/React SPA   │
   │   (Port: 7778)    │      │   (Port: 7779)    │      │   (Port: 7781)    │
   └─────────┬─────────┘      └─────────┬─────────┘      └─────────┬─────────┘
             │                          │                          │
             └──────────────────────────┼──────────────────────────┘
                                        │
                                        ▼
                              ┌───────────────────┐
                              │     apps/api      │
                              │    Fastify REST   │
                              │   (Port: 7780)    │
                              └─────────┬─────────┘
                                        │
                     ┌──────────────────┴──────────────────┐
                     ▼                                     ▼
           ┌───────────────────┐                 ┌───────────────────┐
           │    PostgreSQL     │                 │   Redis / Queue   │
           │  (Drizzle ORM)    │                 │ (BullMQ / Worker) │
           └───────────────────┘                 └───────────────────┘
```

The production topology separates internal databases and caches into a dedicated, unexposed internal network (`internal: true`).

---

## Quick Start Guide

### Option 1: Docker Compose (Recommended)

**Prerequisites:** Docker Engine 24+ and Docker Compose v2.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/AbdullahZaher/vibress.git
   cd vibress
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Start development infrastructure (Postgres, Redis, MinIO, Mailpit):**
   ```bash
   pnpm dev:infra
   ```

4. **Start all development servers:**
   ```bash
   pnpm dev
   ```

5. **Access services:**
   - **Public Website:** [http://localhost:7778](http://localhost:7778)
   - **Admin Dashboard:** [http://localhost:7779/admin/](http://localhost:7779/admin/)
   - **Core REST API:** [http://localhost:7780](http://localhost:7780)
   - **Member Portal:** [http://localhost:7781/portal/](http://localhost:7781/portal/)
   - **Gateway Ingress:** [http://localhost:7777](http://localhost:7777)

---

### Option 2: Local Node.js Development

**Prerequisites:** Node.js `>= 24.0.0 < 25`, `pnpm >= 11.17.0`, PostgreSQL 16+, Redis 7+.

1. **Install dependencies:**
   ```bash
   pnpm install --frozen-lockfile
   ```

2. **Run database migrations & seed baseline data:**
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

3. **Start dev processes:**
   ```bash
   pnpm dev
   ```

---

## Verification & Quality Gates

Run the complete test and static analysis suite:

```bash
# Typecheck all packages
pnpm typecheck

# Lint all code
pnpm lint

# Run all unit and integration tests (1,074+ tests)
pnpm vitest run

# Build all production bundles
pnpm build

# Run non-destructive production smoke tests
pnpm production:smoke
```

---

## Documentation & Operations

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- [**Self-Hosting Guide**](docs/deployment/SELF_HOSTING.md) — Step-by-step production deployment on VPS/bare-metal.
- [**Production Runbook**](docs/deployment/PRODUCTION.md) — Security hardening, environment configuration, and scaling.
- [**Docker Deployment**](docs/deployment/DOCKER.md) — Container topology, volumes, and health checks.
- [**Backup & Disaster Recovery**](docs/deployment/SELF_HOSTING.md#10-backup--disaster-recovery) — Automated transactional backup and restore procedures.
- [**Troubleshooting & Runbooks**](docs/deployment/TROUBLESHOOTING.md) — Diagnostic guides and incident remediation.
- [**Changelog & Release Notes**](CHANGELOG.md) — Full release history and migration notes.

---

## Security

For security vulnerability reporting and policies, please review [SECURITY.md](SECURITY.md). Do not file public GitHub issues for security vulnerabilities.

---

## Contributing

We welcome community contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution workflows, code quality guidelines, and testing requirements.

---

## License

Vibress is open-source software licensed under the [MIT License](LICENSE).
