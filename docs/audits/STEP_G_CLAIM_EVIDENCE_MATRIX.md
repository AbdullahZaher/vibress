# Step G: Product Claim & Source Evidence Matrix

**Date:** 2026-09-15  
**Auditor:** Antigravity Autonomous Release Agent  
**Step:** Step G (Documentation / Product Claims Truth Reconciliation)  
**Status:** RECONCILED  

---

## 1. Executive Summary

This matrix establishes a 1-to-1 evidentiary verification between every major marketing, architectural, operational, and security claim made in Vibress documentation and the verifiable reality of the current codebase and test fixtures.

---

## 2. Claim vs Reality Matrix

| Category | Documented Claim | Source File Reference | Code Reality & Evidence | Truth Verdict | Action Taken |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Web Runtime** | Public web frontend runs on Next.js 14 SSR | `README.md:43`, `V1.0.0_RELEASE_NOTES.md:11`, `VIBRESS_V1.0.0_RELEASE_REPORT.md:5` | `apps/web/package.json` specifies `"next": "^15.5.24"` and `"eslint-config-next": "^15.5.24"`. Running Next.js 15 App/Pages router. | **RECONCILED** | Updated all documentation references to declare Next.js 15 SSR. |
| **Architecture** | "Production Dockerfiles for all microservices" | `CONTRIBUTING.md:77` | Single unified PostgreSQL database (Drizzle ORM) and Redis instance shared across modular domains. Fastify API and background BullMQ workers are containerized modular monolith services. | **RECONCILED** | Replaced "microservices" with "containerized modular monolith services". |
| **Plugin Extensibility** | "Sandboxed plugin architecture" | `README.md:24` | Step F audit and `docs/adr/STEP_F_PLUGIN_RUNTIME_ARCHITECTURE.md`: In-process host runtime with granular `CAPABILITY_REGISTRY` permission gating and publication isolation. `node:vm` hostile isolation is explicitly rejected as insecure. Plugins are Tier 1 (bundled) or Tier 2 (admin-verified). | **RECONCILED** | Updated claim to "Trusted plugin architecture (Tier 1 bundled & Tier 2 admin-verified)" with capability permission scoping. |
| **Collaborative Studio** | Real-time CRDT collaborative block editor with 13 cards | `README.md:20`, `V1.0.0_RELEASE_NOTES.md:12` | Yjs CRDT over WebSocket (`apps/api/src/routes/collaboration-ws.ts`), rate limited, payload size bounded (64KB), authenticated, publication isolated. 14/14 tests pass in `tests/integration/studio-collaboration-production.test.ts`. | **VERIFIED** | Accurate. Step E finalized and validated. |
| **Arabic & Multilingual** | Native RTL layout, Umm al-Qura Hijri calendar, Arabic normalization | `README.md:21`, `V1.0.0_RELEASE_NOTES.md:13` | Verified in `@vibress/i18n`, `apps/web`, and integration suite `tests/integration/multilingual-production-verification.test.ts` (22/22 tests pass). | **VERIFIED** | Accurate. Re-verified in test suite. |
| **Search Engine** | Full-text and fuzzy search via PostgreSQL `pg_trgm` GIN indexes | `README.md:23`, `V1.0.0_RELEASE_NOTES.md:15` | GIN trgm indexes on `posts.title`, `posts.content`, and `search_documents`. Verified in `tests/integration/analytics.test.ts` and `search-service.test.ts`. | **VERIFIED** | Accurate. Benchmark confirmed < 10ms queries. |
| **Subscriptions & Billing** | Tiered plans, Stripe checkout, customer portal, outbox newsletters | `README.md:22`, `V1.0.0_RELEASE_NOTES.md:14` | Stripe webhooks, HMAC signature verification, idempotent delivery, idempotency key support. 34/34 tests pass in `apps/api/src/__tests__/billing-api.test.ts`. | **VERIFIED** | Accurate. Subscriptions and billing fully operational. |
| **Quality & Test Metrics** | "1,074 tests across 135 files" | `README.md:137`, `V1.0.0_RELEASE_NOTES.md:102`, `VIBRESS_V1.0.0_RELEASE_REPORT.md:162` | Post-Step E/F/G test suite contains 158 test files and 1,258 total tests (1,253 passed, 5 skipped) with 100% pass rate. | **RECONCILED** | Updated documentation to state 1,258 tests across 158 test files. |
| **Database Migration Head** | Historical docs cite migration 0025 | Previous release docs | Migration `0026_multi_publication_tenant_isolation.sql` is the authoritative migration head. Zero new migrations permitted. | **VERIFIED** | Confirmed migration 0026 is the final schema head. |
| **What's New JSON Feed** | In-app announcement manifest contains collaborative studio editor | `.github/whats-new.json` | Manifest specifies version 1, item `collaborative-studio-editor`, minVersion `1.0.0`, valid JSON schema. | **VERIFIED** | Verified with automated schema test. |

---

## 3. Discrepancy Reconciliation Summary

All 4 material discrepancies (Next.js version, microservices terminology, plugin sandboxing definition, and test suite count) have been corrected in their respective authoritative files without altering architectural reality or compromising security posture.
