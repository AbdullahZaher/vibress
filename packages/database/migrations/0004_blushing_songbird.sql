ALTER TABLE "users" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "meta_title" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "meta_description" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "canonical_url" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "meta_title" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "meta_description" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "canonical_url" text;--> statement-breakpoint
CREATE INDEX "users_slug_idx" ON "users" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_slug_unique" UNIQUE("slug");