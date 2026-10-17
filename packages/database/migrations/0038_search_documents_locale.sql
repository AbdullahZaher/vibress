-- Safe additive migration for localized search documents (LOC-005).
-- Adds locale column with default 'en', drops old (publication_id, entity_type, entity_id) unique index,
-- and replaces it with (publication_id, entity_type, entity_id, locale) unique index.

ALTER TABLE "search_documents"
  ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en';

DROP INDEX IF EXISTS "search_documents_pub_entity_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "search_documents_pub_entity_locale_idx"
  ON "search_documents" ("publication_id", "entity_type", "entity_id", "locale");

CREATE INDEX IF NOT EXISTS "search_documents_pub_locale_searchable_idx"
  ON "search_documents" ("publication_id", "locale", "searchable");
