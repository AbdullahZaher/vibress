CREATE TABLE IF NOT EXISTS "editorial_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"block_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "editorial_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"original_text" text NOT NULL,
	"suggested_text" text NOT NULL,
	"block_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "editorial_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"assignee_id" text,
	"reviewer_ids" jsonb DEFAULT '[]'::jsonb,
	"due_date" timestamp with time zone,
	"editorial_notes" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_comments" ADD CONSTRAINT "editorial_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_comments" ADD CONSTRAINT "editorial_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_comments" ADD CONSTRAINT "editorial_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_suggestions" ADD CONSTRAINT "editorial_suggestions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_suggestions" ADD CONSTRAINT "editorial_suggestions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_suggestions" ADD CONSTRAINT "editorial_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_assignments" ADD CONSTRAINT "editorial_assignments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editorial_assignments" ADD CONSTRAINT "editorial_assignments_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_comments_post_idx" ON "editorial_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_comments_author_idx" ON "editorial_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_comments_status_idx" ON "editorial_comments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_suggestions_post_idx" ON "editorial_suggestions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_suggestions_author_idx" ON "editorial_suggestions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_suggestions_status_idx" ON "editorial_suggestions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "editorial_assignments_post_idx" ON "editorial_assignments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_assignments_assignee_idx" ON "editorial_assignments" USING btree ("assignee_id");
