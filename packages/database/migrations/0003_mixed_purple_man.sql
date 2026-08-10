CREATE TABLE "storage_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"endpoint" text,
	"region" text,
	"bucket" text,
	"public_base_url" text,
	"force_path_style" boolean DEFAULT false NOT NULL,
	"encrypted_credentials" text,
	"encryption_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"storage_configuration_id" text,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"declared_mime" text NOT NULL,
	"expected_size" integer NOT NULL,
	"asset_type" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"multipart_upload_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_configurations" ADD CONSTRAINT "storage_configurations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_storage_configuration_id_storage_configurations_id_fk" FOREIGN KEY ("storage_configuration_id") REFERENCES "public"."storage_configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_configurations_provider_type_idx" ON "storage_configurations" USING btree ("provider_type");--> statement-breakpoint
CREATE INDEX "storage_configurations_is_active_idx" ON "storage_configurations" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "upload_sessions_actor_id_idx" ON "upload_sessions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_storage_key_idx" ON "upload_sessions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "upload_sessions_state_idx" ON "upload_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "upload_sessions_expires_at_idx" ON "upload_sessions" USING btree ("expires_at");