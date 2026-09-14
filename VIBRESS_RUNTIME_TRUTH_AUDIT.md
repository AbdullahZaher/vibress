# VIBRESS — MASTER RUNTIME TRUTH AUDIT
## Independent Deep Source-of-Truth Forensic Audit

**Auditor Role**: Principal Architect, Security Engineer, Distributed Systems Engineer, CMS Architect, Open-Source Product Engineer  
**Date**: September 2026  
**Repository**: [Vibress Core Repository](file:///Users/abdullahzaher/vibress)  
**Certified Commit**: `6777059`  
**Audit Standard**: Source code and actual runtime execution paths are the sole sources of truth. No prior certification report, changelog, README claim, or test name is taken as evidence without concrete runtime proof.

---

## 1. Executive Summary & Verdict

Vibress is an ambitious, high-quality **modern publishing CMS implemented as a TypeScript modular monolith**. It exhibits outstanding engineering in specific domains—particularly its Drizzle ORM schema foundations, transactional outbox pattern, Argon2id security primitives, LiquidJS template isolation, and Lexical-based Studio block editor foundation.

However, an independent deep forensic audit comparing actual runtime code against documentation claims reveals a profound divide: **several flagship capabilities marketed as "production complete" are either disconnected prototypes, in-memory simulations, or architectural shells missing runtime wiring.**

### Feature Reality Classification

| Subsystem / Feature | Claimed Status | Actual Runtime Reality | Classification |
| :--- | :--- | :--- | :--- |
| **Real-Time Collaboration** | "Complete (Yjs / WebSocket / Presence)" | `WebSocketCollaborationProvider` is unimported; API has NO WebSocket server; CRDT updates live in an ephemeral in-memory JS `Map`; `PostEditor` passes no collaboration props. | **INFRASTRUCTURE EXISTS BUT NOT CONNECTED / TEST-ONLY** |
| **Multi-Publication / Tenancy** | "Complete with strict boundaries" | `workspaces` and `publications` tables exist, but `posts`, `pages`, `media`, `members`, `newsletters` have NO `publication_id`; API queries globally; `WorkspaceService` is only called in unit tests with in-memory mocks. | **PROTOTYPE / UNCONNECTED TO CORE** |
| **Plugin Sandbox** | "Sandboxed extension host" | Only 1 hardcoded bundled plugin (`vibress-content-metrics`) is loaded; `sandbox.ts` uses insecure `node:vm`; `extension-host.ts` returns a static mock `{ executed: true }`. | **PROTOTYPE / NOT PRODUCTION-SAFE** |
| **Staff Auth Lifecycle** | "Enterprise auth lifecycle" | Argon2id hashing, enumeration-resistant password reset, single-use token hashing, session revocation, and locked first-run setup are fully implemented. | **REAL / COMPLETE** |
| **Transactional Outbox** | "Outbox event delivery" | `outbox_events` table, `FOR UPDATE SKIP LOCKED` claim worker, exponential backoff, dead-letter tracking, and stale claim recovery are fully implemented. | **REAL / COMPLETE** |
| **Theme Engine & Security** | "Theme API & zip upload" | In-memory Liquid virtual filesystem, zip-slip protection, CRC32 checks, zip-bomb size bounds, and RTL helpers are fully implemented. | **REAL / COMPLETE** |
| **Studio Block Editor** | "Lexical Studio CMS" | All 13 canonical Studio cards, custom nodes, HTML/Markdown serializers, and optimistic locking are fully functional. Real-time multi-user synchronization is missing. | **REAL / PARTIAL** |
| **AI Gateway** | "Unified AI platform" | OpenAI, Anthropic, Gemini, DeepSeek, Ollama providers, circuit breaker, audit logging work. Rate limiting and token budgets are stored in ephemeral in-memory Maps. | **REAL / PARTIAL** |
| **Search Engine** | "Sub-millisecond search" | PostgreSQL `pg_trgm` + `ILIKE` ranking with Arabic text normalization. No `publication_id` isolation; latency is typical PostgreSQL query time (5–30ms). | **REAL / PARTIAL** |
| **Billing & Webhooks** | "Stripe billing & webhooks" | Raw body parsing, Stripe signature verification, SHA-256 payload deduplication, and idempotent processing are fully implemented. | **REAL / COMPLETE** |
| **What's New System** | "Remote single notification" | GitHub remote JSON source, SSRF-safe fetch, SemVer constraint matching, single-item selection, DB-backed per-user permanent dismissal. | **REAL / COMPLETE** |

---

## 2. Phase 0 — Repository Architecture & Forensics

### 2.1 Monorepo Topography

The repository is managed with **pnpm workspaces** and **Nx**, organized into 5 applications and 31 shared packages:

```
vibress/
├── apps/
│   ├── admin/      # React 18 + Vite SPA (Vibress Admin Dashboard)
│   ├── api/        # Fastify 5 REST API service (Backend Monolith)
│   ├── portal/     # React 18 + Vite SPA (Public Member Portal)
│   ├── web/        # Next.js 15 App Router (Public Reader Site & Themes)
│   └── worker/     # BullMQ + Redis background worker daemon
├── packages/
│   ├── api-contracts/     # Zod input/output schemas & DTOs
│   ├── config/            # Strongly-typed environment configuration
│   ├── database/          # Drizzle ORM schemas (35 schemas), connection, migrations (26 migrations)
│   ├── domains/           # 38 domain packages (posts, pages, auth, billing, email, etc.)
│   ├── events/            # Domain event emitter & transactional outbox repository/dispatcher
│   ├── i18n/              # Locale registry, formatters, Arabic normalizer, translations service
│   ├── observability/     # Pino logger, Prometheus metrics, OpenTelemetry tracing
│   ├── plugin-core/       # vm sandbox (insecure prototype) & mock extension host
│   ├── plugin-sdk/        # Plugin manifest validator & SDK contracts
│   ├── queue/             # BullMQ Redis connection & queue definitions
│   ├── security/          # Argon2id, crypto token hashing, session token resolution, RBAC helpers
│   ├── storage-core/      # Storage interface & local disk adapter
│   ├── storage-s3/        # AWS S3 / MinIO storage adapter
│   ├── studio-*/          # 12 Lexical Studio packages (core, cards, nodes, react, renderer, serializer)
│   ├── theme-core/        # LiquidJS engine, memory filesystem, zip validator, view-models
│   ├── themes-registry/   # Built-in theme bundles (Starter, Magazine)
│   ├── ui/                # Shared Tailwind primitives
│   └── utils/             # Slug generator, SemVer engine, What's New selector
└── docker/                # Multi-stage container definitions (api, worker, web, spa, gateway)
```

### 2.2 Deployment Topology Reality: Modular Monolith vs Microservices

Vibress documentation occasionally employs the term "microservices." **This is inaccurate.**  
Vibress is architecturally a **Modular Monolith**:
1. **Shared Database**: `apps/api` and `apps/worker` directly connect to the same PostgreSQL database using the same `@vibress/database` Drizzle schema.
2. **Shared Redis**: `apps/api` (as BullMQ producer) and `apps/worker` (as BullMQ consumer) share the same Redis instance.
3. **Internal Network Isolation**: `compose.prod.yml` isolates PostgreSQL and Redis on an `internal: true` backend network. External ingress is handled by a single Nginx reverse proxy gateway container.

---

## 3. Phase 1 — Detailed Subsystem Reality

### 3.1 Collaboration & Real-Time Editing

#### Traced Execution Path (Browser A to Browser B)
1. **Browser A (Editor)**:
   - [PostEditor.tsx](file:///Users/abdullahzaher/vibress/apps/admin/src/components/PostEditor.tsx) renders `<VibressStudio value={studioDoc} onChange={handleDocChange} />`.
   - **Crucial Finding**: It passes **NO `collaboration` prop**.
   - `<VibressStudio>` in [VibressStudio.tsx](file:///Users/abdullahzaher/vibress/packages/studio-react/src/VibressStudio.tsx) checks:
     ```tsx
     {collaboration ? (
       <CollaborationPlugin id={collaboration.id} providerFactory={collaboration.providerFactory} ... />
     ) : (
       <HistoryPlugin />
     )}
     ```
     Because `collaboration` is undefined, it activates standard single-user undo/redo `<HistoryPlugin />`.
2. **Collaboration Provider**:
   - `packages/studio-react/src/collaboration/websocket-collaboration-provider.ts` defines `WebSocketCollaborationProvider`.
   - **Crucial Finding**: Grep search across the entire repository reveals this class is **NEVER imported or instantiated** anywhere in the codebase.
   - `packages/studio-react/src/collaboration/memory-collaboration-provider.ts` defines `MemoryCollaborationProvider`, which synchronizes via a local in-memory JavaScript `Map` (`documentHubs`). This is used **exclusively in Vitest unit tests**.
3. **Network Transport**:
   - `apps/api` does not register `@fastify/websocket` or any WebSocket server.
   - The gateway (`docker/gateway.Dockerfile`) has no WebSocket upgrade directive for `/api/collaboration`.
4. **Server Synchronization Layer**:
   - [apps/api/src/routes/collaboration.ts](file:///Users/abdullahzaher/vibress/apps/api/src/routes/collaboration.ts) exposes:
     - `GET /posts/:postId/collaboration/crdt`
     - `POST /posts/:postId/collaboration/crdt`
   - These routes call [editorial-collaboration-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/posts/src/application/editorial-collaboration-service.ts):
     ```ts
     private docUpdatesMap: Map<string, Uint8Array[]> = new Map();
     getYjsDocUpdates(postId: string): Uint8Array[] { return this.docUpdatesMap.get(postId) || []; }
     applyYjsDocUpdate(postId: string, update: Uint8Array): void { ... this.docUpdatesMap.get(postId)!.push(update); }
     ```
   - **Crucial Finding**: The CRDT updates are stored in a JavaScript `Map` in Node.js heap memory! They are not written to PostgreSQL or Redis. When the API container restarts, all updates vanish.
   - Furthermore, `apps/admin` never calls these REST endpoints.
5. **Browser B (Second User)**:
   - Receives nothing. If Browser B opens the same post, Browser B loads from PostgreSQL. When either user saves, the second user encounters a `409 Version Conflict Detected` ("This post was updated in another session").

#### What the Collaboration Tests Actually Prove
- `packages/studio-react/src/__tests__/crdt-collaboration.test.ts`: Proves that two Lexical editor instances running inside the same Vitest runner process can exchange Yjs updates through a shared in-memory JavaScript `Map`. It does NOT prove WebSocket transport, multi-browser networking, authentication, horizontal scaling, or persistence.

---

### 3.2 Multi-Publication / Multi-Tenancy

#### Database Schema Reality
In [packages/database/src/schema](file:///Users/abdullahzaher/vibress/packages/database/src/schema):
- `workspaces` table exists (`id`, `name`, `slug`).
- `publications` table exists (`id`, `workspace_id`, `name`, `slug`, `primary_locale`).
- `publication_locales` table has `publication_id`.
- `publication_memberships` table has `publication_id`.

**Zero Core Content Tables Have `publication_id`**:
- [posts.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/posts.ts): `id`, `title`, `slug` (UNIQUE globally), `content`, `primary_author_id`. **NO `publication_id`**.
- [pages.ts](file:///Users/abdullahzaher/vibress/packages/database/src/schema/pages.ts): `id`, `title`, `slug` (UNIQUE globally). **NO `publication_id`**.
- `media.ts`: `id`, `filename`, `storage_key`. **NO `publication_id`**.
- `tags.ts`: `id`, `name`, `slug`. **NO `publication_id`**.
- `members.ts`: `id`, `email`. **NO `publication_id`**.
- `newsletters.ts`: `id`, `name`. **NO `publication_id`**.
- `search_documents.ts`: `entity_type`, `entity_id`. **NO `publication_id`**.
- `content_translations.ts`: `content_type`, `content_id`. **NO `publication_id`**.

#### Service & API Reality
- `WorkspaceService` in [workspace-service.ts](file:///Users/abdullahzaher/vibress/packages/domains/workspaces/src/application/workspace-service.ts) implements `switchWorkspace` and `switchPublication` logic.
- Grep search confirms `WorkspaceService` is **NEVER imported in `apps/api`**.
- All API routes (`GET /posts`, `GET /pages`, `GET /media`, `GET /members`) query the database globally without any publication filter.
- **Verdict**: Vibress is currently a **strictly single-publication system**.

---

### 3.3 Plugin Architecture & Security Sandbox

#### What Plugins Are Today
1. **Manifest Validator**: `packages/plugin-sdk` validates `plugin.json` schema (`id`, `name`, `version`, `capabilities`, `hooks`).
2. **Bundled Host**: `apps/api/src/plugins/plugin-host.ts` implements `BundledPluginHost`. It contains an in-memory dictionary registering exactly ONE bundled plugin: `"vibress-content-metrics"`.
3. **Execution Sandbox**:
   - `packages/plugin-core/src/sandbox.ts` uses Node.js `node:vm`:
     ```ts
     const vmContext = vm.createContext(sandboxContext);
     const script = new vm.Script(code);
     return script.runInContext(vmContext, { timeout });
     ```
   - **Critical Vulnerability Note**: Node.js official documentation warns: *"The node:vm module is not a security mechanism. Do not use it to run untrusted code."* Attackers can escape `vm.createContext` using prototype constructor access (`this.constructor.constructor("return process")()`).
4. **Extension Host**:
   - `packages/plugin-core/src/extension-host.ts` implements `executeHook()`. Inside, it returns a hardcoded mock object:
     ```ts
     const result = { executed: true, hook: hookName, payload, timestamp: new Date().toISOString() };
     ```
   - No external process, worker thread, or WASM sandbox is spawned.
- **Verdict**: Plugins are currently **trusted in-process modules only**. Third-party untrusted code execution is non-existent, and the `node:vm` prototype must never be exposed to user uploads.

---

### 3.4 Studio Block Editor

#### What Is Complete:
- 13 canonical cards fully supported: `Callout`, `Button`, `Bookmark`, `Gallery`, `Video`, `Audio`, `File`, `Divider`, `Product`, `Embed`, `Header`, `Markdown`, `HTML`.
- Bidirectional serialization/deserialization between Lexical state and `StudioDocument` format.
- HTML and Markdown exporters in `packages/studio-html` and `packages/studio-markdown`.
- Slash command menu (`/`), floating format toolbar, block handle drag gutter.
- Inline AI completion triggers (`handleAiGenerate`).
- Optimistic locking via document `version` counter: returns HTTP 409 if another user updated the post since last fetch.
- Revision history with snapshot storage and restore capabilities.

#### What Is Incomplete:
- Collaborative multi-user editing (detailed in 3.1).
- Conflict auto-resolution (currently requires a full manual page reload on conflict).

---

### 3.5 AI Platform

#### Reality:
- Gateway service in `packages/domains/ai/src/application/ai-gateway-service.ts` abstracts OpenAI, Anthropic, Gemini, DeepSeek, Ollama, and a Deterministic Test Provider.
- Supports streaming completions, circuit breaker (5 failures within 60s trips the breaker), and audit logging into `ai_audit_logs`.
- **Limitations**:
  - Request rate limiting (`userRequestTimestamps`) and monthly token budgets (`totalUsedTokens`) are stored in **transient in-memory variables**. They reset on every server restart or container scale-out.
  - AI is not content-aware: it has no knowledge of the publication's content graph, brand voice guidelines, or relational taxonomies.

---

### 3.6 i18n & Translation Governance

#### What Is Complete:
- Complete `LocaleRegistry` covering standard BCP-47 locales, text direction (`rtl` vs `ltr`), and Arabic locale variants.
- Arabic text normalizer (`normalizeArabicText`) stripping Harakat/diacritics and unifying Alef/Taa Marbuta variants.
- Formatters for Gregorian and Hijri dates, currency, and numbers.
- Translation workflow in `packages/i18n/src/translation-service.ts`: manages translation groups, status lifecycles (`untranslated`, `draft`, `in_progress`, `translated`, `needs_review`, `approved`, `published`, `stale`), and field-level diff detection against source posts/pages.

#### What Is Incomplete:
- Translation Glossary is an in-memory class with hardcoded static terms (`packages/i18n/src/glossary.ts`). There is no database table or Admin UI for custom glossaries.
- No Translation Memory (TM) engine for storing and fuzzy-matching previously translated sentences.
- No automated translation quality scoring.

---

### 3.7 Search Engine

#### Reality:
- Search indexing is powered by background jobs via `search-indexer-worker.ts` consuming `QUEUE_NAMES.SEARCH_INDEXING`.
- Index table `search_documents` stores `entity_type`, `entity_id`, `title`, `body_text`, `slug`, `url`.
- Queries execute PostgreSQL `ILIKE` and `pg_trgm` `similarity(search_documents.title, query)` in `drizzle-search-repository.ts`.
- Arabic queries are normalized via `normalizeArabicText` during indexing and query execution.
- **Limitations**:
  - Does not use PostgreSQL `tsvector` or full-text dictionaries.
  - No publication isolation (global index).
  - Search latency is dependent on PostgreSQL index scan times (5–30ms), contrary to any "sub-millisecond" marketing claims.

---

### 3.8 Themes & Liquid Template Engine

#### What Is Complete:
- LiquidJS engine isolated within `MemoryFileSystem` in `packages/theme-core/src/theme-engine.ts`. Templates cannot access files outside the theme memory map.
- Theme zip validator (`zip-validator.ts`) enforces strict security:
  - Magic bytes verification (`PK\x03\x04`).
  - Max zip archive size (25MB) and max total uncompressed bytes (100MB) preventing zip bombs.
  - CRC32 checksum verification on all entries.
  - Zip-slip path traversal prevention rejecting `..` and absolute paths.
  - Forbidden extension blocklist (`.exe`, `.sh`, `.php`, `.js`, `.py`, `.env`).
- Custom Liquid filters: `t`, `translate`, `is_rtl`, `direction`, `asset_url`, `post_url`, `tag_url`, `author_url`.
- Two production themes: `vibress-starter` and `marrowe-magazine`.

---

### 3.9 Billing, Memberships & Newsletters

#### What Is Complete:
- Stripe integration with raw buffer webhook signature verification.
- Webhook deduplication via SHA-256 payload hash and unique `(provider, provider_event_id)` index.
- Member authentication and magic-link login flows in `apps/portal`.
- Newsletter audience snapshotting and batched BullMQ queue delivery (`send-${sendId}-batch-${i}`).
- Per-recipient idempotency check (`recipient.status === 'pending'`) in `email-delivery-worker.ts`.
- One-click unsubscribe HMAC token generation and verification.

---

### 3.10 Automations, Workers & Transactional Outbox

#### What Is Complete:
- Transactional outbox table `outbox_events` populated atomically with domain entities.
- `OutboxDispatcherWorker` claims pending events using PostgreSQL `FOR UPDATE SKIP LOCKED`.
- Stale claims automatically reclaimed after 60 seconds if a worker instance dies.
- Failed deliveries back off exponentially up to 5 attempts before moving to `failed`.
- BullMQ worker concurrency and tracing instrumentation.

---

### 3.11 What's New Single-Notification System

#### What Is Complete:
- Canonical public JSON feed at `.github/whats-new.json`.
- SSRF-safe fetch with 1-hour cache and stale fallback on network failure.
- SemVer 2.0.0 constraint evaluation (`minVersion`, `maxVersion`).
- Dynamic application version resolution from `config.system.version` (not hardcoded).
- Guaranteed single-item selection (`selectWhatsNewItem` picks newest eligible item).
- Permanent user-scoped dismissal stored in PostgreSQL `settings` table (`namespace = 'user_preferences'`, `key = 'dismissed_whats_new:<user_id>'`).
- Accessible Admin sidebar component with ARIA label and plain-text XSS prevention.

---

## 4. Subsystem Maturity Scorecard

Scale: 0 to 100 based strictly on runtime verification and source code truth.

| Subsystem | Maturity Score | Status Summary |
| :--- | :---: | :--- |
| **Data Integrity & Relational Model** | **85 / 100** | Robust Drizzle schemas, outbox tables, cascades, but soft-delete slug lock flaw. |
| **Authentication & Staff Lifecycle** | **94 / 100** | Argon2id, enumeration resistance, token hashing, session invalidation, setup lock. |
| **Authorization & RBAC** | **68 / 100** | Functional route permissions, but hardcoded role bypasses and lack of object-level checks. |
| **Transactional Outbox & Workers** | **95 / 100** | Fully operational `SKIP LOCKED` outbox dispatcher, BullMQ queues, and retries. |
| **Themes & Liquid Template Sandbox** | **92 / 100** | Memory filesystem sandbox, rigorous zip validator, complete filters and RTL. |
| **What's New System** | **96 / 100** | Production-ready remote feed, SemVer engine, DB dismissal, exact single-card rule. |
| **Billing & Webhooks** | **90 / 100** | Raw body signature checks, SHA-256 deduplication, idempotent transitions. |
| **Email Delivery & Newsletters** | **88 / 100** | Audience snapshotting, batched queue dispatch, suppression handling, HMAC unsub. |
| **i18n & Translation Governance** | **78 / 100** | Robust state machine, Arabic normalizer, but in-memory glossary and no TM. |
| **Search Engine** | **72 / 100** | Functional trigram search with Arabic normalization, but lacks tsvector and multi-tenancy. |
| **AI Platform** | **65 / 100** | Functional multi-provider gateway, but in-memory budgets and lacks content context. |
| **Studio Block Editor** | **75 / 100** | Excellent single-user card editor, serializers, and recovery, but zero collaboration. |
| **Multi-Publication / Tenancy** | **25 / 100** | Standalone tables exist; zero core content tables or API routes are connected. |
| **Plugins Architecture** | **30 / 100** | 1 bundled plugin works; sandbox is insecure `node:vm`; extension host is a mock. |
| **Real-Time Collaboration** | **15 / 100** | In-memory test mock only; no WebSocket server; no client integration. |
| **OVERALL SYSTEM MATURITY** | **71 / 100** | High-quality single-tenant publishing monolith with embryonic enterprise modules. |
