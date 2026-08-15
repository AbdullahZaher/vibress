CREATE TABLE IF NOT EXISTS "content_translations" (
	"id" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"content_id" text NOT NULL,
	"source_locale" text DEFAULT 'en' NOT NULL,
	"target_locale" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"excerpt" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"status" text DEFAULT 'untranslated' NOT NULL,
	"assigned_translator_id" text REFERENCES "users"("id") ON DELETE set null,
	"translation_due_date" timestamp with time zone,
	"source_version_at_translation" integer DEFAULT 1,
	"source_updated_at_translation" timestamp with time zone,
	"translated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_translations_content_target_idx" ON "content_translations" ("content_type","content_id","target_locale");
CREATE UNIQUE INDEX IF NOT EXISTS "content_translations_locale_slug_idx" ON "content_translations" ("target_locale","slug");
CREATE INDEX IF NOT EXISTS "content_translations_status_idx" ON "content_translations" ("status");
CREATE INDEX IF NOT EXISTS "content_translations_translator_idx" ON "content_translations" ("assigned_translator_id");

CREATE TABLE IF NOT EXISTS "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"automation_version" integer DEFAULT 1 NOT NULL,
	"trigger_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer DEFAULT 0,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "automation_runs_automation_idx" ON "automation_runs" ("automation_id");
CREATE INDEX IF NOT EXISTS "automation_runs_status_idx" ON "automation_runs" ("status");
CREATE INDEX IF NOT EXISTS "automation_runs_started_at_idx" ON "automation_runs" ("started_at");

CREATE TABLE IF NOT EXISTS "automation_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL REFERENCES "automation_runs"("id") ON DELETE cascade,
	"step_id" text NOT NULL,
	"step_name" text NOT NULL,
	"step_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "automation_run_steps_run_idx" ON "automation_run_steps" ("run_id");
CREATE INDEX IF NOT EXISTS "automation_run_steps_status_idx" ON "automation_run_steps" ("status");

CREATE TABLE IF NOT EXISTS "activitypub_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"activity_type" text NOT NULL,
	"object_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "activitypub_messages_actor_idx" ON "activitypub_messages" ("actor");
CREATE INDEX IF NOT EXISTS "activitypub_messages_status_idx" ON "activitypub_messages" ("status");
CREATE INDEX IF NOT EXISTS "activitypub_messages_type_idx" ON "activitypub_messages" ("type");

CREATE TABLE IF NOT EXISTS "activitypub_blocked_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text UNIQUE NOT NULL,
	"reason" text,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_by" text REFERENCES "users"("id") ON DELETE set null
);

CREATE TABLE IF NOT EXISTS "distribution_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"content_id" text NOT NULL,
	"content_type" text DEFAULT 'post' NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_message" text,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "distribution_campaigns_content_idx" ON "distribution_campaigns" ("content_id");
CREATE INDEX IF NOT EXISTS "distribution_campaigns_status_idx" ON "distribution_campaigns" ("status");

CREATE TABLE IF NOT EXISTS "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"domain" text,
	"primary_locale" text DEFAULT 'en' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "publications_workspace_slug_idx" ON "publications" ("workspace_id","slug");
CREATE INDEX IF NOT EXISTS "publications_domain_idx" ON "publications" ("domain");

CREATE TABLE IF NOT EXISTS "publication_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"publication_id" text NOT NULL REFERENCES "publications"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"role" text DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "pub_memberships_pub_user_idx" ON "publication_memberships" ("publication_id","user_id");

CREATE TABLE IF NOT EXISTS "user_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"credential_id" text UNIQUE NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb,
	"device_label" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_passkeys_user_cred_idx" ON "user_passkeys" ("user_id","credential_id");

CREATE TABLE IF NOT EXISTS "user_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"session_id" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"device_type" text DEFAULT 'desktop',
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_devices_user_session_idx" ON "user_devices" ("user_id","session_id");

CREATE TABLE IF NOT EXISTS "sso_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"issuer" text,
	"client_id" text,
	"client_secret" text,
	"authorization_url" text,
	"token_url" text,
	"user_info_url" text,
	"saml_metadata_xml" text,
	"domain_match" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "scim_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text UNIQUE NOT NULL,
	"scopes" jsonb DEFAULT '["users:read", "users:write"]'::jsonb,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "mfa_enforcements" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"enforce_for_all" boolean DEFAULT false NOT NULL,
	"enforce_for_roles" jsonb DEFAULT '["owner", "admin"]'::jsonb,
	"grace_period_days" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
