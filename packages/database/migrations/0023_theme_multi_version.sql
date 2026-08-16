-- Migration: 0023_theme_multi_version
-- Support parallel installed versions (theme_id, version) and persistent per-theme settings

CREATE TABLE IF NOT EXISTS "theme_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"theme_id" text NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "theme_settings_theme_id_unique_idx" ON "theme_settings" ("theme_id");
--> statement-breakpoint
ALTER TABLE "installed_themes" DROP CONSTRAINT IF EXISTS "installed_themes_theme_id_key";
--> statement-breakpoint
ALTER TABLE "installed_themes" DROP CONSTRAINT IF EXISTS "installed_themes_theme_id_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "installed_themes_theme_id_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "installed_themes_theme_id_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "installed_themes_theme_id_version_unique_idx" ON "installed_themes" ("theme_id", "version");
