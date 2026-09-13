-- Migration: 0025_staff_invitations_and_password_resets
-- Add user_invitations and password_reset_tokens tables for secure staff onboarding and password recovery.

CREATE TABLE IF NOT EXISTS "user_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"invited_by" text REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_invitations_token_hash_unique_idx" ON "user_invitations" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invitations_user_id_idx" ON "user_invitations" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invitations_email_idx" ON "user_invitations" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invitations_status_idx" ON "user_invitations" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_unique_idx" ON "password_reset_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx" ON "password_reset_tokens" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" ("expires_at");
