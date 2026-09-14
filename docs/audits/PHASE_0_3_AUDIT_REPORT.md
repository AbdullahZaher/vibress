# Phase 0–3 Master Audit Report & Implementation Go / No-Go Gate

**Audit Date:** 2026-09-14T09:28:30Z  
**Certified Baseline Commit:** `a9ef87dea758fd1f233f86543b3725af303cd38c`  
**Lead Investigator:** Principal Product Architect + Security Engineer + Senior Full-Stack Engineer  
**Scope:** Forensic runtime verification of Vibress architecture, product surfaces, security boundaries, database invariants, and navigation coherence.

---

## 1. Executive Summary

This independent forensic audit was conducted strictly across the live codebase and runtime environment of Vibress. No claims in documentation, previous certification reports, or passing unit tests were accepted without real runtime verification.

### Core Discoveries
1. **The System Is Structurally Robust at the Core:**
   - 71 TypeScript packages compile cleanly (`pnpm run typecheck` passes with 0 errors).
   - Production Docker topology (`compose.prod.yml`) isolates PostgreSQL 16 and Redis 7 on an internal backend network.
   - Core domain engines (Authentication, Billing/Stripe webhooks, Transactional Outbox, Theme engine, ZIP validation, What's New remote feed, Studio block renderer, and Multilingual translations) are real, mature, and well-tested.
2. **False-Confidence Isolation Boundaries:**
   - Multi-publication tenant isolation tests in `@vibress/workspaces` passed 100% of their test suites, but were discovered to be running exclusively against an in-memory repository (`InMemoryWorkspaceRepository`) and mock functions. In PostgreSQL, 14 core tables (`posts`, `pages`, `media_assets`, `tags`, `members`, `products`, `plans`, `newsletters`, `search_documents`, `content_translations`, `automations`, `installed_themes`, `webhook_endpoints`, `analytics_events`) currently lack `publication_id`.
3. **P0 Security Vulnerability in Plugin Sandbox:**
   - `packages/plugin-core/src/sandbox.ts` uses Node.js standard `node:vm` (`vm.createContext`, `new vm.Script(code).runInContext(...)`). The official Node.js security documentation explicitly states that `node:vm` is not a secure sandbox. Prototype traversal can achieve Remote Code Execution (RCE) on the host machine.
4. **Soft-Deleted Slug Collisions:**
   - PostgreSQL unique constraints on `posts.slug`, `pages.slug`, and `tags.slug` are unconditional (`UNIQUE (slug)`). When an item is soft deleted (`deleted_at` set), the slug remains reserved in PostgreSQL, throwing fatal unique violation errors (HTTP 500/409) if an author re-creates an article with the same slug.
5. **Orphaned "Network" Surface & Navigation Incoherence:**
   - "Network" in `NavMain.tsx` has no underlying database table, domain service, or API. It simply routes to `/admin/community`, which dumps the user into SettingsHub > Growth.
   - The actual editorial comments moderation console (`CommunitySettings.tsx` containing `CommentsPanel.tsx` and `ReportsPanel.tsx`) is coded but completely unmounted in `router.tsx`.

---

## 2. Network Deep Audit & Forensic Analysis

We conducted an exhaustive audit of "Network" across code, database schemas, API routes, and documentation:

### 2.1 The 12 Mandatory Questions

1. **What problem is Network intended to solve?**
   - In blogging and publication platforms (such as Substack Network or Ghost Recommendations), authors want to cross-promote other independent publications to exchange audience growth.
2. **Is there a Network domain model?**
   - **No.** There is no `Network` domain model. The existing domain model is `@vibress/recommendations` (Recommendation entity).
3. **Is there a Network database table?**
   - **No.** There is no `networks` table. The existing table is `recommendations` (storing `id`, `url`, `title`, `description`, `imageUrl`, `faviconUrl`, `status`, `sortOrder`).
4. **Is there a Network API?**
   - **No.** The existing API endpoints are `/api/admin/v1/recommendations` and `/api/public/v1/recommendations`.
5. **Is there a Network domain service?**
   - **No.** The existing domain service is `RecommendationsService`.
6. **Is there a Network permission model?**
   - **No.** The permissions are `recommendations.read` and `recommendations.manage`.
7. **Is there a Network persistence workflow?**
   - Yes, for recommendations: Authors can add, update, and archive publication recommendations via `RecommendationsCard.tsx` inside Settings > Growth.
8. **Is there a Network consumer?**
   - **No.** The public endpoint `/api/public/v1/recommendations` exists, but the reader frontend (`apps/web`) does not yet consume or display recommendations anywhere in templates.
9. **What does `/admin/community` actually render?**
   - It renders `<SettingsHub initialSection="growth" can={can} />`. It does NOT render a Network view, nor does it render `CommunitySettings.tsx`.
10. **What does the sidebar label imply?**
    - The label "Network" with the `Share2` icon in `NavMain.tsx` implies a top-level federated social network, ActivityPub feed, or network graph of publications.
11. **Is Network merely a duplicate navigation trigger?**
    - **Yes.** Both "Network" in `NavMain.tsx` and "Comments" in `NavContent.tsx` trigger `onNavigate("/admin/community")`.
12. **Is its actual functionality Recommendations / Blogroll?**
    - **Yes.** The real backend functionality is publication recommendations (blogroll).

### 2.2 Network Classification
**Classification: `ORPHANED / REQUIRES_PRODUCT_DESIGN` (for standalone Network) and `COMPLETE_AS_MVP` (for Recommendations & Blogroll).**

### 2.3 Network UX Decision
**Selected Decision: Option B — Hide "Network" from Primary Navigation.**
- Remove the misleading "Network" button from `NavMain.tsx`.
- Recommendations & Blogroll is already cleanly housed in **Settings > Growth > Recommendations & Blogroll** (`RecommendationsCard.tsx`).
- Route the "Comments" navigation item in `NavContent.tsx` to a dedicated route `/admin/comments` rendering the actual comments and reports moderation console (`CommunitySettings.tsx`).

---

## 3. Navigation Problems & Product Information Architecture

### 3.1 Sidebar Cleanup Decisions
| Current Item | Surface Location | Target Route | Issue | Remediation Decision |
| :--- | :--- | :--- | :--- | :--- |
| **Network** | `NavMain.tsx` | `/admin/community` | Misleading phantom feature; duplicates Comments trigger | **HIDE / REMOVE** from `NavMain`. Real functionality belongs in Settings > Growth > Recommendations. |
| **Comments** | `NavContent.tsx` | `/admin/community` | Dumps into SettingsHub instead of showing moderation queue | **MOVE / RETARGET** to `/admin/comments` rendering `CommunitySettings.tsx`. |
| **View site** | `NavMain.tsx` | `/` | Opens homepage in new tab | **KEEP** (working, verified). |
| **Analytics** | `NavMain.tsx` | `/admin` | Main KPI dashboard | **KEEP** (working, verified). |
| **Posts** | `NavContent.tsx` | `/admin/posts` | Editorial content list | **KEEP** (working, verified). |
| **Pages** | `NavContent.tsx` | `/admin/pages` | Static site pages | **KEEP** (working, verified). |
| **Translations** | `NavContent.tsx` | `/admin/translations` | Multilingual editorial matrix & review queue | **KEEP** (working, verified). |
| **Tags** | `NavContent.tsx` | `/admin/tags` | Content taxonomies | **KEEP** (working, verified). |
| **Content Models** | `NavContent.tsx` | `/admin/models` | Custom structured schemas & collections | **KEEP** (working, verified). |
| **Media** | `NavContent.tsx` | `/admin/media` | Media library | **KEEP** (working, verified). |
| **Members** | `NavContent.tsx` | `/admin/members` | Reader subscriber base | **KEEP** (working, verified). |
| **Automations** | `NavContent.tsx` | `/admin/automations` | Workflow automation builder | **KEEP** (working, verified). |
| **Settings** | `NavSettings.tsx` | `/admin/settings/*` | Centralized Settings Hub | **KEEP** (working, verified). |

### 3.2 Admin vs Studio Boundary
- **Admin App (`apps/admin`):**
  - High-level platform operations, system configuration, subscriber management, billing/plans, media library, content model schemas, translation governance, and site settings.
- **Studio Surface (`PostEditor.tsx` / `PageEditor.tsx` / packages/studio-*):**
  - Rich block creation, editorial drafting, inline comments/suggestions, revision history, and publication workflow transitions.

---

## 4. Security Findings & Remediation Plan

### 4.1 Finding SEC-01: Untrusted VM Execution in Plugin Core (P0)
- **Component:** `packages/plugin-core/src/sandbox.ts`
- **Vulnerability:** Use of `node:vm` to execute dynamic plugin code.
- **Remediation:** Remove `node:vm`. Implement a strict `BundledPluginRegistry` that permits only verified internal plugins for v1.x (`vibress-content-metrics`). External arbitrary code execution will fail closed with `PluginSecurityViolationError`.
- **Test:** `tests/integration/plugin-security-boundary.test.ts`.

### 4.2 Finding SEC-02: CRDT Collaboration Endpoint Unbounded State & Rate (P1)
- **Component:** `apps/api/src/routes/collaboration.ts` (`POST /posts/:id/collaboration/crdt`)
- **Vulnerability:** Unbounded base64 payload size, unhandled decoding errors, lack of rate limiting, and in-memory-only document retention.
- **Remediation:** Cap base64 payloads to 64 KB, validate structure with safe parsing, implement rate limiting per post/user, and document clearly as durable state exchange.

### 4.3 Finding SEC-03: Hardcoded Role String RBAC Bypass (P1)
- **Component:** `packages/security/src/authorization/index.ts`
- **Vulnerability:** Role strings (`owner`, `administrator`, `editor`) grant unconditional permission bypasses regardless of database grants.
- **Remediation:** Remove role string bypasses. Resolve authorization strictly through granular capabilities (`userPermissions.includes(requiredPermission)`). Ensure database seeds grant owners full capabilities through database `role_permissions` rows.

---

## 5. Database Ownership Model & Tenancy Strategy

### 5.1 Table Ownership Classifications

| Table | Current Owner | Correct Owner | Rationale | Needs `publication_id`? |
| :--- | :--- | :--- | :--- | :--- |
| `workspaces` | SYSTEM | SYSTEM | Top-level tenant container | No |
| `workspace_members` | WORKSPACE | WORKSPACE | Workspace staff access | No |
| `publications` | WORKSPACE | WORKSPACE | Publication entity under workspace | Parent (`id`) |
| `publication_locales`| PUBLICATION | PUBLICATION | Locales for publication | Already has `publication_id` |
| `publication_memberships`| PUBLICATION| PUBLICATION | Staff role in publication | Already has `publication_id` |
| `users` | SYSTEM | SYSTEM | Global staff credentials | No |
| `posts` | GLOBAL (missing) | PUBLICATION | Editorial articles are publication-scoped | **YES** |
| `pages` | GLOBAL (missing) | PUBLICATION | Site pages are publication-scoped | **YES** |
| `tags` | GLOBAL (missing) | PUBLICATION | Taxonomies are publication-scoped | **YES** |
| `media_assets` | GLOBAL (missing) | PUBLICATION | Assets belong to publication | **YES** |
| `members` | GLOBAL (missing) | PUBLICATION | Reader subscribers are publication-scoped | **YES** |
| `products` | GLOBAL (missing) | PUBLICATION | Subscription products are publication-scoped | **YES** |
| `plans` | GLOBAL (missing) | PUBLICATION | Pricing plans belong to publication products | **YES** |
| `newsletters` | GLOBAL (missing) | PUBLICATION | Email publications belong to publication | **YES** |
| `search_documents` | GLOBAL (missing) | PUBLICATION | Search index must be isolated | **YES** |
| `content_translations` | GLOBAL (missing)| PUBLICATION | Translations belong to publication | **YES** |
| `automations` | GLOBAL (missing) | PUBLICATION | Automated workflows are publication-scoped | **YES** |
| `installed_themes` | GLOBAL (missing) | PUBLICATION | Themes are installed per publication | **YES** |
| `webhook_endpoints` | GLOBAL (missing)| PUBLICATION | Webhooks belong to publication | **YES** |
| `analytics_events` | GLOBAL (missing) | PUBLICATION | Traffic metrics are publication-scoped | **YES** |

### 5.2 Migration & Backfill Strategy
Migration `0026_multi_publication_tenant_isolation.sql` will:
1. Ensure default workspace `ws_default` and default publication `pub_default` exist.
2. Add nullable `publication_id` referencing `publications(id) ON DELETE CASCADE`.
3. Backfill existing records to `pub_default`.
4. Assert zero NULL records exist.
5. Set `publication_id` to `NOT NULL`.
6. Drop global unique constraints on `posts(slug)`, `pages(slug)`, and `tags(slug)`.
7. Add partial unique indexes `UNIQUE (publication_id, slug) WHERE deleted_at IS NULL`.
8. Add performance indexes on `publication_id` across all scoped tables.

---

## 6. Implementation Go / No-Go Gate

| Proposed Remediation | Decision | Concrete Evidence | Risk Level | Required Change | Dependencies | Required Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Remove "Network" from NavMain** | **GO** | `NavMain.tsx` line 35 routes to `/admin/community`; no backend model exists | Low | Delete button from `NavMain.tsx` | None | Verify sidebar renders cleanly without Network |
| **Mount Dedicated `/admin/comments` Route** | **GO** | `CommunitySettings.tsx` exists and connects to real comment moderation APIs but is unmounted | Low | Add `/admin/comments` route in `router.tsx` pointing to `CommunitySettings.tsx` | `@vibress/comments` | E2E navigation to `/admin/comments` |
| **Deprecate `node:vm` in Plugin Core** | **GO** | `packages/plugin-core/src/sandbox.ts` uses dangerous `node:vm` (P0 RCE risk) | Medium | Remove `node:vm`, restrict to `BundledPluginRegistry` | None | `tests/integration/plugin-security-boundary.test.ts` |
| **Cap CRDT Collaboration Payloads** | **GO** | `apps/api/src/routes/collaboration.ts` accepts unbounded base64 strings | Low | Add 64 KB cap and safe parsing | None | Route unit tests with oversized payload |
| **Multi-Publication Tenancy Migration** | **GO** | 14 tables lack `publication_id`; tests currently use in-memory mocks | High | Write Drizzle migration `0026_...`, backfill to default pub, add indexes | Database runner | `tests/integration/tenant-isolation-boundary.test.ts` |
| **Fastify Canonical Tenant Resolver** | **GO** | `req.tenant` is missing from request lifecycle | Medium | Add tenant resolver in auth middleware validating publication membership | Auth service | Integration tests asserting cross-tenant rejection |
| **Repository Publication Scoping** | **GO** | Repositories query globally without `publicationId` | Medium | Add `publicationId` parameter to all query methods | Domain repos | Real PostgreSQL queries scoped by tenant |
| **Soft-Deleted Slug Partial Indexes** | **GO** | Re-creating post with soft-deleted slug crashes with unique violation | Medium | Drop global unique constraint, add partial index `WHERE deleted_at IS NULL` | Database migration | `tests/integration/slug-uniqueness-lifecycle.test.ts` |
| **Search Publication Scoping** | **GO** | `search_documents` has no tenant isolation, leaking cross-publication results | Medium | Add `publication_id` to search schema, repo, indexer, and query | Search domain | Cross-publication search isolation test (`OperationObsidian`) |
| **RBAC Capability-Based Hardening** | **GO** | Hardcoded role strings (`owner`, `administrator`, `editor`) bypass DB grants | Medium | Remove role string bypasses, resolve strictly through capability grants | Security package | `tests/integration/rbac-hardening.test.ts` |

---

## 7. Mandatory Exit Gate Declaration

All Phase 0–3 discovery tasks are complete:
- Baseline documented in `docs/audits/PRODUCT_SURFACE_BASELINE.md`.
- Inventory documented in `docs/audits/ADMIN_FEATURE_REALITY_MATRIX.md`.
- Feature tracing documented in `docs/audits/FEATURE_DEPENDENCY_MAP.md`.
- Network deep dive completed and UX decision established.
- Implementation Go / No-Go decisions confirmed.

**STATUS: READY TO PROCEED TO PHASE 4 (IMPLEMENTATION).**
