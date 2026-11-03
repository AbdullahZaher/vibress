-- Migration 0051: preserve the published Default theme's effective accent on upgrade.
--
-- Before this release, Default used site.accentColor even when theme settings
-- contained a different accent. Convert that effective color to theme-owned
-- presentation settings. Keep the legacy publication setting and its public
-- API untouched; never change an inactive theme or another publication's data.
--
-- This migration is data-only, and runs once during the normal upgrade.
-- A missing/invalid site color displayed the legacy fallback (#6366f1).
-- Existing unrelated settings_json keys are retained in both theme tables.

UPDATE "theme_configurations" AS active
SET "settings_json" = jsonb_set(
  active."settings_json",
  '{accentColor}',
  to_jsonb(
    CASE
      WHEN (legacy."value" #>> '{}') ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
        THEN legacy."value" #>> '{}'
      ELSE '#6366f1'
    END
  ),
  true
),
"updated_at" = NOW()
FROM "publications" AS p
LEFT JOIN "settings" AS legacy
  ON legacy."publication_id" = p."id"
 AND legacy."namespace" = 'site'
 AND legacy."key" = 'accentColor'
WHERE active."publication_id" = p."id"
  AND active."theme_id" = 'vibress-default';

-- A publication without theme_configurations still rendered the built-in
-- Default theme. Pin its existing effective legacy color to avoid a visual
-- change when the Theme Studio schema default takes ownership.
INSERT INTO "theme_configurations" (
  "id", "publication_id", "theme_id", "theme_version",
  "settings_json", "settings_schema_version", "activated_by",
  "activated_at", "updated_at"
)
SELECT
  'legacy_default_accent_' || md5(p."id"),
  p."id",
  'vibress-default',
  '1.0.0',
  jsonb_build_object(
    'accentColor',
    CASE
      WHEN (legacy."value" #>> '{}') ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
        THEN legacy."value" #>> '{}'
      ELSE '#6366f1'
    END
  ),
  1,
  NULL,
  NOW(),
  NOW()
FROM "publications" AS p
LEFT JOIN "settings" AS legacy
  ON legacy."publication_id" = p."id"
 AND legacy."namespace" = 'site'
 AND legacy."key" = 'accentColor'
WHERE NOT EXISTS (
  SELECT 1 FROM "theme_configurations" AS active
  WHERE active."publication_id" = p."id"
);

-- Keep Theme Studio's editable state consistent with the now-published color.
-- Replace only accentColor on an existing Default settings row; preserve all
-- other explicit theme choices such as typography/contentWidth/colorScheme.
INSERT INTO "theme_settings" (
  "id", "publication_id", "theme_id", "settings_json", "updated_at"
)
SELECT
  'legacy_default_settings_' || md5(active."publication_id"),
  active."publication_id",
  'vibress-default',
  active."settings_json",
  NOW()
FROM "theme_configurations" AS active
WHERE active."theme_id" = 'vibress-default'
ON CONFLICT ("publication_id", "theme_id")
DO UPDATE SET
  "settings_json" = jsonb_set(
    "theme_settings"."settings_json",
    '{accentColor}',
    EXCLUDED."settings_json"->'accentColor',
    true
  ),
  "updated_at" = NOW();
