# Migration 0026 — Corrective Static Gate

**Date:** 2026-09-14  
**Status:** COMPLETE (STATIC AUDIT ONLY — NO DATABASE MUTATION)  
**Target Migration:** `packages/database/migrations/0026_multi_publication_tenant_isolation.sql`  
**Target Verifier:** `packages/database/scripts/verify-migration-0026.ts`  
**Baseline Snapshot:** `packages/database/scripts/pre_migration_counts.json`  

---

## 1. Previous Failure

During the execution of Sequence Step C (`pnpm --filter @vibress/database run db:migrate`), Migration 0026 encountered an unhandled dependency error in PostgreSQL:

```text
error: cannot drop index posts_slug_unique because constraint posts_slug_unique on table posts requires it
  code: '2BP01'
  severity: 'ERROR'
  file: 'dependency.c'
  line: '843'
  routine: 'findDependentObjects'
  hint: 'You can drop constraint posts_slug_unique on table posts instead.'
```

Because the entire migration executes inside an atomic transaction block, PostgreSQL automatically rolled back all statements. The database returned completely to its pristine pre-migration state.

---

## 2. Root Cause Analysis

### PostgreSQL Unique Constraints vs Standalone Unique Indexes

In PostgreSQL, uniqueness can be declared in two fundamentally different ways:

1. **Table-Level UNIQUE Constraint:**  
   Created via `ALTER TABLE <table> ADD CONSTRAINT <name> UNIQUE (<columns>);` or within `CREATE TABLE` column/table definitions (e.g. Drizzle's `.unique()`).  
   PostgreSQL creates an entry in `pg_constraint` (with `contype = 'u'`) and automatically provisions an underlying unique index in `pg_class`/`pg_index` to enforce it.  
   **Invariant:** PostgreSQL forbids directly dropping this backing index via `DROP INDEX <name>`. It produces error `2BP01` (`dependent_objects_still_exist`) because the table constraint in `pg_constraint` depends on it. The only legal removal syntax is:
   ```sql
   ALTER TABLE "<table>" DROP CONSTRAINT IF EXISTS "<constraint_name>";
   ```
   Dropping the constraint automatically cleans up the underlying index.

2. **Standalone Unique Index:**  
   Created via `CREATE UNIQUE INDEX <name> ON <table> (<columns>);`.  
   There is **no** corresponding row in `pg_constraint` (`conname IS NULL`). The index lives solely in `pg_class`/`pg_index` (`indisunique = true`).  
   The correct removal syntax is:
   ```sql
   DROP INDEX IF EXISTS "<index_name>";
   ```

### Defect in Prior Migration 0026 Draft
In the previous draft of Phase 8:
* `members` was correctly written with `ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "members_email_normalized_unique";`.
* However, `posts`, `pages`, `tags`, `products`, `newsletters`, and `automations` were written with `DROP INDEX IF EXISTS ...;`. Because all six were actually table constraints in `pg_constraint`, PostgreSQL halted execution and threw error `2BP01`.

---

## 3. Catalog Dependency Analysis & Corrective Changes

A live read-only inspection of the PostgreSQL catalog (`pg_constraint`, `pg_index`, `pg_class`, `pg_attribute`) classified all 10 target uniqueness domains:

| Table | Target Object Name | Object Classification | Old Removal Method (Invalid) | Corrected Removal Method | Replacement Uniqueness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `posts` | `posts_slug_unique` | **A. Table Constraint** (`contype='u'`) | `DROP INDEX IF EXISTS "posts_slug_unique";` | `ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_slug_unique";` | `posts_publication_slug_active_idx` on `(publication_id, slug)` WHERE `deleted_at IS NULL` |
| `pages` | `pages_slug_unique` | **A. Table Constraint** (`contype='u'`) | `DROP INDEX IF EXISTS "pages_slug_unique";` | `ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_slug_unique";` | `pages_publication_slug_active_idx` on `(publication_id, slug)` WHERE `deleted_at IS NULL` |
| `tags` | `tags_slug_unique` | **A. Table Constraint** (`contype='u'`) | `DROP INDEX IF EXISTS "tags_slug_unique";` | `ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_slug_unique";` | `tags_publication_slug_unique` on `(publication_id, slug)` |
| `members` | `members_email_normalized_unique` | **A. Table Constraint** (`contype='u'`) | `ALTER TABLE ... DROP CONSTRAINT` + `DROP INDEX` | `ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "members_email_normalized_unique";` | `members_publication_email_idx` on `(publication_id, email_normalized)` |
| `products` | `products_key_unique` | **A. Table Constraint** (`contype='u'`) | `DROP INDEX IF EXISTS "products_key_unique";` | `ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_key_unique";` | `products_publication_key_unique` on `(publication_id, key)` |
| `newsletters` | `newsletters_key_unique` | **A. Table Constraint** (`contype='u'`) | `DROP INDEX IF EXISTS "newsletters_key_unique";` | `ALTER TABLE "newsletters" DROP CONSTRAINT IF EXISTS "newsletters_key_unique";` | `newsletters_publication_key_unique` on `(publication_id, key)` |
| `automations` | `automations_key_unique` | **A. Table Constraint** (`contype='u'`) | `DROP INDEX IF EXISTS "automations_key_unique";` | `ALTER TABLE "automations" DROP CONSTRAINT IF EXISTS "automations_key_unique";` | `automations_publication_key_unique` on `(publication_id, key)` |
| `content_translations` | `content_translations_locale_slug_idx` | **B. Standalone Unique Index** | `DROP INDEX IF EXISTS ...;` | `DROP INDEX IF EXISTS "content_translations_locale_slug_idx";` | `content_translations_pub_locale_slug_idx` on `(publication_id, target_locale, slug)` |
| `installed_themes` | `installed_themes_theme_id_version_unique_idx` | **B. Standalone Unique Index** | `DROP INDEX IF EXISTS ...;` | `DROP INDEX IF EXISTS "installed_themes_theme_id_version_unique_idx";` | `installed_themes_pub_version_unique_idx` on `(publication_id, theme_id, version)` |
| `search_documents` | `search_documents_entity_idx` | **B. Standalone Unique Index** | `DROP INDEX IF EXISTS ...;` | `DROP INDEX IF EXISTS "search_documents_entity_idx";` | `search_documents_pub_entity_idx` on `(publication_id, entity_type, entity_id)` |

### Non-Target Unrelated Constraints Preserved
* `content_translations_content_target_idx` on `(content_type, content_id, target_locale)` is **NOT** touched.
* All primary keys (`posts_pkey`, `pages_pkey`, etc.) are **NOT** touched.
* Foreign keys on referenced tables are **NOT** touched.

---

## 4. Current Database Safety Verification

Before making corrective file changes, read-only checks confirmed the live database state:
* **Migration 0026 is NOT applied:** `drizzle.__drizzle_migrations` has exactly 26 applied migrations.
* **Bootstrap entities absent:** `workspaces` has 0 rows for `ws_default`; `publications` has 0 rows for `pub_default`.
* **Zero schema pollution:** 0 of 14 target tables contain the `publication_id` column.
* **Row count baseline preserved:** All 14 tables match `packages/database/scripts/pre_migration_counts.json` at exactly **237 rows**.
* **Media assets preserved:** All 11 `storage_key` strings remain 100% identical.
* **Search documents preserved:** Exactly 104 rows intact.
* **Live database state:** Pristine pre-migration condition.

---

## 5. Migration Execution Order Verification

The SQL script `packages/database/migrations/0026_multi_publication_tenant_isolation.sql` maintains the strict 13-phase ordering:

1. `BEGIN;`
2. Bootstrap workspace `ws_default` (`ON CONFLICT ("id") DO NOTHING`)
3. Bootstrap publication `pub_default` (`ON CONFLICT ("id") DO NOTHING`)
4. In-transaction assertion validating bootstrap invariants (slugs, workspace_id, locale)
5. Add nullable `publication_id` to all 14 tables
6. Deterministic backfill to `pub_default`
7. In-transaction assertion: verify count of NULLs is exactly 0 across all 14 tables
8. Products composite uniqueness: `ADD CONSTRAINT "products_id_publication_unique" UNIQUE ("id", "publication_id")`
9. Foreign keys to `publications(id)` and composite FK `plans(product_id, publication_id) -> products(id, publication_id)`
10. Remove obsolete global uniqueness:
    - 7 table constraints dropped via `ALTER TABLE ... DROP CONSTRAINT IF EXISTS`
    - 3 standalone unique indexes dropped via `DROP INDEX IF EXISTS`
11. Create publication-scoped uniqueness & performance indexes
12. Enforce `publication_id NOT NULL` across all 14 tables
13. `COMMIT;`

---

## 6. Static Verification Results

1. **Verifier & Package Typecheck:**
   ```bash
   pnpm --filter @vibress/database exec tsc --noEmit
   # Result: Exit code 0 (Zero errors)
   ```
2. **ESLint Verification:**
   ```bash
   pnpm --filter @vibress/database run lint
   # Result: Exit code 0 (Zero warnings/errors)
   ```
3. **Replacement Index Name Collision Check:**
   Queried `pg_class` and `pg_constraint` for all proposed index and constraint names:
   ```text
   Collisions found with proposed names in live database: []
   ```
4. **Git Scope & Diff:**
   `git status --short` confirms modifications are restricted strictly to:
   * `packages/database/migrations/0026_multi_publication_tenant_isolation.sql`
   * `packages/database/scripts/verify-migration-0026.ts`
   * `docs/audits/MIGRATION_0026_CORRECTIVE_STATIC_GATE.md`

---

## 7. Final Verdict

### **SAFE TO RETRY**

> [!IMPORTANT]
> **STOP CONDITION OBSERVED:**  
> Migration 0026 was **NOT** executed or retried in this step. The live database remains in its unmodified pre-migration state. Awaiting explicit user authorization for a separate Sequence Step C retry.
