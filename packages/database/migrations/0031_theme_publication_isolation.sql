-- Migration 0031: publication-safe active theme and persistent theme settings.
-- Legacy global records belong to the original pub_default publication.
-- Do not duplicate global settings into unrelated publications or delete stored settings.
BEGIN;

ALTER TABLE "theme_configurations"
  ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "theme_settings"
  ADD COLUMN IF NOT EXISTS "publication_id" text;

UPDATE "theme_configurations"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

UPDATE "theme_settings"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

-- Historical code expected a single global active row. Do not silently choose
-- which configuration to preserve if historical data violates that assumption.
DO $$
DECLARE
  duplicate_publication text;
  duplicate_theme text;
BEGIN
  SELECT "publication_id" INTO duplicate_publication
  FROM "theme_configurations"
  GROUP BY "publication_id"
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_publication IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0031: multiple active theme configurations for publication %. Reconcile records before upgrading.',
      duplicate_publication;
  END IF;

  SELECT "publication_id" || ':' || "theme_id" INTO duplicate_theme
  FROM "theme_settings"
  GROUP BY "publication_id", "theme_id"
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_theme IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0031: duplicate theme settings for %. Reconcile records before upgrading.',
      duplicate_theme;
  END IF;
END $$;

ALTER TABLE "theme_configurations"
  ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "theme_settings"
  ALTER COLUMN "publication_id" SET NOT NULL;

ALTER TABLE "theme_configurations"
  ADD CONSTRAINT "theme_configurations_publication_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

ALTER TABLE "theme_settings"
  ADD CONSTRAINT "theme_settings_publication_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

-- Originally installed by migration 0023. A separate legacy Drizzle constraint
-- is handled as well for installations with an older schema shape.
ALTER TABLE "theme_settings"
  DROP CONSTRAINT IF EXISTS "theme_settings_theme_id_unique";
ALTER TABLE "theme_settings"
  DROP CONSTRAINT IF EXISTS "theme_settings_theme_id_key";
DROP INDEX IF EXISTS "theme_settings_theme_id_unique_idx";

CREATE UNIQUE INDEX "theme_configurations_publication_unique_idx"
  ON "theme_configurations" ("publication_id");

CREATE UNIQUE INDEX "theme_settings_publication_theme_unique_idx"
  ON "theme_settings" ("publication_id", "theme_id");

COMMIT;
