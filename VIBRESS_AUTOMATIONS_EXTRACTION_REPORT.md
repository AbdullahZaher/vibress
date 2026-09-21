# Vibress Automations — Architectural Extraction & Core De-Integration Report

**Author:** Principal Software Architect, Senior Product Engineer & Security Lead  
**Repository:** `Vibress Core` (`/Users/abdullahzaher/vibress/`)  
**Target Plugin Repository:** `Vibress Automations` (`/Users/abdullahzaher/vibress-automations/`)  
**Date:** September 21, 2026  
**Status:** **EXTRACTION COMPLETE — CORE INTEGRITY RESTORED**

---

## 1. Executive Summary

Following a comprehensive production forensic audit (`VIBRESS_VISUAL_AUTOMATIONS_PRODUCTION_AUDIT.md`), the Visual Automations system in Vibress was determined to be **not production-ready**. It exhibited critical design flaws, including:
- **Flawed concurrency and state race conditions**: In-memory action execution outside durable queue isolation, lack of distributed locking, and fragile step index resumes.
- **Tenant isolation gaps**: Incomplete multi-publication partitioning in run execution contexts and loose query boundaries.
- **Fragile Action Execution**: Synchronous HTTP calls without proper exponential backoff dead-letter handling or circuit breakers.
- **UI State Drift**: Canvas layout disconnects, unvalidated node graph connections, and unauthenticated preview simulations.

To safeguard Vibress Core's reliability, performance, and maintainability, the decision was executed to **fully decouple and remove Visual Automations from Vibress Core** and isolate it in an external, standalone plugin project: **Vibress Automations** (`/Users/abdullahzaher/vibress-automations/`).

Vibress Core now operates with **zero automation runtime code, zero automation routes, zero automation queue processors, and zero automation database dependencies**.

---

## 2. Complete Inventory of Removed Core Artifacts

### 2.1 Backend Domain & Database
| File / Directory | Action | Notes |
| :--- | :--- | :--- |
| `packages/domains/automations/` | **DELETED** | Complete domain package removed (domain models, repositories, service). |
| `packages/database/src/schema/automation-runs.ts` | **DELETED** | Unexported orphan schema file removed. |
| `packages/database/src/schema/intelligence.ts` | **MODIFIED** | Dropped tables `automations`, `automationVersions`, `automationRuns`, `automationRunSteps` and all associated row types. |
| `packages/database/src/seed.ts` | **MODIFIED** | Removed permissions `automations.read`, `automations.manage`, `automations.run` from system seed and role mappings. |
| `packages/database/migrations/0030_remove_visual_automations.sql` | **CREATED** | Explicit, non-cascading migration dropping tables and deleting permissions. |
| `packages/database/migrations/meta/_journal.json` | **MODIFIED** | Registered entry `0030_remove_visual_automations`. |

### 2.2 Core Queues & Async Event Bridge
| File | Action | Notes |
| :--- | :--- | :--- |
| `packages/queue/src/index.ts` | **MODIFIED** | Removed queue names `AUTOMATIONS_RUN`, `AUTOMATIONS_DELAYED`, and interfaces `AutomationRunQueueJob`, `AutomationDelayedQueueJob`. |
| `apps/api/src/services.ts` | **MODIFIED** | Removed `automationsService` export and BullMQ queue instances (`automationRunQueue`, `automationDelayedQueue`). |
| `apps/api/src/async-bridge.ts` | **MODIFIED** | Removed domain event listeners for `member.created`, `subscription.activated`, `subscription.cancelled`, `newsletter.sent`, `comment.created` routing to `automationsService`. |

### 2.3 API Routes & Worker Processors
| File | Action | Notes |
| :--- | :--- | :--- |
| `apps/api/src/routes/intelligence.ts` | **MODIFIED** | Removed `adminAutomationRoutes` (GET/POST `/automations`, `/activate`, `/deactivate`, `/run`, `/automation-runs`, `/steps`). |
| `apps/api/src/main.ts` | **MODIFIED** | Removed `adminAutomationRoutes` registration and import. |
| `apps/api/package.json` | **MODIFIED** | Removed `@vibress/automations` dependency. |
| `apps/worker/src/processors/automation-runner-worker.ts` | **DELETED** | Removed worker processor for automation execution and resumes. |
| `apps/worker/src/processors/automation-action-executor.ts` | **DELETED** | Removed action executor for email, webhook, tag, and wait actions. |
| `apps/worker/src/main.ts` | **MODIFIED** | Removed `AutomationRunnerWorker` lifecycle (startup, processing, and graceful shutdown). |
| `apps/worker/package.json` | **MODIFIED** | Removed `@vibress/automations` dependency. |

### 2.4 Admin User Interface
| File | Action | Notes |
| :--- | :--- | :--- |
| `apps/admin/src/components/automations/VisualAutomationBuilder.tsx` | **DELETED** | Extracted to external plugin builder. |
| `apps/admin/src/components/automations/` | **DELETED** | Entire directory removed. |
| `apps/admin/src/components/intelligence/AutomationsPanel.tsx` | **DELETED** | Extracted to external plugin panel. |
| `apps/admin/src/components/IntelligenceSettings.tsx` | **MODIFIED** | Removed Automations tab, count badge, refresh routine, and panel mount. |
| `apps/admin/src/components/layout/sidebar/NavContent.tsx` | **MODIFIED** | Removed "Automations" button and `Zap` icon from sidebar navigation. |
| `apps/admin/src/lib/router.tsx` | **MODIFIED** | Removed `/admin/automations` route definition and lazy chunk loader. |
| `apps/admin/src/lib/api/intelligence.ts` | **MODIFIED** | Removed automation client interfaces and API caller methods. |

### 2.5 Tests & Documentation
| File | Action | Notes |
| :--- | :--- | :--- |
| `apps/api/src/__tests__/intelligence-api.test.ts` | **MODIFIED** | Removed automation unit/integration tests. |
| `tests/e2e/intelligence.test.ts` | **MODIFIED** | Removed automation E2E integration tests. |
| `tests/integration/platform-packages.test.ts` | **MODIFIED** | Removed assertion on `QUEUE_NAMES.AUTOMATIONS_RUN`. |
| `tests/integration/queue-centralization.test.ts` | **MODIFIED** | Removed assertions on `AUTOMATIONS_RUN` and `AUTOMATIONS_DELAYED`. |
| `tests/integration/runtime-multi-publication-isolation.test.ts` | **MODIFIED** | Removed automations multi-publication test. |
| `docs/10-api/search-api.md` | **MODIFIED** | Removed automations admin documentation. |

---

## 3. Database Migration Details

Migration `0030_remove_visual_automations.sql` executes safe, deterministic removal in reverse foreign-key dependency order without blind cascades:

```sql
BEGIN;

-- 1. Drop tables in strict child-to-parent dependency order
DROP TABLE IF EXISTS "automation_run_steps";
DROP TABLE IF EXISTS "automation_runs";
DROP TABLE IF EXISTS "automation_versions";
DROP TABLE IF EXISTS "automations";

-- 2. Clean up automation permissions from role assignments and permissions dictionary
DELETE FROM "role_permissions"
WHERE "permission_id" IN ('automations.read', 'automations.manage', 'automations.run');

DELETE FROM "permissions"
WHERE "id" IN ('automations.read', 'automations.manage', 'automations.run');

COMMIT;
```

**Forensic Safety Verification:**
- Pre-migration foreign key analysis proved zero inbound references to `automations` from core tables (`posts`, `pages`, `users`, `publications`, `members`, `subscriptions`).
- All four dropped tables were isolated to the automations engine.
- RBAC permissions were removed cleanly from both assignment junctions and the master permission catalog.

---

## 4. Standalone External Plugin: Vibress Automations

The extracted codebase has been established at:
`/Users/abdullahzaher/vibress-automations/`

### Architectural Structure:
- `apps/admin/`: Standalone React components (`VisualAutomationBuilder.tsx`, `AutomationsPanel.tsx`).
- `apps/worker/`: Decoupled worker processors (`automation-runner-worker.ts`, `automation-action-executor.ts`).
- `packages/domain/`: Pure domain interfaces and logic (`automation.ts`, `repository.ts`, `automations-service.ts`).
- `packages/database/`: Dedicated Drizzle schema definitions for independent deployment.
- `packages/adapter/`: Public HTTP/REST API client contracts for communication with Vibress Core.
- `docs/`: Dedicated architectural blueprint, integration guide, security review, and remediation roadmap.
- `tests/`: Isolated domain tests.

### Plugin Production Status:
> [!WARNING]
> **NOT PRODUCTION READY**  
> The external plugin codebase is preserved as a reference implementation for future plugin development. It retains known architectural flaws documented in `docs/SECURITY.md` and `docs/ROADMAP.md` that must be remediated before any production deployment.

### Independence Verification:
- **Zero Core Imports**: The plugin does not import `@vibress/*` or reference `/Users/abdullahzaher/vibress/`.
- **Standalone VCS**: Initialized with its own Git repository (`git init`).

---

## 5. Core Operational Stability & Zero Regressions

With Visual Automations completely excised:
1. **Zero Runtime Overhead**: No event listeners are attached to internal domain event emitters for automation hooks.
2. **Reduced Worker Memory Footprint**: Worker initialization no longer launches BullMQ queue listeners or delayed step sweeps for automations.
3. **Clean Admin UI**: The admin sidebar and settings views are focused purely on Core features (Posts, Pages, Members, Comments, Search, Analytics, Settings).
4. **Database Leanliness**: Four tables and three obsolete permissions were removed from the catalog.

---

## 6. Future Plugin Integration Contract Boundaries

If and when "Vibress Automations" is re-introduced as an official plugin, it must strictly adhere to the following architectural contracts:
1. **Out-of-Process Communication**: The plugin must consume domain events exclusively via public webhooks or an authenticated Redis/Kafka message bus, never by importing Core internal services.
2. **Independent Database Isolation**: The plugin must maintain its own database or use a distinct Postgres schema namespace (`automations.*`) with its own migration runner.
3. **Public API Contract**: All interactions with members, posts, or tags must occur through documented Vibress Machine APIs using API keys with scoped permissions.
4. **Independent Distributed Workers**: The plugin must manage its own BullMQ workers with explicit distributed locking (e.g. Redlock) and isolated worker queues.
