CREATE TABLE IF NOT EXISTS "installed_themes" (
	"id" text PRIMARY KEY NOT NULL,
	"theme_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"theme_api_version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"author" text,
	"preview_image" text,
	"manifest_json" jsonb NOT NULL,
	"settings_schema_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'installed' NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "installed_themes_theme_id_idx" ON "installed_themes" ("theme_id");
CREATE INDEX IF NOT EXISTS "installed_themes_status_idx" ON "installed_themes" ("status");
