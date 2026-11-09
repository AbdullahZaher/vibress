# Vibress Content Modeler — Deep Production Readiness Audit

**Audit Timestamp**: September 19, 2026  
**Audit HEAD**: `92b3a46072e4243ea1a2eab9936172894dba4f86`  
**Audit Type**: Read-Only Source Code, Architecture, Schema & API Audit (No Code Changes)

---

## Executive Summary

A comprehensive, code-level audit of the Vibress **Content Modeler** was conducted across all packages, database schemas, migrations, API routes, admin UI components, theme engines, and test suites.

### Core Verdict
**ARCHITECTURAL FOUNDATION ONLY (NOT PRODUCTION READY)**

While the underlying domain package (`@vibress/content-modeler`) implements an expressive in-memory field validation engine supporting 16+ data types and JSONB storage, the subsystem suffers from **critical architectural blockers**, **multi-tenant isolation deficits**, **frontend/backend contract mismatches**, **unimplemented Liquid/Theme integrations**, and **data leakage vulnerabilities** on public API endpoints.

---

## 1. System Map & Implementation Inventory

| Component | File Path | Status |
| :--- | :--- | :--- |
| **Database Schema** | `packages/database/src/schema/content-models.ts` | Implemented (Lacks `publication_id`) |
| **Database Migration** | `packages/database/migrations/0019_content_modeler.sql` | Applied (Migration 0019) |
| **Domain Types** | `packages/domains/content-modeler/src/domain/types.ts` | Implemented |
| **Domain Validation** | `packages/domains/content-modeler/src/domain/validation.ts` | Implemented |
| **Application Service** | `packages/domains/content-modeler/src/application/content-modeler-service.ts` | Implemented |
| **Admin API Routes** | `apps/api/src/routes/content-models.ts` (`contentModelerRoutes`) | Implemented (`/api/admin/v1/content-models`) |
| **Public API Routes** | `apps/api/src/routes/content-models.ts` (`publicContentModelRoutes`) | Implemented (`/api/content/v1/collections`) |
| **Admin Model List** | `apps/admin/src/components/models/ContentModelList.tsx` | Implemented (`/admin/models`) |
| **Admin Model Editor** | `apps/admin/src/components/models/ContentModelEditor.tsx` | Implemented (`/admin/models/new`, `/:id`) |
| **Admin Entry List** | `apps/admin/src/components/collections/DynamicCollectionList.tsx` | Implemented (`/admin/collections/:slug`) |
| **Admin Entry Editor** | `apps/admin/src/components/collections/DynamicCollectionEntryEditor.tsx` | Implemented (`/admin/collections/:slug/new`, `/:id`) |
| **Theme / Liquid Engine** | `packages/theme-core` | **MISSING** (Zero Custom Model / Collection integration) |
| **Public Web Routes** | `apps/web/src/app` | **MISSING** (No dynamic collection pages) |
| **Unit / Service Tests** | `packages/domains/content-modeler/src/__tests__/*` | 3 test suites (12 tests) |
| **API Integration Tests** | `apps/api/src/__tests__/content-models-api.test.ts` | 1 test suite (6 tests) |
| **E2E Playwright Tests** | `tests/e2e/content-modeler-flow.test.ts` | 1 test (1 happy path) |

---

## 2. Product Capability Audit

### A. Model Management

| Capability | Status | Implementation Evidence | Critical Notes |
| :--- | :--- | :--- | :--- |
| **Create Model** | **PASS** | `ContentModelerService.createModel` (`content-modeler-service.ts:82`) | Persists schema JSONB to `content_models` |
| **Edit Model** | **PARTIAL** | `ContentModelerService.updateModel` (`content-modeler-service.ts:102`) | Backend supports `PUT`, but Admin UI sends `PATCH` → 404 in UI |
| **Delete Model** | **PASS** | `ContentModelerService.deleteModel` (`content-modeler-service.ts:130`) | Cascades to `content_entries` |
| **Duplicate Model** | **MISSING** | No service method or API endpoint | Must re-enter schema manually |
| **Publish/Activate Model** | **MISSING** | No lifecycle status on `content_models` table | All created models are immediately active |
| **Draft Model Changes** | **MISSING** | No staging/draft schema state | Modifying model applies directly to live entries |
| **Model Versioning** | **MISSING** | No version history table for models | Only `updatedAt` timestamp |
| **Model Slug / Key** | **PASS** | `content_models.slug` (`content-models.ts:60`) | Auto-generated or custom slug |
| **Model Display Name** | **PASS** | `content_models.name` | Required text column |
| **Model Description** | **PASS** | `content_models.description` | Optional text column |
| **Model Reordering** | **MISSING** | No `position`/`sortOrder` column | Sorted strictly by `createdAt DESC` |
| **Model Status** | **MISSING** | No `status` column on `content_models` table | N/A |

### B. Field Capability Matrix

| Field Type | Schema Enum | Validation | DB Storage | Admin Config | Admin Form | API Public | Theme Liquid | Tests | Verdict |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Short Text** (`text`, `short_text`) | ✅ | ✅ | JSONB string | ✅ | `<input type="text">` | ✅ | ❌ | ✅ | **IMPLEMENTED AND VERIFIED** |
| **Long Text** (`long_text`) | ✅ | ✅ | JSONB string | ✅ | `<input type="text">` | ✅ | ❌ | ❌ | **IMPLEMENTED AND VERIFIED** |
| **Rich Text** (`rich_text`) | ✅ | ✅ | JSONB string | ✅ | `<textarea>` (No Lexical) | ✅ | ❌ | ✅ | **IMPLEMENTED BUT NOT VERIFIED (No WYSIWYG)** |
| **Studio Document** (`studio_doc`) | ✅ | ✅ | JSONB object | ❌ | `<input type="text">` | ✅ | ❌ | ✅ | **ARCHITECTURAL FOUNDATION ONLY** |
| **Number / Decimal** (`number`) | ✅ | ✅ | JSONB number | ✅ | `<input type="number">` | ✅ | ❌ | ✅ | **IMPLEMENTED AND VERIFIED** |
| **Boolean** (`boolean`) | ✅ | ✅ | JSONB boolean | ✅ | `<input type="checkbox">` | ✅ | ❌ | ✅ | **IMPLEMENTED AND VERIFIED** |
| **Date** (`date`) | ✅ | ✅ | JSONB string | ✅ | `<input type="date">` | ✅ | ❌ | ✅ | **IMPLEMENTED AND VERIFIED** |
| **DateTime** (`datetime`) | ✅ | ✅ | JSONB string | ❌ | `<input type="text">` | ✅ | ❌ | ✅ | **IMPLEMENTED BUT NOT VERIFIED** |
| **URL** (`url`) | ✅ | ✅ | JSONB string | ❌ | `<input type="text">` | ✅ | ❌ | ✅ | **IMPLEMENTED AND VERIFIED** |
| **Email** (`email`) | ✅ | ✅ | JSONB string | ❌ | `<input type="text">` | ✅ | ❌ | ✅ | **IMPLEMENTED AND VERIFIED** |
| **Select** (`select`) | ✅ | ✅ | JSONB value | ✅ | `<select>` dropdown | ✅ | ❌ | ✅ | **IMPLEMENTED AND VERIFIED** |
| **Multi-Select** (`multi_select`) | ✅ | ✅ | JSONB array | ❌ | `<input type="text">` ⚠️ | ✅ | ❌ | ✅ | **BROKEN IN UI (String vs Array clash)** |
| **Media / Image / File** (`media`) | ✅ | ⚠️ | JSONB string | ❌ | `<input type="text">` (No Picker) | ✅ | ❌ | ⚠️ | **ARCHITECTURAL FOUNDATION ONLY** |
| **Taxonomy** (`taxonomy`) | ✅ | ✅ | JSONB array | ❌ | `<input type="text">` ⚠️ | ✅ | ❌ | ⚠️ | **BROKEN IN UI (String vs Array clash)** |
| **Relation (1:1 / N:1)** (`relation`) | ✅ | ⚠️ | JSONB ID | ❌ | `<input type="text">` (No Picker) | ✅ | ❌ | ⚠️ | **ARCHITECTURAL FOUNDATION ONLY** |
| **Relation List (1:N / M:N)** (`relation_list`) | ✅ | ✅ | JSONB array | ❌ | `<input type="text">` ⚠️ | ✅ | ❌ | ⚠️ | **BROKEN IN UI (String vs Array clash)** |
| **JSON** (`json`) | ✅ | ⚠️ | JSONB object | ❌ | `<input type="text">` ⚠️ | ✅ | ❌ | ⚠️ | **BROKEN IN UI (String vs Object clash)** |
| **Repeatable / Blocks** | ❌ | ❌ | N/A | ❌ | ❌ | ❌ | ❌ | ❌ | **MISSING** |
| **Localized Fields** | ⚠️ | ❌ | Flat JSONB | ❌ | ❌ | ❌ | ❌ | ❌ | **MISSING (Ignored in runtime)** |

---

## 3. Database & Architecture Audit

### Schema Structure
- **Models Table**: `packages/database/src/schema/content-models.ts:55` (`content_models`)
  - Columns: `id` (text PK), `name` (text), `slug` (text unique), `description` (text), `fields` (jsonb), `settings` (jsonb), `createdAt`, `updatedAt`.
- **Entries Table**: `packages/database/src/schema/content-models.ts:79` (`content_entries`)
  - Columns: `id` (text PK), `modelId` (FK `content_models.id` ON DELETE cascade), `title` (text), `slug` (text), `data` (jsonb), `status` (text: draft/published/archived), `version` (integer), `createdBy` (FK `users.id`), `updatedBy` (FK `users.id`), `publishedAt`, `createdAt`, `updatedAt`, `deletedAt`.

### Database Integrity Findings

1. **NO GIN Index on JSONB Data**:
   - `content_entries.data` has no GIN or BTREE index.
   - Any custom field search or filtering (e.g. `data->>'category' = 'news'`) requires a full table scan.
2. **Soft-Delete Unique Constraint Bug**:
   - Index: `CREATE UNIQUE INDEX "content_entries_model_slug_idx" ON "content_entries" ("model_id", "slug")`.
   - The index is **NOT partial** (`WHERE deleted_at IS NULL`).
   - If an entry is soft-deleted (`deletedAt = now()`), creating a new entry with the same slug inside the same model will fail with a Postgres `23505 unique_violation`.
3. **Absence of Relational FK Enforcement for Custom Relations**:
   - Relations between models are stored as bare text IDs inside JSONB (`data.authorRef = "usr_123"`).
   - Database cannot enforce referential integrity or cascading nullification when target records are deleted.

---

## 4. Multi-Tenancy & Publication Isolation Audit

### 🚨 Critical Vulnerability: Complete Absence of Publication Isolation

In Vibress, all core tables (`posts`, `pages`, `comments`, `media`, `newsletters`, `tags`, `settings`, `members`) enforce strict publication isolation via a mandatory `publication_id` column and foreign key to `publications(id)`.

In `content-models` and `content_entries`:
- **`publication_id` IS MISSING from `content_models`**.
- **`publication_id` IS MISSING from `content_entries`**.
- **`content_models_slug_idx` is globally unique across the entire database**.

### Cross-Tenant Exploitation Vectors:
1. **Model Namespace Collision**: If Tenant Alpha creates a model named `products` (`slug: "products"`), Tenant Beta is blocked from creating any model named `products` (Postgres Unique Error).
2. **Global Model Enumeration**: `GET /api/admin/v1/content-models` returns all content models across all tenants.
3. **Cross-Tenant Entry Access & Mutation**: Any staff user with `posts.read` / `posts.edit` permissions in Publication Alpha can read, create, update, or soft-delete content entries belonging to Publication Beta by hitting `/api/admin/v1/content-models/:slug/entries`.
4. **Public Catalog Exposure**: `GET /api/content/v1/collections/:modelSlug` does not accept or filter by `publication_id` or Host header, exposing custom collections across all tenants.

---

## 5. API Audit

### API Inventory & Endpoint Analysis

| Method | Path | Auth / RBAC | Validation | Scoping | Status / Risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/v1/content-models` | Staff (`posts.read`) | None | ❌ Global | **LEAKS ALL TENANTS** |
| `POST` | `/api/admin/v1/content-models` | Staff (`settings.edit`) | Name required | ❌ Global | **GLOBAL NAMESPACE CLASH** |
| `GET` | `/api/admin/v1/content-models/:idOrSlug` | Staff (`posts.read`) | ID/Slug | ❌ Global | **CROSS-TENANT IDOR** |
| `PUT` | `/api/admin/v1/content-models/:id` | Staff (`settings.edit`) | Full schema | ❌ Global | **UI USES PATCH (404 IN UI)** |
| `DELETE` | `/api/admin/v1/content-models/:id` | Staff (`settings.edit`) | ID | ❌ Global | **CROSS-TENANT DELETION** |
| `GET` | `/api/admin/v1/content-models/:modelSlug/entries` | Staff (`posts.read`) | Status, Limit, Offset | ❌ Global | **NO CUSTOM FIELD FILTERING** |
| `POST` | `/api/admin/v1/content-models/:modelSlug/entries` | Staff (`posts.edit`) | `validateEntryData` | ❌ Global | **VALIDATION ACTIVE** |
| `GET` | `/api/admin/v1/content-models/:modelSlug/entries/:entryId` | Staff (`posts.read`) | Entry ID/Slug | ❌ Global | **CROSS-TENANT IDOR** |
| `PUT` | `/api/admin/v1/content-models/:modelSlug/entries/:entryId` | Staff (`posts.edit`) | `validateEntryData` | ❌ Global | **UI USES PATCH (404 IN UI)** |
| `DELETE` | `/api/admin/v1/content-models/:modelSlug/entries/:entryId` | Staff (`posts.edit`) | Soft-delete | ❌ Global | **CROSS-TENANT SOFT DELETE** |
| `GET` | `/api/content/v1/collections/:modelSlug` | Public | Status="published" | ❌ Global | **LEAKS PRIVATE FIELDS** |
| `GET` | `/api/content/v1/collections/:modelSlug/:entrySlug` | Public | Status="published" | ❌ Global | **LEAKS PRIVATE FIELDS** |

### ⚠️ Data Leakage Finding: Unapplied Field Visibility Filter
- The utility function `filterEntryDataForVisibility(data, fieldDefs, role)` is fully implemented and tested in `packages/domains/content-modeler/src/domain/validation.ts:168`.
- However, `publicContentModelRoutes` in `apps/api/src/routes/content-models.ts:289,319` **NEVER invokes `filterEntryDataForVisibility`**.
- Result: Public clients requesting `/api/content/v1/collections/:slug` receive the entire raw `data: jsonb` payload, completely ignoring fields configured with `apiVisibility: "private"` or `apiVisibility: "authenticated"`.

---

## 6. Admin UI / UX Audit

### Components Implemented:
1. `apps/admin/src/components/models/ContentModelList.tsx`
2. `apps/admin/src/components/models/ContentModelEditor.tsx`
3. `apps/admin/src/components/collections/DynamicCollectionList.tsx`
4. `apps/admin/src/components/collections/DynamicCollectionEntryEditor.tsx`

### Functional Deficits & UI Bugs:
1. **PATCH vs PUT Contract Failure**:
   - `ContentModelEditor.tsx:137` submits `method: "PATCH"` to `/api/admin/v1/content-models/${modelId}`.
   - `DynamicCollectionEntryEditor.tsx:116` submits `method: "PATCH"` to `/api/admin/v1/content-models/${modelSlug}/entries/${entryId}`.
   - Fastify routes only register `PUT`.
   - **Result**: Editing any existing model or any existing collection entry throws an immediate API error in the UI.
2. **Type Coercion Failure for Array & Object Inputs**:
   - `DynamicCollectionEntryEditor.tsx:288` renders a single `<input type="text">` for any field type that is not `boolean`, `select`, or `rich_text`.
   - When editing fields of type `multi_select`, `taxonomy`, `relation_list`, or `json`, the user types a string into the input.
   - The backend validator (`validateEntryData`) requires arrays for `multi_select`/`relation_list` and objects for `json`.
   - **Result**: Submitting entries with these field types fails validation with `"Field 'X' must be an array"`.
3. **No Studio Editor for Rich Text / Studio Doc**:
   - `rich_text` renders an unstyled `<textarea>`.
   - `studio_doc` renders a single-line `<input type="text">`.
   - There is no Lexical editor mount or Markdown preview.
4. **No Media Library / Unsplash Picker**:
   - `media` field renders a single-line `<input type="text">`. No file uploader or Media Library modal.

---

## 7. Schema Evolution & Migration Analysis

| Scenario | Behavior | Consequence |
| :--- | :--- | :--- |
| **Add Optional Field** | Accepted cleanly | Existing entries omit key; validates `true`. |
| **Add Required Field** | Existing entries lack key | Existing entries read fine, but updating them fails validation unless backfilled. |
| **Rename Field** | Key changed in schema | Old entries retain previous key in `data: jsonb`. Data is orphaned unless migrated. |
| **Change Field Type** | Type changed in schema | Existing data of old type fails validation on next update. |
| **Delete Field** | Key removed from schema | Old data remains permanently stored in JSONB. |
| **Automated Migrations** | **MISSING** | No data backfill runner or schema evolution engine exists. |

---

## 8. Theme / Liquid Integration Audit

### 🚨 Critical Gap: Zero Liquid & Public Web Exposure

Vibress is designed as a publication platform where content is rendered via Liquid templates and the Next.js web application (`apps/web`).

### Findings:
1. **Liquid Context**: `packages/theme-core/src/theme-engine.ts` and `view-models.ts` expose `post`, `posts`, `page`, `author`, `tag`, `site`, `pagination`, and `settings`. There is **no `collections` or `content_models` view model**.
2. **Liquid Tags**: There is no custom Liquid tag (e.g. `{% collection 'products' %}`) or Liquid filter for querying custom collections.
3. **Web Routes**: `apps/web/src/app` has no dynamic route handler for `/collections/[slug]` or custom model slugs.
4. **Rendering Path**: It is conceptually and practically impossible for a Vibress theme to render custom content model entries without writing bespoke client-side JavaScript fetching `/api/content/v1/collections/:slug`.

---

## 9. Localization Audit

- **Model Localization**: Missing. Models have single `name` and `description` strings.
- **Field Localization**: Missing. `ContentFieldDefinition.localizable` exists as a TypeScript type property, but `validateEntryData`, `ContentModelerService`, and the Admin UI completely ignore it.
- **Entry Localization**: Missing. Entries have a single title, slug, and flat `data: jsonb` object. There is no language selector, translation linking, or multi-lingual field structure in custom collections.

---

## 10. Relations Audit

- Relations are stored as raw strings in `data[field.key]` (e.g. `"usr_123"` or `"post_456"`).
- **No Relation Picker**: Admin UI renders a raw text box for relation IDs.
- **No Relation Expansion**: The API does not resolve or populate related records (e.g. `?expand=authorRef` is not supported).
- **No Referential Integrity**: Deleting a referenced entity leaves a stale ID in the JSONB document.

---

## 11. Media Integration Audit

- Custom `media` fields store plain URL strings.
- **No Media Picker Integration**: Does not hook into `MediaLibraryModal`, `MediaPickerImageThumbnail`, or Unsplash API.
- **No Canonical Storage Resolution**: Unlike `posts.feature_image`, custom collection media URLs are not passed through `resolveCanonicalStorageRoot()` or provider-aware URL generators.

---

## 12. Security Findings Summary

| ID | Severity | Category | Description | Location |
| :--- | :---: | :--- | :--- | :--- |
| **SEC-CM-01** | **CRITICAL** | Multi-Tenancy / IDOR | `content_models` and `content_entries` lack `publication_id`, causing complete cross-tenant model and data leaks. | `content-models.ts:55,79` |
| **SEC-CM-02** | **HIGH** | Data Leakage | Public API `/api/content/v1/collections/:slug` fails to call `filterEntryDataForVisibility`, leaking private and member-only fields. | `routes/content-models.ts:289,319` |
| **SEC-CM-03** | **MEDIUM** | Denial of Service | Uncapped `limit` parameter on public and admin collection listings allows excessive database queries and memory bloat. | `routes/content-models.ts:285` |
| **SEC-CM-04** | **LOW** | Database Constraint | Unique index on `(model_id, slug)` is not partial on `deleted_at IS NULL`, causing unique constraint failures on soft-deleted slugs. | `content-models.ts:107` |

---

## 13. Production Readiness Scorecard

| Area | Status | Evidence | Production Risk | Production Ready? |
| :--- | :---: | :--- | :---: | :---: |
| **Architecture** | PARTIAL | JSONB-backed schema & entry pattern | Medium | ❌ No |
| **Database Schemas** | PARTIAL | Tables created via migration 0019 | High (Missing `publication_id`) | ❌ No |
| **Model CRUD** | PARTIAL | Backend service complete; UI broken on update | Medium | ❌ No |
| **Field Validation** | **PASS** | 16 field types validated with bounds/regex | Low | ✅ **Yes** |
| **Entry CRUD** | PARTIAL | Create/Read/Delete work; UI Update broken (PATCH vs PUT) | High | ❌ No |
| **Publication Isolation** | **MISSING** | No `publication_id` column or tenant scoping | **CRITICAL** | ❌ No |
| **API Endpoints** | PARTIAL | Admin & Public routes exist; leaks private fields | High | ❌ No |
| **Admin UI** | PARTIAL | 4 components implemented; PATCH bug & array input bugs | High | ❌ No |
| **Liquid / Theme Integration** | **MISSING** | No Liquid objects, tags, or filters | **CRITICAL** | ❌ No |
| **Localization** | **MISSING** | `localizable` flag exists in type only | Medium | ❌ No |
| **Relations** | PARTIAL | Raw string IDs only; no resolution or pickers | Medium | ❌ No |
| **Media Library Integration** | PARTIAL | Raw string inputs; no picker or canonical resolution | Medium | ❌ No |
| **Schema Evolution** | **MISSING** | No migration engine for existing entries | Medium | ❌ No |
| **Test Coverage** | PARTIAL | 18 unit/api tests pass; 0 E2E edit/isolation tests | Medium | ❌ No |

---

## 14. Recommended Remediation Plan

If Vibress intends to promote Content Modeler to production readiness, the following phased remediation is required:

### Phase 1: Multi-Tenancy & Security Hardening (Mandatory)
1. **Migration 0029**: Add `publication_id text NOT NULL REFERENCES publications(id) ON DELETE cascade` to both `content_models` and `content_entries`.
2. Update unique indexes:
   - `content_models`: `UNIQUE ("publication_id", "slug")`
   - `content_entries`: `UNIQUE ("model_id", "slug") WHERE "deleted_at" IS NULL`
3. Update `ContentModelerService` to require and scope every query by `publicationId`.
4. Update `apps/api/src/routes/content-models.ts` to extract `publicationId` from session / active publication context.
5. Apply `filterEntryDataForVisibility()` in `publicContentModelRoutes` before sending responses to public clients.

### Phase 2: Frontend & API Contract Parity
1. Add `PATCH` handlers (or align Admin UI to `PUT`) for `/content-models/:id` and `/content-models/:slug/entries/:id`.
2. Implement specialized form inputs in `DynamicCollectionEntryEditor.tsx`:
   - Tag/pill input for `multi_select`, `taxonomy`, `relation_list`.
   - JSON editor or structured key-value editor for `json`.
   - Media Library modal trigger for `media` fields.
   - Searchable target entry dropdown for `relation` fields.

### Phase 3: Liquid & Theme Engine Integration
1. Extend `packages/theme-core` with a `CollectionsViewModel` provider.
2. Add Liquid tag `{% collection 'projects', limit: 6 as projects %}` or expose `collections.projects` global object.
3. Add public web dynamic router in `apps/web/src/app/collections/[modelSlug]/page.tsx`.

---

## 15. Final Audit Verdict

```
╔════════════════════════════════════════════════════════════════════════════╗
║                           FINAL AUDIT VERDICT                              ║
║                                                                            ║
║                     ARCHITECTURAL FOUNDATION ONLY                          ║
║                                                                            ║
║   • Data modeling domain & validation logic is functionally sound.         ║
║   • CRITICAL BLOCKER: Multi-tenant publication isolation is missing.       ║
║   • CRITICAL BLOCKER: Liquid / Theme runtime integration is absent.        ║
║   • HIGH BLOCKER: Public API data leakage (unfiltered private fields).     ║
║   • HIGH BLOCKER: Admin UI update failure due to HTTP method mismatch.     ║
╚════════════════════════════════════════════════════════════════════════════╝
```

---

**AUDIT HEAD**: `92b3a46072e4243ea1a2eab9936172894dba4f86`  
**AUDIT TYPE**: READ-ONLY — NO CODE CHANGES
