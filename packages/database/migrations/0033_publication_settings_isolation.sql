-- Migration 0033: isolate settings by authoritative publication ownership.
-- Before this migration all publications shared the same settings, including
-- site identity, public code, privacy settings, and integrations. Preserve the
-- configuration of existing publications without merging or deleting values.
-- Newly created publications have no copied settings and use schema defaults.
ALTER TABLE "settings" ADD COLUMN "publication_id" text;

UPDATE "settings"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "settings" WHERE "publication_id" IS NULL) THEN
    RAISE EXCEPTION 'Settings migration 0033: unresolved publication ownership';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "publications" WHERE "id" = 'pub_default') THEN
    RAISE EXCEPTION 'Settings migration 0033: pub_default is missing';
  END IF;
END $$;

-- Remove global uniqueness before materializing the formerly shared state.
DROP INDEX IF EXISTS "settings_namespace_key_idx";

INSERT INTO "settings" (
  "id", "publication_id", "namespace", "key", "value", "value_type",
  "classification", "updated_by", "updated_at", "created_at"
)
SELECT
  'pub_setting_' || md5(src."id" || ':' || p."id"),
  p."id",
  src."namespace",
  src."key",
  src."value",
  src."value_type",
  src."classification",
  src."updated_by",
  src."updated_at",
  src."created_at"
FROM "settings" AS src
CROSS JOIN "publications" AS p
WHERE src."publication_id" = 'pub_default'
  AND p."id" <> 'pub_default';

ALTER TABLE "settings"
  ALTER COLUMN "publication_id" SET NOT NULL;

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_publication_id_fk"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
  ON DELETE CASCADE;

CREATE UNIQUE INDEX "settings_publication_namespace_key_idx"
  ON "settings" ("publication_id", "namespace", "key");

