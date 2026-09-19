-- Migration: 0029_content_modeler_publication_isolation.sql
-- Description: Harden Content Modeler (content_models, content_entries) with Multi-Publication Tenant Isolation

BEGIN;

-- 1. Assert bootstrap invariants
DO $$
DECLARE
  v_pub_id text;
BEGIN
  SELECT id INTO v_pub_id FROM "publications" WHERE id = 'pub_default';
  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Bootstrap invariant failed: pub_default publication does not exist';
  END IF;
END $$;

-- 2. Add nullable publication_id columns
ALTER TABLE "content_models" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "content_entries" ADD COLUMN IF NOT EXISTS "publication_id" text;

-- 3. Deterministic backfill
-- Backfill models to pub_default if null
UPDATE "content_models"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

-- Backfill entries from their parent content_model
UPDATE "content_entries" ce
SET "publication_id" = cm."publication_id"
FROM "content_models" cm
WHERE ce."model_id" = cm."id"
  AND ce."publication_id" IS NULL;

-- Fallback backfill for any remaining entries
UPDATE "content_entries"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

-- 4. Assert zero NULL publication_id rows remain
DO $$
DECLARE
  v_null_models INT;
  v_null_entries INT;
BEGIN
  SELECT count(*) INTO v_null_models FROM "content_models" WHERE "publication_id" IS NULL;
  SELECT count(*) INTO v_null_entries FROM "content_entries" WHERE "publication_id" IS NULL;

  IF v_null_models > 0 OR v_null_entries > 0 THEN
    RAISE EXCEPTION 'Migration assertion failed: % null models, % null entries found', v_null_models, v_null_entries;
  END IF;
END $$;

-- 5. Enforce NOT NULL
ALTER TABLE "content_models" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "content_entries" ALTER COLUMN "publication_id" SET NOT NULL;

-- 6. Add Foreign Key to publications
DO $$ BEGIN
  ALTER TABLE "content_models" ADD CONSTRAINT "content_models_publication_id_publications_id_fk"
    FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_publication_id_publications_id_fk"
    FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 7. Add composite unique constraint on parent content_models(id, publication_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_models_id_publication_unique'
  ) THEN
    ALTER TABLE "content_models" ADD CONSTRAINT "content_models_id_publication_unique" UNIQUE ("id", "publication_id");
  END IF;
END $$;

-- 8. Add composite foreign key from content_entries(model_id, publication_id) to content_models(id, publication_id)
DO $$ BEGIN
  ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_model_publication_fk"
    FOREIGN KEY ("model_id", "publication_id") REFERENCES "public"."content_models"("id", "publication_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 9. Replace old global indexes with publication-scoped indexes
DROP INDEX IF EXISTS "content_models_slug_idx";
DROP INDEX IF EXISTS "content_entries_model_slug_idx";

CREATE INDEX IF NOT EXISTS "content_models_publication_id_idx" ON "content_models" USING btree ("publication_id");
CREATE UNIQUE INDEX IF NOT EXISTS "content_models_publication_slug_idx" ON "content_models" USING btree ("publication_id", "slug");

CREATE INDEX IF NOT EXISTS "content_entries_publication_id_idx" ON "content_entries" USING btree ("publication_id");
CREATE UNIQUE INDEX IF NOT EXISTS "content_entries_model_slug_active_idx" ON "content_entries" USING btree ("model_id", "slug") WHERE "deleted_at" IS NULL;

COMMIT;
