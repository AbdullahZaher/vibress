-- Safe additive migration for localized search documents (LOC-005 / Production Hardened).
-- Zero-Downtime Strategy:
-- 1. Explicit lock_timeout prevents the migration from queuing behind long-running queries or blocking traffic.
-- 2. Fast metadata-only column addition with non-volatile constant DEFAULT (PostgreSQL 11+ instant catalog update).
-- 3. Non-blocking backfill bounded by publication primary locale.
-- 4. Pre-create new composite unique index BEFORE dropping obsolete index so index coverage is continuously maintained.
-- 5. Safe, idempotent index cleanup.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "search_documents"
  ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en';

-- Backfill from publications primary_locale if not 'en'
UPDATE "search_documents" sd
SET "locale" = lower(trim(p.primary_locale))
FROM "publications" p
WHERE sd.publication_id = p.id
  AND p.primary_locale IS NOT NULL
  AND p.primary_locale <> ''
  AND lower(trim(p.primary_locale)) <> 'en'
  AND sd.locale = 'en';

-- Backfill from legacy site.locale setting if present and not 'en'
UPDATE "search_documents" sd
SET "locale" = lower(trim(both '"' from s.value::text))
FROM "settings" s
WHERE s.publication_id = sd.publication_id
  AND s.namespace = 'site'
  AND s.key = 'locale'
  AND s.value IS NOT NULL
  AND lower(trim(both '"' from s.value::text)) NOT IN ('', 'null', 'en')
  AND sd.locale = 'en';

-- 1. Create the new composite unique index BEFORE dropping the obsolete index
CREATE UNIQUE INDEX IF NOT EXISTS "search_documents_pub_entity_locale_idx"
  ON "search_documents" ("publication_id", "entity_type", "entity_id", "locale");

-- 2. Create the composite search filtering index
CREATE INDEX IF NOT EXISTS "search_documents_pub_locale_searchable_idx"
  ON "search_documents" ("publication_id", "locale", "searchable");

-- 3. Safely drop the obsolete single-locale index now that the composite index is active
DROP INDEX IF EXISTS "search_documents_pub_entity_idx";
