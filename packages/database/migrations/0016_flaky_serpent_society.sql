CREATE TABLE "installation" (
	"id" text PRIMARY KEY NOT NULL,
	"installed" boolean DEFAULT false NOT NULL,
	"installed_at" timestamp with time zone,
	"installed_version" text,
	"installation_source" text DEFAULT 'fresh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "installation_installed_idx" ON "installation" USING btree ("installed");--> statement-breakpoint
-- The installation singleton MUST exist before any setup request can reach
-- the API, so setup transactions can safely SELECT ... FOR UPDATE a
-- guaranteed row. Fresh instances start uninstalled; the legacy backfill
-- (API boot) flips this to installed for pre-existing databases.
INSERT INTO "installation" ("id", "installed", "installation_source") VALUES ('singleton', false, 'fresh');
