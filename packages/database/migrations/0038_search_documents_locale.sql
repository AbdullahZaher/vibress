-- Migration 0038: localized search index.
-- On populated installs the migration runner prepares the nullable column,
-- backfills only historic NULLs in batches, validates NOT NULL, and builds
-- both indexes CONCURRENTLY before Drizzle starts this transaction.
-- On fresh installs search_documents is empty; transactional index creation
-- here is safe. Do not use this SQL directly to upgrade a populated install.
-- NEVER UPDATE locale='en' here: it may be a legitimate English translation.
-- Replaying the SQL must preserve all existing locale values.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "search_documents"
  ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en';

ALTER TABLE "search_documents"
  ALTER COLUMN "locale" SET DEFAULT 'en';

ALTER TABLE "search_documents"
  ALTER COLUMN "locale" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "search_documents_pub_entity_locale_idx"
  ON "search_documents" ("publication_id", "entity_type", "entity_id", "locale");

CREATE INDEX IF NOT EXISTS "search_documents_pub_locale_searchable_idx"
  ON "search_documents" ("publication_id", "locale", "searchable");

-- Keep uniqueness continuously enforced through the index transition.
DROP INDEX IF EXISTS "search_documents_pub_entity_idx";
