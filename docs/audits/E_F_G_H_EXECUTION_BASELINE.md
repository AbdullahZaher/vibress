# VIBRESS E → F → G → H Execution Baseline

**Document Reference:** `docs/audits/E_F_G_H_EXECUTION_BASELINE.md`  
**Date:** 2026-09-15  
**Execution Phase:** Phase 0 — Master Pre-flight  
**Starting Commit SHA:** `8554123d2d638f437ddfee1b8165e44d99b9c62e`  
**Git Branch:** `main`  
**Node.js Version:** `v24.16.0`  
**pnpm Version:** `11.22.0`  
**Repository Version:** `1.0.0` (all 30 workspace packages aligned)  

---

## 1. Executive Pre-Flight Summary

The Vibress repository is entering the sequential production readiness and release execution sequence:
`STEP E (Collaborative Studio) → STEP F (Plugin Security) → STEP G (Doc Truth) → STEP H (Release Gate)`.

Step D (Multi-Publication Runtime & Database Isolation) has been verified and closed with executable proof across all 14 publication-owned resources, zero database migrations created, and 100% test pass rate.

This baseline captures the exact starting state across runtime code, database schemas, test results, and subsystem classifications prior to initiating Step E.

---

## 2. Environment & System Graph

- **Runtime OS:** Darwin (macOS)
- **Node.js:** `v24.16.0`
- **Package Manager:** `pnpm 11.22.0`
- **Database Engine:** PostgreSQL 16 (Docker container `vibress-postgres-1` on port 5433 mapped to 5432)
- **Cache / Transport:** Redis 7 (Docker container `vibress-redis-1` on port 6379)
- **Database Schema Migration Head:** `0026_multi_publication_tenant_isolation.sql` (27 migration files total: `0000` to `0026`)
- **Active Applications:**
  - `apps/api`: Fastify REST backend (Port 7780)
  - `apps/web`: Next.js 15.5.24 SSR public site (Port 7778)
  - `apps/admin`: Vite + React 18 SPA (Port 7779)
  - `apps/portal`: Vite + React 18 Member Portal SPA (Port 7781)
  - `apps/worker`: BullMQ background worker (Queues: search, analytics, webhooks, emails, automations)

---

## 3. Verified Baseline Test Counts

All tests executed cleanly against the active PostgreSQL and Redis instances:

| Test Suite / Category | Suite / File Count | Unique Passing Tests | Status |
|---|:---:|:---:|:---:|
| Dedicated Multi-Publication Isolation | 1 file | 30 tests | **PASS (100%)** |
| Workspace Integration Tests | 19 files | 215 tests | **PASS (100%)** |
| API Application Tests | 25 files | 289 tests | **PASS (100%)** |
| Worker Application Tests | 3 files | 11 tests | **PASS (100%)** |
| Themes Domain Tests | 4 files | 19 tests | **PASS (100%)** |
| Static TypeScript Typechecks | 4 packages | 0 errors | **CLEAN** |
| **Aggregate Baseline Executions** | **52 files** | **564 unique tests** | **100% PASS** |

---

## 4. Starting Subsystem Reality Classifications

| Subsystem / Area | Starting Classification | Reality Assessment & Gaps |
|---|:---:|---|
| **Multi-Publication Tenancy (Step D)** | **REAL / VERIFIED** | Closed via Migration 0026 and Step D evidence gate. 14 resources immutably partitioned. |
| **Collaborative Studio (Step E)** | **PROTOTYPE / PARTIAL** | HTTP `/crdt` endpoint exists but uses volatile in-memory Map `docUpdatesMap`. No Fastify WebSocket server exists. Client `WebSocketCollaborationProvider` exists in `@vibress/studio-react` but is not wired into `PostEditor.tsx`. Server restart wipes CRDT state. |
| **Plugin Ecosystem (Step F)** | **PROTOTYPE / TRUSTED-ONLY** | `executeSandboxedPluginCode` uses `node:vm` with regex checks, which is explicitly noted as not a secure sandbox boundary for untrusted code. `BundledPluginRegistry` exists for trusted plugins. |
| **Documentation & Product Claims (Step G)** | **UNRECONCILED** | Stale claims exist (e.g. README states "Next.js 14 SSR" while package.json is Next.js 15.5.24; claims of microservices vs containerized modular monolith). |
| **Production Release Gate (Step H)** | **PENDING** | Depends on sequential completion and hardening of E, F, and G. |

---

## 5. Known Risks & Invariants for Execution

1. **Step D Invariant:** Do NOT create new database migrations. Live database schema is owned by Migration 0026.
2. **Persistence Boundary:** Collaboration CRDT updates must be durably backed (PostgreSQL / Redis) rather than stored only in process memory.
3. **WebSocket Upgrades:** Fastify server must cleanly handle WebSocket upgrades with token-based staff authentication and `PublicationContext` authorization.
4. **Fail Closed:** Any unauthenticated or cross-publication collaboration handshake must be rejected with 403 or immediate socket termination.
