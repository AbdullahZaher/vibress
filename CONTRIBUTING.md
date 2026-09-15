# Contributing to Vibress

Thank you for your interest in contributing to **Vibress**! Vibress is an open-source, modern, full-stack publishing platform and CMS built with TypeScript, Node.js, Fastify, Next.js, and React.

---

## 1. Prerequisites

Before contributing, ensure your environment meets the following requirements:

* **Node.js:** `>= 24.0.0 < 25` (e.g. Node `v24.16.0`)
* **Package Manager:** `pnpm` `>= 11.17.0` (Recommended: `pnpm@11.22.0`)
* **Docker & Docker Compose:** Required for local PostgreSQL, Redis, and MinIO development infrastructure.

---

## 2. Getting Started & Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/vibress.git
   cd vibress
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Install dependencies:**
   ```bash
   pnpm install --frozen-lockfile
   ```

4. **Start local infrastructure services:**
   ```bash
   pnpm dev:infra
   ```
   *(Spawns PostgreSQL on port `5433`, Redis on `6380`, MinIO on `9000`/`9001`, and Mailpit on `8025`/`1025`).*

5. **Run database migrations & seed baseline data:**
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

6. **Start development servers:**
   ```bash
   pnpm dev
   ```
   - **Public SSR Web:** `http://localhost:7778`
   - **Admin Dashboard:** `http://localhost:7779/admin/`
   - **Core REST API:** `http://localhost:7780`
   - **Member Portal:** `http://localhost:7781/portal/`
   - **Gateway Ingress:** `http://localhost:7777`

---

## 3. Repository Architecture & Directory Layout

Vibress is organized as a pnpm monorepo managed with Nx tooling:

- `apps/`
  - `api/` — Core Fastify REST API, authentication, RBAC, WebSocket sync server.
  - `worker/` — Background task processing, email delivery, transactional outbox dispatch, indexer.
  - `web/` — Public-facing Next.js Server-Side Rendered (SSR) publication frontend.
  - `admin/` — Vite + React Single-Page Application (SPA) for the publication studio and dashboard.
  - `portal/` — Vite + React SPA for member subscriptions, profile, and billing management.
- `packages/`
  - `database/` — Drizzle ORM schemas, PostgreSQL connection pool, migrations.
  - `security/` — Cryptographic utilities, session management, RBAC and authorization guards.
  - `config/` — Strict Zod-validated environment configuration schema.
  - `i18n/` — Internationalization dictionaries, RTL handling, and locale utilities.
  - `theme-core/` — Theme engine, Liquid template renderer, and asset pipeline.
  - `studio-*` — Block editor, serializers, renderers, and custom card extensions.
  - `domains/*` — Modular business domains (posts, pages, users, members, billing, etc.).
- `docker/` — Production Dockerfiles for all containerized application services.
- `scripts/` — Operational, deployment, backup, and health check scripts.

---

## 4. Database Migrations Workflow

1. **Schema Changes:** Modify schema definitions in `packages/database/src/schema/`.
2. **Generate Migration:**
   ```bash
   pnpm db:generate
   ```
3. **Apply Migration Locally:**
   ```bash
   pnpm db:migrate
   ```
4. **Seed Baseline Data:**
   ```bash
   pnpm db:seed
   ```

*Note:* All migrations must be additive and safe for zero-downtime execution. Do not write destructive column drops in production migrations.

---

## 5. Testing & Code Quality Verification

Before submitting a Pull Request, all CI checks must pass locally:

```bash
# 1. Typecheck across all workspace packages
pnpm typecheck

# 2. ESLint linting across all packages
pnpm lint

# 3. Explicit-any guard
pnpm verify:explicit-any

# 4. Unit & Integration tests
pnpm vitest run

# 5. Production build verification
pnpm build

# 6. Verify clean working tree
pnpm verify:clean-tree
```

---

## 6. Security & Authorization Rules

- **Permission Enforcement:** All administrative routes must be guarded with `requirePermission()` from `@vibress/security`.
- **Tenant & Publication Isolation:** Always scope database queries by `publicationId` and `workspaceId`. Never accept caller-supplied tenant IDs from untrusted headers.
- **Input Sanitization:** Validate all request payloads using Zod schemas.

---

## 7. Pull Request Process

1. **Create a topic branch:** Branch from `main` (`feat/your-feature`, `fix/your-fix`).
2. **Commit Convention:** Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`).
3. **Fill PR Template:** Ensure the PR template checklist is completely filled out.
4. **Clean Git Tree:** Do not commit generated build artifacts, temporary log files, `.env` files, or database backups.
