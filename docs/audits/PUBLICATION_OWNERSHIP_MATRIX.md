# Publication Ownership Matrix & Schema Architecture Verification (Phase 7)

## 1. Overview & Verification Purpose

As mandated by Section 5 and Section 6 of the Master Remediation Roadmap, this matrix independently audits and establishes the exact foreign-key relationships, deletion semantics, query paths, and runtime isolation boundaries for all 14 proposed publication-owned tables prior to implementing migration `0026`.

### Governing Invariant
> Client-provided publication identifiers (`X-Publication-Id`, route parameters, query strings) are **never** an authorization grant.
> Tenant scoping must be enforced below the API layer, at the repository level, and backed by explicit PostgreSQL foreign keys.

---

## 2. Publication Ownership Confirmation Matrix

| Table | Owner | publication_id Required | FK Target | Delete Semantics | Repository | API | Worker | Risk & Mitigation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`posts`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzlePostRepository` | `routes/posts.ts`, `content.ts` | `scheduler.ts` (scheduled publishing sweep) | **HIGH**. Current schema has global `slug UNIQUE`. Must replace with composite partial unique index `UNIQUE (publication_id, slug) WHERE deleted_at IS NULL` to support multi-publication slug reuse and safe soft deletion. |
| **`pages`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzlePageRepository` | `routes/pages.ts`, `content.ts` | `scheduler.ts` | **HIGH**. Replace global `slug UNIQUE` with composite partial unique index `UNIQUE (publication_id, slug) WHERE deleted_at IS NULL`. |
| **`tags`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleTagRepository` | `routes/tags.ts`, `content.ts` | None directly | **MEDIUM**. Replace global `slug UNIQUE` with composite `UNIQUE (publication_id, slug)`. |
| **`media_assets`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` (DB) / S3 Garbage Collection | `DrizzleMediaRepository` | `routes/media.ts` | `media-optimizer.ts` | **MEDIUM**. File storage paths must prefix `${publication_id}/` to ensure object storage multi-tenant isolation. |
| **`members`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` (cascades to tokens, sessions, prefs) | `DrizzleMemberRepository` | `routes/members.ts`, `member-auth.ts` | `member-churn.ts`, `digest.ts` | **HIGH**. Currently `email_normalized` is globally unique. Must change to `UNIQUE (publication_id, email_normalized)` so one reader can subscribe to multiple distinct publications. |
| **`products`** | Publication | YES (`NOT NULL`) | `publications(id)` | `RESTRICT` | `DrizzleProductRepository` | `routes/billing.ts` | `stripe-sync.ts` | **HIGH**. Financial integrity: deletion of a publication cannot cascade-destroy financial product records without audit trails. `RESTRICT` prevents accidental cascade. Replace global `key UNIQUE` with `UNIQUE (publication_id, key)`. |
| **`plans`** | Publication | YES (`NOT NULL`) | `publications(id)` | `RESTRICT` | `DrizzlePlanRepository` | `routes/billing.ts` | `stripe-sync.ts` | **MEDIUM**. Protects active subscription pricing tiers. Composite unique index `UNIQUE (publication_id, product_id, key)`. |
| **`newsletters`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleNewsletterRepository` | `routes/newsletters.ts`, `settings.ts` | `email-broadcast.ts` | **MEDIUM**. Replace global `key UNIQUE` with `UNIQUE (publication_id, key)`. Cascades to `newsletter_preferences`. |
| **`search_documents`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleSearchRepository` | `routes/search.ts` | `search-indexer.ts` | **CRITICAL**. "Operation Obsidian" boundary: search queries must never cross tenants. Entity unique constraint must become `UNIQUE (publication_id, entity_type, entity_id)`. |
| **`content_translations`**| Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleTranslationRepository` | `routes/translations.ts` | `ai-translation.ts` | **HIGH**. Existing index `content_translations_locale_slug_idx` on `(target_locale, slug)` is global! Must replace with `UNIQUE (publication_id, target_locale, slug)`. |
| **`automations`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleAutomationRepository` | `routes/automations.ts` | `automation-runner.ts` | **MEDIUM**. Replace global `key UNIQUE` with `UNIQUE (publication_id, key)`. Cascades to `automation_runs`. |
| **`installed_themes`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleThemeRepository` | `routes/themes.ts` | None directly | **LOW**. Custom uploaded themes are scoped to the uploading publication. Built-in themes are linked to the default/system publication `pub_default`. |
| **`webhook_endpoints`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleWebhookRepository` | `routes/webhooks.ts` | `webhook-dispatcher.ts` | **LOW**. Webhook endpoints and deliveries are strictly scoped per publication. |
| **`analytics_events`** | Publication | YES (`NOT NULL`) | `publications(id)` | `CASCADE` | `DrizzleAnalyticsRepository` | `routes/analytics.ts` | `analytics-rollup.ts` | **HIGH**. High write volume. Add composite index `(publication_id, occurred_at)` and `(publication_id, visitor_hash, occurred_at)` for tenant-scoped aggregation performance. |

---

## 3. Pre-Migration Baseline Invariants

Before applying migration `0026`:
1. Default workspace `ws_default` and default publication `pub_default` must be created if not present.
2. Existing records across all 14 tables must be backfilled to `pub_default`.
3. Backfill verification:
   - `SELECT COUNT(*) FROM <table> WHERE publication_id IS NULL` must equal `0`.
   - `SELECT COUNT(*) FROM <table> WHERE publication_id NOT IN (SELECT id FROM publications)` must equal `0`.
4. Index transformation verification:
   - Drop old global unique indexes.
   - Create composite partial unique indexes for `posts` and `pages`.
   - Create composite unique indexes for `tags`, `members`, `products`, `plans`, `newsletters`, `search_documents`, `content_translations`, and `automations`.
