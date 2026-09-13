# Vibress — Technical Debt Register

> **Audit Date**: 2026-09-13  
> **Auditor**: Independent Senior Engineering Audit Team  
> **Repository Commit / Baseline**: Clean Working Tree (Post-Migration `0024_workspaces_publications`)  
> **Classification**: Security, Architectural, Database/Performance, Frontend/Studio, Testing, and Operational Debt

---

## 1. Technical Debt Overview & Risk Classification

Technical debt in Vibress is classified into four operational impact categories:

* **Dangerous Debt (P0 / P1)**: Flaws that can lead to data leaks, unauthorized access, broken user onboarding, or runtime crashes in production.
* **Architectural Debt (P1 / P2)**: Structural mismatch between data models and API execution that impedes scalability or creates maintenance friction.
* **Acceptable Debt (P2 / P3)**: Non-critical shortcuts or missing optimizations that do not cause immediate operational failures at early scale.
* **Temporary Debt (P3)**: Incomplete prototype code or secondary language stubs that can safely wait for post-launch milestones.

---

## 2. Comprehensive Technical Debt Register

| ID | Area | Technical Debt Item | Severity | Why It Matters | Recommended Resolution | When to Resolve |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| **DEBT-01** | **Security / RBAC** | Wildcard `posts.*` and `pages.*` permissions assigned to `author` and `contributor` roles in seed data. | **Dangerous (P0)** | Allows authors and contributors to delete, edit, or publish any post/page in the system without admin or editor approval. | Update `packages/database/src/seed.ts` to assign only `posts.create`, `posts.edit.own`, `posts.read` to authors/contributors. | **Phase 0 (Pre-Launch Blocker)** |
| **DEBT-02** | **Security / Auth** | Lack of author-ownership validation in `PostsService` (`updatePostTx`, `deletePostTx`, `publishPostTx`). | **Dangerous (P1)** | Horizontal privilege escalation: Any authenticated user with `posts.edit` can overwrite or delete another author's drafts or published articles. | Implement user-ownership check (`if (post.authorId !== actorId && !hasRole('admin', 'editor')) throw Forbidden`) in service layer. | **Phase 0 (Pre-Launch Blocker)** |
| **DEBT-03** | **Auth / Onboarding** | Staff user invitation endpoint (`POST /users/invite`) stores dummy argon2 hash and does not dispatch an activation token or invite link. | **Dangerous (P1)** | New team members cannot activate accounts or set passwords. Staff onboarding is completely non-functional without manual SQL database intervention. | Implement invitation token generation, store in `user_invitations` table, dispatch email via `@vibress/email`, and create `POST /auth/invitation/accept` endpoint. | **Phase 0 (Pre-Launch Blocker)** |
| **DEBT-04** | **Auth / Recovery** | Missing staff password reset endpoints (`POST /auth/forgot-password`, `POST /auth/reset-password`). | **Dangerous (P1)** | Staff users who forget their passwords are permanently locked out without administrator database intervention. | Create secure token-based password reset workflow with rate limiting and expiration tracking in Redis/Postgres. | **Phase 0 (Pre-Launch Blocker)** |
| **DEBT-05** | **Architecture / Multi-Tenancy** | Workspaces and Publications data model (`migrations/0020_`, `0024_`) is disconnected from core entities (`posts`, `pages`, `media`, `tags`, `settings`). | **Architectural (P1)** | The codebase claims multi-tenancy support, but at runtime all content is global/single-tenant. Attempting multi-site hosting will leak data across publications. | Add `publication_id` foreign key to `posts`, `pages`, `media`, `tags`, `settings`; enforce query scoping in all service layers and API routes. | **Phase 1 (Pre-Launch or explicitly brand as Single-Tenant v1.0)** |
| **DEBT-06** | **Frontend / Studio** | Unhandled runtime exception in `BlockHandleGutterPlugin.tsx:106:18` during Lexical block gutter hover. | **Dangerous (P1)** | Causes unhandled console error and potential editor state desynchronization when content creators hover or drag block handles in Admin Studio. | Wrap Lexical active editor retrieval in proper `editor.getEditorState().read()` / `editor.update()` callbacks with existence checks. | **Phase 0 (Pre-Launch Blocker)** |
| **DEBT-07** | **Testing / E2E** | Playwright visual regression test compares PNG file buffer byte length instead of actual pixel bitmap difference. | **Dangerous (P2)** | Test suite gives false positives when images differ slightly in metadata/compression, while completely missing real UI visual layout breakages. | Refactor `tests/e2e/visual/multilingual-visual-regression.test.ts` to use Playwright native `toHaveScreenshot()` or `pixelmatch` bitmap comparator. | **Phase 1 (Pre-Launch)** |
| **DEBT-08** | **Database / Search** | Search repository performs unindexed `ILIKE %q%` and dynamic `similarity()` calculations without a dedicated GIN Trigram index. | **Architectural (P2)** | Search queries will suffer severe sequential scan degradation as `search_documents` table grows beyond 10,000 articles. | Add GIN trigram index (`CREATE INDEX idx_search_docs_trgm ON search_documents USING gin (title gin_trgm_ops, body_text gin_trgm_ops)`) in migration. | **Phase 1 (Pre-Launch)** |
| **DEBT-09** | **Database / Driver** | Node `pg` driver emits deprecation warnings: `Calling client.query() when the client is already executing a query is deprecated`. | **Architectural (P2)** | Occurs during concurrent transaction operations in background workers; will break when `pg` library is upgraded to version 9.0. | Refactor worker transactions to ensure dedicated connection checkout from pool or proper async sequencing. | **Phase 1 (Pre-Launch)** |
| **DEBT-10** | **Plugins / Extensibility** | `BundledPluginHost` relies on a static hardcoded array of in-repo plugins with zero runtime dynamic loading or sandbox isolation. | **Architectural (P2)** | Third-party developers cannot build or install external plugins. The plugin system is strictly an internal modular code structure. | Implement a secure sandboxed WASM or Node VM runner with manifest verification for third-party plugin packages. | **Phase 3 (Post-Launch Q2)** |
| **DEBT-11** | **Infrastructure / Caching** | `@vibress/cache` is only a Redis connection factory without higher-level application query caching or tag-based invalidation. | **Acceptable (P2)** | High database load on read-heavy public traffic; every Next.js SSR request hits PostgreSQL directly for posts and settings. | Implement a cache-aside query layer with automated TTL and outbox-driven cache tag invalidation (`posts:slug:*`, `settings:public`). | **Phase 2 (First 90 Days)** |
| **DEBT-12** | **Observability** | Structured Pino logs exist, but distributed tracing (OpenTelemetry / Tempo / Jaeger) and Prometheus metrics are missing. | **Acceptable (P2)** | SRE and operations teams cannot trace cross-service latency (Next.js $\to$ Fastify API $\to$ PostgreSQL $\to$ BullMQ) during production incidents. | Add OpenTelemetry SDK instrumentation to Fastify API, Next.js web app, and BullMQ worker. | **Phase 2 (First 90 Days)** |
| **DEBT-13** | **Localization / Secondary Locales** | French (`fr-FR`) and Persian (`fa-IR`) locales exist in configuration and translation schemas, but lack full UI translation bundles. | **Temporary (P3)** | Non-English/Arabic users will see partial English fallback text across Admin and Portal interfaces. | Complete Crowdin / JSON translation files for French and Persian or restrict active public UI locales to `en-US` and `ar-SA` for v1.0. | **Phase 2 (First 90 Days)** |
| **DEBT-14** | **Content Modeler** | Custom content model schemas exist in database, but Lexical Studio lacks dynamic schema-driven form field rendering. | **Temporary (P3)** | Editors cannot visually input custom schema fields (e.g. event dates, product prices) inside the main article editor UI. | Build dynamic React JSON Schema form sidebar in `@vibress/studio-react` bound to `post.customFields`. | **Phase 2 (First 90 Days)** |

---

## 3. Debt Summary by Category & Phase

```
Total Registered Debt Items: 14

By Severity:
- Dangerous Debt (P0/P1):      5 items (35.7%)
- Architectural Debt (P1/P2):   4 items (28.6%)
- Acceptable Debt (P2):         3 items (21.4%)
- Temporary Debt (P3):          2 items (14.3%)

Resolution Target Phase:
- Phase 0 (Pre-Launch Blockers):    4 items (DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-06)
- Phase 1 (Pre-Launch Hardening):   4 items (DEBT-05, DEBT-07, DEBT-08, DEBT-09)
- Phase 2 (First 90 Days):          4 items (DEBT-11, DEBT-12, DEBT-13, DEBT-14)
- Phase 3 (3–6 Months):             1 item  (DEBT-10)
```
