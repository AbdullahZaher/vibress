-- Migration 0031: isolate theme activation and saved settings by publication.
-- Existing global theme state belongs only to pub_default. Never copy private settings
-- to other publications or discard historical configuration rows.
ALTER TABLE "theme_configurations" ADD COLUMN "publication_id" text;
ALTER TABLE "theme_settings" ADD COLUMN "publication_id" text;

UPDATE "theme_configurations"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

UPDATE "theme_settings"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

DO $$
DECLARE
  duplicate_configurations integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_configurations
  FROM (
    SELECT "publication_id"
    FROM "theme_configurations"
    GROUP BY "publication_id"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_configurations > 0 THEN
    RAISE EXCEPTION
      'Theme isolation migration 0031: multiple legacy active theme configurations exist. Reconcile without deleting settings, then retry.';
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

-- The old global uniqueness constraint must be dropped before per-publication uniqueness.
ALTER TABLE "theme_settings"
  DROP CONSTRAINT IF EXISTS "theme_settings_theme_id_unique";
DROP INDEX IF EXISTS "theme_settings_theme_id_unique_idx";

CREATE UNIQUE INDEX "theme_configurations_publication_unique_idx"
  ON "theme_configurations" ("publication_id");
CREATE UNIQUE INDEX "theme_settings_pub_theme_unique_idx"
  ON "theme_settings" ("publication_id", "theme_id");
