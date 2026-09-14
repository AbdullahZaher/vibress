-- Migration: 0026_multi_publication_tenant_isolation
-- Description: Multi-publication tenant isolation for all 14 publication-owned tables.
-- Transactional Safety: Entire migration executes within a single atomic transaction block.
-- Execution Order:
--   BEGIN
--   → bootstrap ws_default
--   → bootstrap pub_default
--   → add publication_id as nullable
--   → deterministic backfill
--   → verify zero NULL publication_id
--   → create required parent uniqueness for composite FKs
--   → add foreign keys
--   → replace global unique constraints
--   → create publication-scoped indexes
--   → enforce publication_id NOT NULL
--   → COMMIT

BEGIN;

-- 1. Bootstrap ws_default prerequisite
INSERT INTO "workspaces" ("id", "name", "slug", "created_at", "updated_at")
VALUES ('ws_default', 'Default Workspace', 'default', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 2. Bootstrap pub_default prerequisite
INSERT INTO "publications" ("id", "workspace_id", "name", "slug", "primary_locale", "created_at", "updated_at")
VALUES ('pub_default', 'ws_default', 'Default Publication', 'default', 'en', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 3. Add publication_id as nullable to all 14 publication-owned tables
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "newsletters" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "search_documents" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "content_translations" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "installed_themes" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "publication_id" text;

-- 4. Deterministic backfill with pub_default (zero deletions; all search_documents preserved)
UPDATE "posts" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "pages" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "tags" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "media_assets" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "members" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "products" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "plans" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "newsletters" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "search_documents" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "content_translations" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "automations" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "installed_themes" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "webhook_endpoints" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;
UPDATE "analytics_events" SET "publication_id" = 'pub_default' WHERE "publication_id" IS NULL;

-- 5. In-Transaction Assertion: Verify zero NULL publication_id across all 14 tables
DO $$
DECLARE
  null_count int;
  tbl text;
  tbls text[] := ARRAY[
    'posts', 'pages', 'tags', 'media_assets', 'members',
    'products', 'plans', 'newsletters', 'search_documents',
    'content_translations', 'automations', 'installed_themes',
    'webhook_endpoints', 'analytics_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE publication_id IS NULL', tbl) INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Backfill verification failed: table % has % rows with NULL publication_id', tbl, null_count;
    END IF;
  END LOOP;
END $$;

-- 6. Create required parent uniqueness for composite FKs (products -> plans)
ALTER TABLE "products"
  ADD CONSTRAINT "products_id_publication_unique"
  UNIQUE ("id", "publication_id");

-- 7. Add foreign keys to publications(id) and composite foreign keys
-- Financial & Subscriber entities: ON DELETE RESTRICT
ALTER TABLE "members"
  ADD CONSTRAINT "members_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE RESTRICT;

ALTER TABLE "products"
  ADD CONSTRAINT "products_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE RESTRICT;

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE RESTRICT;

-- Composite FK enforcing derived ownership at database level
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_product_publication_fk"
  FOREIGN KEY ("product_id", "publication_id")
  REFERENCES "products"("id", "publication_id")
  ON DELETE RESTRICT;

-- Operational, Editorial, & System entities: ON DELETE CASCADE
ALTER TABLE "posts"
  ADD CONSTRAINT "posts_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "pages"
  ADD CONSTRAINT "pages_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "tags"
  ADD CONSTRAINT "tags_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "newsletters"
  ADD CONSTRAINT "newsletters_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "search_documents"
  ADD CONSTRAINT "search_documents_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "content_translations"
  ADD CONSTRAINT "content_translations_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "automations"
  ADD CONSTRAINT "automations_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "installed_themes"
  ADD CONSTRAINT "installed_themes_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "analytics_events"
  ADD CONSTRAINT "analytics_events_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

-- 8. Replace global unique constraints
-- Posts
DROP INDEX IF EXISTS "posts_slug_unique";

-- Pages
DROP INDEX IF EXISTS "pages_slug_unique";

-- Tags
DROP INDEX IF EXISTS "tags_slug_unique";

-- Members (Model B: Publication-Scoped Member Identity)
ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "members_email_normalized_unique";
DROP INDEX IF EXISTS "members_email_normalized_unique";

-- Products
DROP INDEX IF EXISTS "products_key_unique";

-- Newsletters
DROP INDEX IF EXISTS "newsletters_key_unique";

-- Automations
DROP INDEX IF EXISTS "automations_key_unique";

-- Content Translations
DROP INDEX IF EXISTS "content_translations_locale_slug_idx";

-- Installed Themes
DROP INDEX IF EXISTS "installed_themes_theme_id_version_unique_idx";

-- Search Documents
DROP INDEX IF EXISTS "search_documents_entity_idx";

-- 9. Create publication-scoped indexes
-- Scoped Unique Indexes (Posts & Pages: partial on active rows)
CREATE UNIQUE INDEX IF NOT EXISTS "posts_publication_slug_active_idx"
  ON "posts" ("publication_id", "slug")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "pages_publication_slug_active_idx"
  ON "pages" ("publication_id", "slug")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "tags_publication_slug_unique"
  ON "tags" ("publication_id", "slug");

CREATE UNIQUE INDEX IF NOT EXISTS "members_publication_email_idx"
  ON "members" ("publication_id", "email_normalized");

CREATE UNIQUE INDEX IF NOT EXISTS "products_publication_key_unique"
  ON "products" ("publication_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "newsletters_publication_key_unique"
  ON "newsletters" ("publication_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "automations_publication_key_unique"
  ON "automations" ("publication_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "content_translations_pub_locale_slug_idx"
  ON "content_translations" ("publication_id", "target_locale", "slug");

CREATE UNIQUE INDEX IF NOT EXISTS "installed_themes_pub_version_unique_idx"
  ON "installed_themes" ("publication_id", "theme_id", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "search_documents_pub_entity_idx"
  ON "search_documents" ("publication_id", "entity_type", "entity_id");

-- Scoped Performance Indexes on publication_id
CREATE INDEX IF NOT EXISTS "posts_publication_id_idx" ON "posts" ("publication_id");
CREATE INDEX IF NOT EXISTS "pages_publication_id_idx" ON "pages" ("publication_id");
CREATE INDEX IF NOT EXISTS "tags_publication_id_idx" ON "tags" ("publication_id");
CREATE INDEX IF NOT EXISTS "media_assets_publication_id_idx" ON "media_assets" ("publication_id");
CREATE INDEX IF NOT EXISTS "members_publication_id_idx" ON "members" ("publication_id");
CREATE INDEX IF NOT EXISTS "products_publication_id_idx" ON "products" ("publication_id");
CREATE INDEX IF NOT EXISTS "plans_publication_id_idx" ON "plans" ("publication_id");
CREATE INDEX IF NOT EXISTS "newsletters_publication_id_idx" ON "newsletters" ("publication_id");
CREATE INDEX IF NOT EXISTS "webhook_endpoints_publication_id_idx" ON "webhook_endpoints" ("publication_id");
CREATE INDEX IF NOT EXISTS "search_documents_pub_searchable_idx" ON "search_documents" ("publication_id", "searchable");
CREATE INDEX IF NOT EXISTS "analytics_events_pub_occurred_idx" ON "analytics_events" ("publication_id", "occurred_at");

-- 10. Enforce publication_id NOT NULL on all 14 tables
ALTER TABLE "posts" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "pages" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "tags" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "media_assets" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "members" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "plans" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "newsletters" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "search_documents" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "content_translations" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "automations" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "installed_themes" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "webhook_endpoints" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "analytics_events" ALTER COLUMN "publication_id" SET NOT NULL;

COMMIT;
