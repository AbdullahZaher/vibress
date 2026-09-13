# Vibress — Master Production Remediation & Finding Reconciliation

> **Audit Date**: 2026-09-13  
> **Auditor**: Independent Senior Engineering Audit Team  
> **Repository Baseline**: Monorepo Workspace (Post-Migration `0024_multilingual_publications_translations`)  
> **Standard**: Authoritative Evidence Reconciliation (Repository Source Code, Test Suites, Database Schemas, Runtime)

---

## 1. Executive Summary & Purpose

This document reconciles all findings, capability counts, severity classifications, and technical debt items from the initial audit reports into an authoritative baseline. Every finding recorded below has been verified against the physical codebase, schema definitions, and runtime execution logs.

---

## 2. Reconciled Architectural & Maturity Metrics

### 2.1 Capability & Subsystem Counts
* **Evaluation Baseline**: 34 distinct functional subsystems mapped across the monorepo's 38 domain packages (`packages/domains/*`).
* **Authoritative Maturity Distribution**:
  * **L0 (Missing)**: 0 (0.0%)
  * **L1 (Prototype / Concept)**: 2 (5.9%) — CRDT Real-Time Collaboration, Plugin Dynamic Sandbox
  * **L2 (Implemented / Isolated)**: 4 (11.8%) — Content Modeler UI, RBAC Ownership Scope, Multi-Tenancy Scoping, Visual E2E Test Harness
  * **L3 (Tested / Functional Dev)**: 9 (26.5%) — Studio Gutter, Staff Recovery, Search GIN Schema, AI Copilot, Newsletters, Billing, Subscriptions, Logging, Docker Dev Ops
  * **L4 (Production Ready)**: 19 (55.8%) — Core CMS, Post/Page Lifecycles, Revisions, Tags, Reader Auth, Security Headers, Liquid Themes, S3 Media, i18n Routing, Arabic RTL Typography, Translation Workflow, AI Multi-Provider Gateway, Nodemailer/Mailpit, BullMQ Distributed Worker, Vitest Suite (1,028 tests), Outbox Delivery, etc.
  * **L5 (Mature / Reference Standard)**: 0 (0.0%)

### 2.2 Reconciled P0 Blockers & P1 Pre-Launch Priorities
* **P0 Launch Blockers (5 items)**:
  1. `SEC-01`: Wildcard `posts.*` and `pages.*` permissions granted to `author` / `contributor` roles in seed data.
  2. `SEC-02`: Missing author-ownership enforcement in `PostsService` and `PagesService`.
  3. `AUTH-01`: Broken staff user invitation flow (placeholder hash, no invitation token, no acceptance API).
  4. `AUTH-02`: Missing staff password reset endpoints.
  5. `STUDIO-01`: Unhandled callback runtime error in Lexical `BlockHandleGutterPlugin.tsx`.
* **P1 Pre-Launch Hardening Items (5 items)**:
  1. `ARCH-01`: Single-Publication Boundary Enforcement (Document v1.0 as single-publication; guard inactive workspace schema).
  2. `TEST-01`: Playwright Visual Regression Harness (Replace byte-length buffer diff with pixel comparison).
  3. `DB-01`: PostgreSQL Search GIN Trigram index schema alignment for `search_documents`.
  4. `DB-02`: Node PG in-transaction concurrent query execution warnings in background workers.
  5. `SEC-03`: Production Content Security Policy (CSP) headers with strict nonces.

### 2.3 Scores & Maturity Calibration
* **Vibress Current Score**: **`6.8 / 10`** *(Functional Beta)*
* **Production Readiness**: **`6.5 / 10`**
* **Launch Readiness**: **`6.0 / 10`** *(DO NOT LAUNCH TO PUBLIC YET)*
* **Potential Score Post Phase 0 & 1**: **`8.5 / 10`** *(Hardened Production Platform)*
* **Potential Score Post Phase 2 & 3**: **`9.4 / 10`** *(Enterprise Reference Leader)*

---

## 3. Comprehensive Finding Reconciliation Table

| Finding ID | Subsystem | Evidence File & Line / Method | Reproduction / Root Cause | Security / Operational Impact | Actual Severity | Status | Recommended Fix | Production Gate |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| **SEC-01** | RBAC Seed | `packages/database/src/seed.ts:257-266` | `permKey.startsWith("posts.")` grants `posts.delete`, `posts.publish`, `posts.edit` to authors and contributors. | Authors can delete, edit, or publish any post without editor/admin approval. | **P0** | `VERIFIED-BLOCKER` | Replace wildcard prefix check with explicit list: `posts.read`, `posts.create`, `posts.edit.own`, `posts.delete.own`. | Unit test verifies author role permissions. |
| **SEC-02** | Posts / Pages Service | `packages/domains/posts/src/application/posts-service.ts:149-205, 214-270, 364-385`<br>`packages/domains/pages/src/application/pages-service.ts:100-160` | `updatePostTx`, `deletePostTx`, `publishPostTx` accept `actorId` but never compare against `post.primaryAuthorId` or check elevated role permissions. | Horizontal privilege escalation: User A can overwrite or delete User B's drafts or published articles. | **P0** | `VERIFIED-BLOCKER` | Implement ownership check in service layer: `if (post.primaryAuthorId !== actorId && !actorHasElevatedPermission) throw Forbidden`. | Integration test verifying cross-user edit/delete is rejected with 403. |
| **AUTH-01** | Staff Onboarding | `apps/api/src/routes/admin.ts:40-115` | `POST /users/invite` creates user with `passwordHash: "$argon2id$...invited_${Date.now()}"` and status `active`. No invite token or acceptance endpoint. | Staff users cannot accept invitations or set passwords without direct SQL database intervention. | **P0** | `VERIFIED-BLOCKER` | Add `user_invitations` table, generate crypto tokens, send activation email via `@vibress/email`, and create `POST /api/auth/invitation/accept`. | E2E test verifying invite $\to$ email $\to$ accept $\to$ login flow. |
| **AUTH-02** | Staff Account Recovery | `apps/api/src/routes/auth.ts:1-125` | Zero `forgot-password` or `reset-password` endpoints exist for staff users (only reader members have magic links). | Staff users who forget passwords are permanently locked out. | **P0** | `VERIFIED-BLOCKER` | Create `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` with rate-limiting and expiring tokens. | Integration test verifying password reset lifecycle. |
| **STUDIO-01** | Editorial Studio | `packages/studio-react/src/plugins/BlockHandleGutterPlugin.tsx:86, 177-187` | Nested `editor.update()` calls in `handleTurnInto` and unmounted DOM node lookups throw `Unable to find an active editor`. | Content creators experience console exceptions and potential editor desynchronization during block hover/drag. | **P0** | `VERIFIED-BLOCKER` | Refactor gutter handlers to safely read selection inside a single `editor.update()` callback with defensive null-checks. | Studio test proving 0 uncaught exceptions during block operations. |
| **ARCH-01** | Multi-Tenancy Scoping | `packages/database/src/schema/workspaces.ts`<br>`packages/database/src/schema/posts.ts` | Schema tables `workspaces` and `publications` exist in migrations `0020_` and `0024_`, but content tables (`posts`, `pages`, `media`, `tags`, `settings`) have zero `publication_id` columns. | Multi-tenancy is an isolated prototype. Attempting multi-site hosting will leak data across publications. | **P1** | `VERIFIED-PRODUCTION-GAP` | **Option B Decision**: Formally brand Vibress v1.0.0 as Single-Publication, isolate workspace tables behind feature flag, and enforce single-site boundaries. | Single-publication operational verification. |
| **TEST-01** | E2E Visual QA | `tests/e2e/visual/multilingual-visual-regression.test.ts:33-50` | `compareScreenshotBuffers` computes `Math.abs(len1 - len2) / maxLen` comparing PNG file byte sizes rather than bitmap pixels. | False positives on PNG chunk variations; false negatives on actual UI layout breakages. | **P1** | `VERIFIED-CORRECTNESS` | Replace byte-length comparator with Playwright `toHaveScreenshot()` or `pixelmatch` bitmap diffing. | Visual regression suite passes with pixel-accurate threshold. |
| **DB-01** | Search Indexing | `packages/database/src/schema/intelligence.ts:101-127`<br>`packages/domains/search/src/infrastructure/drizzle-search-repository.ts:77-100` | Drizzle schema lacks index definitions for `search_documents (title, body_text, slug)` trgm indexes. | Search queries risk degraded query plans if not explicitly defined in Drizzle schema and migrations. | **P1** | `VERIFIED-PERFORMANCE` | Declare GIN indexes in `schema/intelligence.ts` and create migration `0026_search_trigram_gin_index.sql` to index all searchable fields (`title`, `body_text`, `slug`). | PostgreSQL `EXPLAIN ANALYZE` confirms Bitmap Index Scan on search queries. |
| **DB-02** | PG Concurrency | `packages/database/src/transaction/transaction-runner.ts:24-32`<br>`apps/worker/src/processors/` | Worker processes executing concurrent `Promise.all` inside `runInTransaction` trigger `Calling client.query() when client is already executing a query`. | Node PG driver will fail on v9.0 upgrade; potential race conditions in worker transactions. | **P1** | `VERIFIED-OPERATIONAL` | Ensure sequential execution of in-transaction queries or lease dedicated client connections for parallel work. | Worker test suite runs with 0 pg deprecation warnings. |
| **SEC-03** | Security Headers | `apps/api/src/plugins/security-headers.ts`<br>`apps/web/next.config.mjs` | Missing production Content Security Policy (CSP) headers with nonces for script and style evaluation. | Elevated risk of XSS execution from dynamic user-generated content or malicious theme scripts. | **P1** | `VERIFIED-PRODUCTION-GAP` | Add Helmet CSP configuration with strict script/style source restrictions. | Security header scanner passes with A+ rating. |
| **PERF-01** | Query Caching | `packages/cache/src/index.ts:1-66` | `@vibress/cache` provides only raw Redis client connection; zero application-level query caching for Next.js SSR. | High PostgreSQL read load on homepage and article viewing traffic. | **P2** | `VERIFIED-PERFORMANCE` | Build cache-aside query manager with outbox event invalidation tags (`posts:slug:*`). | Response time for cached article queries drops under 10ms. |
| **STUDIO-02** | Content Modeler UI | `packages/domains/content-modeler`<br>`packages/studio-react` | Content modeler schemas exist in DB, but Lexical Studio lacks a dynamic form sidebar to edit custom fields. | Content creators cannot edit custom schema fields (e.g. event dates, product prices) in the UI. | **P2** | `VERIFIED-PRODUCTION-GAP` | Build dynamic React form sidebar in Studio bound to `post.customFields`. | Studio test verifying custom field editing and persistence. |
| **OBS-01** | Tracing & APM | `packages/observability` | Structured Pino logs exist, but OpenTelemetry distributed tracing is not wired across HTTP $\to$ DB $\to$ Worker. | SREs cannot trace cross-process request latency during incident triage. | **P2** | `VERIFIED-OPERATIONAL` | Complete OpenTelemetry OTLP export instrumentation in Fastify and BullMQ worker. | Tracing spans visible in Tempo / Jaeger. |
| **I18N-01** | Secondary Locales | `apps/web/src/locales/`<br>`packages/domains/translations` | French (`fr-FR`) and Persian (`fa-IR`) locales exist in configuration but lack complete UI translation bundles. | Non-English/Arabic users encounter partial English fallback strings. | **P3** | `VERIFIED-PRODUCTION-GAP` | Complete UI string translation JSON files for French and Persian. | Full UI translation verification in browser. |

---

## 4. Master Remediation Strategy & Gate Requirements

Every verified blocker (P0) and production gap (P1) must follow the **Required Implementation Loop**:
```text
Investigate ➔ Plan ➔ Implement ➔ Unit Tests ➔ Integration Tests ➔ Browser E2E ➔ Security Regression ➔ Typecheck ➔ Lint ➔ Build ➔ Document
```
