-- Migration: 0028_post_feature_image
-- Description: Adds feature_image_id, feature_image_alt, and feature_image_caption to posts table
-- Enforces publication isolation via composite foreign key (feature_image_id, publication_id) -> media_assets(id, publication_id)

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_id_publication_unique" UNIQUE ("id", "publication_id");

ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feature_image_id" text;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feature_image_alt" text;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feature_image_caption" text;

CREATE INDEX IF NOT EXISTS "posts_feature_image_id_idx" ON "posts" ("feature_image_id");

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_feature_image_publication_fk"
  FOREIGN KEY ("feature_image_id", "publication_id")
  REFERENCES "media_assets"("id", "publication_id")
  ON DELETE SET NULL ("feature_image_id");
