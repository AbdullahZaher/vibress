-- Safe additive migration for localized search documents (LOC-005 / Hardened).
-- Adds locale column with default 'en', safely backfills existing documents from
-- authoritative publication primary locale or legacy settings, drops old unique index,
-- and creates composite (publication_id, entity_type, entity_id, locale) unique index.

ALTER TABLE "search_documents"
  ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en';

-- Backfill from publications primary_locale if not 'en'
UPDATE "search_documents" sd
SET "locale" = p.primary_locale
FROM "publications" p
WHERE sd.publication_id = p.id
  AND p.primary_locale IS NOT NULL
  AND p.primary_locale <> ''
  AND p.primary_locale <> 'en'
  AND sd.locale = 'en';

-- Backfill from legacy site.locale setting if present and not 'en'
UPDATE "search_documents" sd
SET "locale" = trim(both '"' from s.value::text)
FROM "settings" s
WHERE s.publication_id = sd.publication_id
  AND s.namespace = 'site'
  AND s.key = 'locale'
  AND s.value IS NOT NULL
  AND trim(both '"' from s.value::text) NOT IN ('', 'null', 'en')
  AND sd.locale = 'en';

DROP INDEX IF EXISTS "search_documents_pub_entity_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "search_documents_pub_entity_locale_idx"
  ON "search_documents" ("publication_id", "entity_type", "entity_id", "locale");

CREATE INDEX IF NOT EXISTS "search_documents_pub_locale_searchable_idx"
  ON "search_documents" ("publication_id", "locale", "searchable");
