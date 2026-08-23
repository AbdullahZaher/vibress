-- Migration: 0024_multilingual_publications_translations
-- Add publication_locales table and extend content_translations schema for translation groups, providers, and review workflows.

CREATE TABLE IF NOT EXISTS "publication_locales" (
	"id" text PRIMARY KEY NOT NULL,
	"publication_id" text NOT NULL,
	"locale" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pub_locales_pub_locale_unique_idx" ON "publication_locales" ("publication_id", "locale");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pub_locales_publication_id_idx" ON "publication_locales" ("publication_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pub_locales_locale_idx" ON "publication_locales" ("locale");
--> statement-breakpoint
ALTER TABLE "content_translations" ADD COLUMN IF NOT EXISTS "translation_group_id" text;
--> statement-breakpoint
ALTER TABLE "content_translations" ADD COLUMN IF NOT EXISTS "translation_provider" text;
--> statement-breakpoint
ALTER TABLE "content_translations" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "content_translations" ADD COLUMN IF NOT EXISTS "reviewed_by" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_trans_group_id_idx" ON "content_translations" ("translation_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_trans_status_idx" ON "content_translations" ("status");
