Migration: 0026_multi_publication_tenant_isolation
Execution: YES
Database Gate: FAIL
Runtime Multi-Publication: NOT VERIFIED IN THIS STEP

# Migration 0026 — Post-Execution Safety Gate

**Date:** 2026-09-14  
**Status:** FAIL — MIGRATION 0026 EXECUTION/POST-GATE FAILURE  
**Target Migration:** `packages/database/migrations/0026_multi_publication_tenant_isolation.sql`  
**Target Verifier:** `packages/database/scripts/verify-migration-0026.ts`  
**Baseline Snapshot:** `packages/database/scripts/pre_migration_counts.json`  
**Git SHA:** `f1ddae28c139f205fdfb7a462915e0e114f8dec7`  
**PostgreSQL Version:** `PostgreSQL 16.15 on aarch64-unknown-linux-musl`  

---

## 1. Execution Summary

Sequence Step C was executed using the repository's canonical migration mechanism:
```bash
pnpm --filter @vibress/database run db:migrate
```
which runs `tsx src/migrate.ts` calling Drizzle's `migrate(db, { migrationsFolder })`.

The migration execution **failed with exit code 1** due to a PostgreSQL dependency constraint error when attempting to drop global unique indexes.

Because Migration 0026 was wrapped in a transactional block and executed inside Drizzle's session transaction, **the entire transaction rolled back cleanly and atomically**.

**In accordance with strict safety rules:**
* **No ad-hoc repair was attempted.**
* **No automatic re-run was performed.**
* **No baseline numbers were altered.**
* **The live database was inspected and verified to be in the exact, pristine pre-migration state.**

---

## 2. Immediate Execution Result

* **Migration command executed:** YES
* **Command exit status:** 1 (Failed)
* **Migration recorded in ledger (`drizzle.__drizzle_migrations`):** NO (Ledger remains at 26 applied migrations)
* **Did transaction COMMIT:** NO (Rolled back completely)
* **Execution Timestamp:** 2026-09-14 07:24:29 UTC

### 2.1 Exact Error Captured
```text
error: cannot drop index posts_slug_unique because constraint posts_slug_unique on table posts requires it
  length: 235,
  severity: 'ERROR',
  code: '2BP01',
  hint: 'You can drop constraint posts_slug_unique on table posts instead.',
  file: 'dependency.c',
  line: '843',
  routine: 'findDependentObjects'
```

### 2.2 Root Cause Analysis
In PostgreSQL, when a unique constraint is created via `UNIQUE` or Drizzle's `.unique()`, PostgreSQL creates a row in `pg_constraint` (constraint type `'u'`) and creates an underlying index in `pg_index` to enforce the constraint.

PostgreSQL enforces that an index required by a constraint cannot be dropped with `DROP INDEX <index_name>`. Instead, PostgreSQL requires dropping the constraint:
```sql
ALTER TABLE <table> DROP CONSTRAINT IF EXISTS <constraint_name>;
```

In `packages/database/migrations/0026_multi_publication_tenant_isolation.sql` Phase 8:
* `members` correctly included:
  ```sql
  ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "members_email_normalized_unique";
  DROP INDEX IF EXISTS "members_email_normalized_unique";
  ```
* However, `posts`, `pages`, `tags`, `products`, `newsletters`, and `automations` used only:
  ```sql
  DROP INDEX IF EXISTS "posts_slug_unique";
  DROP INDEX IF EXISTS "pages_slug_unique";
  DROP INDEX IF EXISTS "tags_slug_unique";
  DROP INDEX IF EXISTS "products_key_unique";
  DROP INDEX IF EXISTS "newsletters_key_unique";
  DROP INDEX IF EXISTS "automations_key_unique";
  ```
Because `posts_slug_unique` exists as a table constraint in `pg_constraint`, PostgreSQL threw error code `2BP01` (`dependent_objects_still_exist`), immediately halting execution and triggering an automatic transaction rollback.

---

## 3. Transaction Rollback Verification

Live read-only catalog and table queries were executed immediately following the failed command to determine the exact database state:

### 3.1 Bootstrap Entities
```sql
SELECT count(*)::int as c FROM workspaces WHERE id = 'ws_default';
-- Result: 0

SELECT count(*)::int as c FROM publications WHERE id = 'pub_default';
-- Result: 0
```
Neither `ws_default` nor `pub_default` was committed.

### 3.2 Schema Columns
```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE column_name = 'publication_id'
  AND table_name IN ('posts', 'pages', 'tags', 'media_assets', 'members', 'products', 'plans', 'newsletters', 'search_documents', 'content_translations', 'automations', 'installed_themes', 'webhook_endpoints', 'analytics_events');
-- Result: [] (0 rows)
```
Zero `publication_id` columns were committed to any of the 14 tables.

### 3.3 Migration Ledger
```sql
SELECT count(*)::int as c FROM drizzle.__drizzle_migrations;
-- Result: 26
```
Migration 0026 was **not** recorded as applied in `drizzle.__drizzle_migrations`.

---

## 4. Post-Rollback Data & Schema Integrity Audit

A comprehensive comparison was performed between the live database and the pre-migration baseline (`packages/database/scripts/pre_migration_counts.json`):

### 4.1 Row Count Preservation (Live vs Baseline)

| Table Name | Pre-Migration Baseline | Live Count Post-Rollback | Delta | Status |
| :--- | :---: | :---: | :---: | :---: |
| `posts` | 15 | 15 | 0 | **MATCH** |
| `pages` | 5 | 5 | 0 | **MATCH** |
| `tags` | 2 | 2 | 0 | **MATCH** |
| `media_assets` | 11 | 11 | 0 | **MATCH** |
| `members` | 13 | 13 | 0 | **MATCH** |
| `products` | 3 | 3 | 0 | **MATCH** |
| `plans` | 4 | 4 | 0 | **MATCH** |
| `newsletters` | 2 | 2 | 0 | **MATCH** |
| `search_documents` | 104 | 104 | 0 | **MATCH** |
| `content_translations` | 8 | 8 | 0 | **MATCH** |
| `automations` | 0 | 0 | 0 | **MATCH** |
| `installed_themes` | 2 | 2 | 0 | **MATCH** |
| `webhook_endpoints` | 68 | 68 | 0 | **MATCH** |
| `analytics_events` | 0 | 0 | 0 | **MATCH** |
| **Total Rows** | **237** | **237** | **0** | **100% PRESERVED** |

### 4.2 Media Storage Keys Preservation
All 11 media storage keys were queried and compared against the baseline:
* Pre-migration keys: 11
* Post-rollback live keys: 11
* Key parity check: **100% IDENTICAL MATCH**
* Object storage / MinIO: Completely untouched.

### 4.3 Unique Constraints & Indexes
All 21 unique constraints/indexes on the 10 target tables remain active in their pre-migration state:
```text
  automations.automations_key_unique
  automations.automations_pkey
  content_translations.content_translations_content_target_idx
  content_translations.content_translations_locale_slug_idx
  content_translations.content_translations_pkey
  installed_themes.installed_themes_pkey
  installed_themes.installed_themes_theme_id_version_unique_idx
  members.members_email_normalized_unique
  members.members_pkey
  newsletters.newsletters_key_unique
  newsletters.newsletters_pkey
  pages.pages_pkey
  pages.pages_slug_unique
  posts.posts_pkey
  posts.posts_slug_unique
  products.products_key_unique
  products.products_pkey
  search_documents.search_documents_entity_idx
  search_documents.search_documents_pkey
  tags.tags_pkey
  tags.tags_slug_unique
```

---

## 5. Safety Recovery Point (Pre-Migration Backup)

Prior to executing the migration, a full physical database backup was created and verified:
* **Filename:** `backups/vibress_pre_migration_0026_20260914_0724.sql`
* **Format:** Plain SQL text (`--clean --if-exists`)
* **Size:** 1,166,468 bytes (1.1 MB)
* **SHA-256:** `ea6f8b0ec4f810137c152f9ae8ab7400b4dbb89758b9a5073b1724dccdebf46e`
* **PostgreSQL version:** `PostgreSQL 16.15 on aarch64-unknown-linux-musl`
* **Timestamp:** `2026-09-14T07:24:22Z`
* **Status:** Verified valid. (Because transactional rollback succeeded completely, restoring from this recovery point was not necessary; the database is already identical to the backup).

---

## 6. Post-Execution Gate Scorecard

### Execution
* Migration executed: **YES**
* Migration committed: **NO (Transaction rolled back)**
* Migration ledger recorded: **NO**
* Git SHA: `f1ddae28c139f205fdfb7a462915e0e114f8dec7`
* Timestamp: `2026-09-14 07:24:29 UTC`

### Bootstrap
* `ws_default`: **FAIL (Rolled back)**
* `pub_default`: **FAIL (Rolled back)**

### Schema
* 14 `publication_id` columns: **FAIL (Rolled back)**
* 14 `NOT NULL` constraints: **FAIL (Rolled back)**
* 14 publication FKs: **FAIL (Rolled back)**
* Composite plans/products FK: **FAIL (Rolled back)**

### Data
* Baseline rows: **237**
* Post-migration rows: **237**
* Row preservation: **PASS (100% preserved)**
* NULL `publication_id`: **0 (Column does not exist)**
* Orphans: **0**

### Uniqueness
* Global indexes removed: **FAIL (Blocked by PostgreSQL constraint dependency)**
* Publication-scoped indexes: **FAIL (Rolled back)**
* Deleted-row predicates: **FAIL (Rolled back)**

### Search
* 104 rows preserved: **PASS**
* No cleanup performed: **PASS**

### Media
* 11 `storage_keys` preserved: **PASS**
* Object storage untouched: **PASS**

### Verification
* `verify-migration-0026.ts`: **FAIL (Schema not migrated)**
* Independent catalog verification: **PASS (Confirmed clean pre-migration rollback state)**

### Recovery
* Pre-migration backup: **PASS**
* Checksums verified: **PASS**

### Scope
* Runtime tenant isolation implemented: **NO**
* Runtime tenant isolation verified: **NO**
* Reason: outside Sequence Step C

---

## 7. Required Correction for Next Sequence

To allow Migration 0026 to complete successfully, Phase 8 of `packages/database/migrations/0026_multi_publication_tenant_isolation.sql` must drop the table constraints before (or in addition to) dropping the indexes:

```sql
-- 8. Replace global unique constraints
-- Posts
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_slug_unique";
DROP INDEX IF EXISTS "posts_slug_unique";

-- Pages
ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_slug_unique";
DROP INDEX IF EXISTS "pages_slug_unique";

-- Tags
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_slug_unique";
DROP INDEX IF EXISTS "tags_slug_unique";

-- Members (Model B: Publication-Scoped Member Identity)
ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "members_email_normalized_unique";
DROP INDEX IF EXISTS "members_email_normalized_unique";

-- Products
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_key_unique";
DROP INDEX IF EXISTS "products_key_unique";

-- Newsletters
ALTER TABLE "newsletters" DROP CONSTRAINT IF EXISTS "newsletters_key_unique";
DROP INDEX IF EXISTS "newsletters_key_unique";

-- Automations
ALTER TABLE "automations" DROP CONSTRAINT IF EXISTS "automations_key_unique";
DROP INDEX IF EXISTS "automations_key_unique";

-- Content Translations
DROP INDEX IF EXISTS "content_translations_locale_slug_idx";

-- Installed Themes
DROP INDEX IF EXISTS "installed_themes_theme_id_version_unique_idx";

-- Search Documents
DROP INDEX IF EXISTS "search_documents_entity_idx";
```

No code or SQL modifications were made during this step, adhering strictly to the STOP condition.

---

### Final Status

### FAIL — MIGRATION 0026 EXECUTION/POST-GATE FAILURE

Sequence Step C complete. Awaiting authorization for the next sequence.
