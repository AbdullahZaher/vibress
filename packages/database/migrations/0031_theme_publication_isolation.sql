-- Migration 0031: isolate theme activation and saved settings by publication.
-- Existing theme state was global before this migration, so every publication could
-- observe the same active configuration and saved settings. Preserve that exact
-- pre-upgrade behavior by cloning legacy state to every existing publication, then
-- isolate all future reads and writes by publication.
ALTER TABLE "theme_configurations" ADD COLUMN "publication_id" text;
ALTER TABLE "theme_settings" ADD COLUMN "publication_id" text;

UPDATE "theme_configurations"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

UPDATE "theme_settings"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

-- Fail closed before cloning if the legacy global active state is ambiguous.
DO $
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
END $;

-- Remove the old global theme-settings uniqueness before cloning the previously
-- global rows into multiple publication-owned rows.
ALTER TABLE "theme_settings"
  DROP CONSTRAINT IF EXISTS "theme_settings_theme_id_unique";
DROP INDEX IF EXISTS "theme_settings_theme_id_unique_idx";

-- Preserve pre-upgrade global behavior for every existing publication.
-- Keep original row IDs for pub_default and generate deterministic clone IDs elsewhere.
INSERT INTO "theme_configurations" (
  "id",
  "publication_id",
  "theme_id",
  "theme_version",
  "settings_json",
  "settings_schema_version",
  "activated_by",
  "activated_at",
  "updated_at"
)
SELECT
  'theme_config_' || md5(tc."id" || ':' || p."id"),
  p."id",
  tc."theme_id",
  tc."theme_version",
  tc."settings_json",
  tc."settings_schema_version",
  tc."activated_by",
  tc."activated_at",
  tc."updated_at"
FROM "theme_configurations" tc
CROSS JOIN "publications" p
WHERE tc."publication_id" = 'pub_default'
  AND p."id" <> 'pub_default';

INSERT INTO "theme_settings" (
  "id",
  "publication_id",
  "theme_id",
  "settings_json",
  "updated_at"
)
SELECT
  'theme_setting_' || md5(ts."id" || ':' || p."id"),
  p."id",
  ts."theme_id",
  ts."settings_json",
  ts."updated_at"
FROM "theme_settings" ts
CROSS JOIN "publications" p
WHERE ts."publication_id" = 'pub_default'
  AND p."id" <> 'pub_default';


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

CREATE UNIQUE INDEX "theme_configurations_publication_unique_idx"
  ON "theme_configurations" ("publication_id");
CREATE UNIQUE INDEX "theme_settings_pub_theme_unique_idx"
  ON "theme_settings" ("publication_id", "theme_id");
