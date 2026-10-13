-- Migration 0032: restore pre-0031 visibility of legacy installed themes.
--
-- Before publication isolation, installed-theme lookups without a publication
-- read globally, although historical rows were owned by pub_default. Migration
-- 0031 copied the active configuration and saved settings to each pre-existing
-- publication, but omitted those installed-theme definitions. The resulting
-- active external theme could no longer resolve for those publications.
--
-- The deterministic configuration IDs inserted by 0031 identify publications
-- that inherited the old global state; do NOT copy legacy themes into newly
-- created publications, which have no such inheritance marker.
--
-- This migration copies only the inherited active external theme version's metadata. Legacy storage_path is deliberately
-- retained so existing files continue to load via the read-only compatibility
-- fallback until a publication installs its own scoped copy. Runtime writes to
-- a shared legacy path must remain blocked while any copies reference it.
INSERT INTO "installed_themes" (
  "id", "publication_id", "theme_id", "name", "version",
  "theme_api_version", "description", "author", "preview_image",
  "manifest_json", "settings_schema_json", "storage_path",
  "status", "is_built_in", "installed_at", "updated_at"
)
SELECT
  'legacy_theme_' || md5(src."id" || ':' || p."id"),
  p."id",
  src."theme_id",
  src."name",
  src."version",
  src."theme_api_version",
  src."description",
  src."author",
  src."preview_image",
  src."manifest_json",
  src."settings_schema_json",
  src."storage_path",
  CASE
    WHEN active."theme_id" = src."theme_id"
     AND active."theme_version" = src."version"
    THEN 'active'
    ELSE 'installed'
  END,
  src."is_built_in",
  src."installed_at",
  src."updated_at"
FROM "installed_themes" AS src
JOIN "theme_configurations" AS legacy
  ON legacy."publication_id" = 'pub_default'
JOIN "publications" AS p
  ON p."id" <> 'pub_default'
JOIN "theme_configurations" AS active
  ON active."publication_id" = p."id"
 AND active."id" = 'theme_config_' || md5(legacy."id" || ':' || p."id")
WHERE src."publication_id" = 'pub_default'
  -- Only restore the inherited publication's currently configured version.
  -- Global themes installed after 0031 must not be granted to other tenants.
  AND src."theme_id" = active."theme_id"
  AND src."version" = active."theme_version"
  -- An inherited configuration cannot authorize a package first installed
  -- after its activation. Reject ambiguous later default-publication uploads.
  AND src."installed_at" <= active."activated_at"
ON CONFLICT ("publication_id", "theme_id", "version") DO NOTHING;
