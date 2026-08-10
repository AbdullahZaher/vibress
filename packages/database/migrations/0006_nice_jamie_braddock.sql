CREATE TABLE "member_auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text DEFAULT 'authenticate' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "member_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_email_normalized_unique" UNIQUE("email_normalized")
);
--> statement-breakpoint
ALTER TABLE "member_auth_tokens" ADD CONSTRAINT "member_auth_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_auth_tokens_member_id_idx" ON "member_auth_tokens" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_auth_tokens_token_hash_idx" ON "member_auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "member_sessions_member_id_idx" ON "member_sessions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_sessions_token_hash_idx" ON "member_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "members_email_normalized_idx" ON "members" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");