CREATE TABLE "theme_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"theme_id" text NOT NULL,
	"theme_version" text NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_schema_version" integer DEFAULT 1 NOT NULL,
	"activated_by" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "theme_configurations" ADD CONSTRAINT "theme_configurations_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theme_configurations_theme_id_idx" ON "theme_configurations" USING btree ("theme_id");