# Phase 0 — Product Surface Baseline Audit

**Timestamp:** 2026-09-14T09:15:30Z  
**Certified Git Commit:** `a9ef87dea758fd1f233f86543b3725af303cd38c`  
**Git Branch:** `main`  
**Working Tree:** Clean (13 forensic audit markdown documents present in root)

---

## 1. Environment & Runtime Topology

| Subsystem | Component / Version | Runtime Topology | Status |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v24.16.0` | Host runtime | Verified |
| **Package Manager** | `pnpm 11.22.0` | Monorepo package orchestrator | Verified |
| **Monorepo Engine** | `Nx 23.1.1` | 71 projects | Verified |
| **PostgreSQL** | `postgres:16-alpine` | Docker container `vibress-postgres-1` (port 5433 -> 5432) | Healthy |
| **Redis** | `redis:7-alpine` | Docker container `vibress-redis-1` (port 6380 -> 6379, AOF) | Healthy |
| **Object Storage** | MinIO `RELEASE.2025-09-07T16-13-09Z` | Docker container `vibress-minio-1` (port 9000/9001) | Healthy |
| **SMTP / Email** | Mailpit `v1.26` | Docker container `vibress-mailpit-1` (port 1025/8025) | Healthy |
| **Reverse Proxy** | Nginx `1.27-alpine` | Docker container `vibress-gateway-1` (port 7777 -> 7777) | Healthy |

---

## 2. Baseline Verification Results

### 2.1 Typecheck (`pnpm run typecheck`)
- **Command:** `nx run-many --target=typecheck --all`
- **Scope:** 71 monorepo projects
- **Result:** **PASSED (0 errors)**
- **Duration:** 48.5s

### 2.2 Production Build (`pnpm run build`)
- **Command:** `pnpm -r build`
- **Scope:** 
  - Shared domain packages (40+ packages)
  - `apps/api` (Fastify TypeScript build -> `dist/`)
  - `apps/worker` (BullMQ workers -> `dist/`)
  - `apps/web` (Next.js 15.5 App Router static generation & middleware -> `.next/`)
  - `apps/admin` (Vite 8 SPA -> `dist/`)
- **Result:** **PASSED (0 errors)**
- **Duration:** 52.1s

### 2.3 Automated Test Suite (`npx vitest run --passWithNoTests`)
- **Command:** `npx vitest run --passWithNoTests`
- **Test Files:** **140 passed (140)**
- **Tests Total:** **1,126 passed (1,126)**
- **Failures:** **0**
- **Duration:** 126.56s

### 2.4 Database Migration State (`pnpm --filter @vibress/database run db:migrate`)
- **Migrations Applied:** 26 migrations (`0000_graceful_meteorite.sql` through `0025_staff_invitations_and_password_resets.sql`)
- **Migration Status:** Up to date. Zero pending migrations.

---

## 3. Discovered Vulnerabilities & Gaps in Baseline State

Despite 100% passing tests and clean builds, deep forensic analysis identified six critical architectural and security gaps in the current runtime state:

1. **False-Confidence Multi-Tenancy Tests:**
   `packages/domains/workspaces/src/__tests__/tenant-isolation.test.ts` and `tenant-isolation-matrix.test.ts` pass 17 tests exclusively using an in-memory mock repository (`InMemoryWorkspaceRepository`) and `vi.fn()` spies. In PostgreSQL, 14 core tables (`posts`, `pages`, `media_assets`, `tags`, `members`, `products`, `plans`, `newsletters`, `search_documents`, `content_translations`, `automations`, `installed_themes`, `webhook_endpoints`, `analytics_events`) lack `publication_id`.
2. **P0 Untrusted Code Execution in Plugin Core:**
   `packages/plugin-core/src/sandbox.ts` uses Node's standard `node:vm` (`vm.createContext`, `new vm.Script(code).runInContext(...)`), which has known sandbox escapes and lacks memory isolation.
3. **Collaboration CRDT Unbounded State:**
   `POST /posts/:postId/collaboration/crdt` accepts arbitrary base64 strings with zero size validation or rate limiting, feeding directly into in-memory Yjs documents.
4. **Soft-Deleted Slug Collision Invariant:**
   `posts`, `pages`, and `tags` tables declare unconditional `slug text NOT NULL UNIQUE` constraints without `WHERE deleted_at IS NULL`. Soft-deleting a post permanently blocks reuse of that slug in PostgreSQL.
5. **Cross-Tenant Search Leakage:**
   `search_documents` table and `DrizzleSearchRepository` have no publication scoping. Any search query searches all documents globally.
6. **Orphaned / Misleading Admin Navigation:**
   The top-level Admin sidebar item "Network" (`NavMain.tsx`) navigates to `/admin/community`, which is an alias that renders SettingsHub > Growth. Network has no independent domain, API, or database table.
