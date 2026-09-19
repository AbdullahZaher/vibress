-- Migration: 0027_comments_hardened_publication_isolation.sql
-- Description: Harden Comments, Likes, Reports, and Moderation Events with Composite Publication Ownership

-- 1. Pre-Migration Verification: Check for orphaned comments or invalid relationships
DO $$
DECLARE
  orphan_count INT;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM "comments" c
  WHERE c."post_id" NOT IN (SELECT "id" FROM "posts");

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed: % orphan comments found with non-existent post_id', orphan_count;
  END IF;
END $$;

-- 2. Ensure parent tables have composite unique constraints for composite FK targets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_id_publication_unique'
  ) THEN
    ALTER TABLE "posts" ADD CONSTRAINT "posts_id_publication_unique" UNIQUE ("id", "publication_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'members_id_publication_unique'
  ) THEN
    ALTER TABLE "members" ADD CONSTRAINT "members_id_publication_unique" UNIQUE ("id", "publication_id");
  END IF;
END $$;

-- 3. Add publication_id and client_comment_id columns if not present
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "client_comment_id" text;
ALTER TABLE "comment_likes" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "comment_reports" ADD COLUMN IF NOT EXISTS "publication_id" text;

-- 4. Backfill publication_id from authoritative relations
UPDATE "comments" c
SET "publication_id" = p."publication_id"
FROM "posts" p
WHERE c."post_id" = p."id"
  AND c."publication_id" IS NULL;

UPDATE "comment_likes" cl
SET "publication_id" = c."publication_id"
FROM "comments" c
WHERE cl."comment_id" = c."id"
  AND cl."publication_id" IS NULL;

UPDATE "comment_reports" cr
SET "publication_id" = c."publication_id"
FROM "comments" c
WHERE cr."comment_id" = c."id"
  AND cr."publication_id" IS NULL;

-- 5. Assert that no NULL publication_id rows remain
DO $$
DECLARE
  null_comments INT;
  null_likes INT;
  null_reports INT;
BEGIN
  SELECT count(*) INTO null_comments FROM "comments" WHERE "publication_id" IS NULL;
  SELECT count(*) INTO null_likes FROM "comment_likes" WHERE "publication_id" IS NULL;
  SELECT count(*) INTO null_reports FROM "comment_reports" WHERE "publication_id" IS NULL;

  IF null_comments > 0 OR null_likes > 0 OR null_reports > 0 THEN
    RAISE EXCEPTION 'Backfill assertion failed: null comments=%, null likes=%, null reports=%', null_comments, null_likes, null_reports;
  END IF;
END $$;

-- 6. Enforce NOT NULL on publication_id
ALTER TABLE "comments" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "comment_likes" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "comment_reports" ALTER COLUMN "publication_id" SET NOT NULL;

-- 7. Add publication foreign keys to publications table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_publication_id_fk') THEN
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_publication_id_fk"
      FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_publication_id_fk') THEN
    ALTER TABLE "comment_likes"
      ADD CONSTRAINT "comment_likes_publication_id_fk"
      FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_reports_publication_id_fk') THEN
    ALTER TABLE "comment_reports"
      ADD CONSTRAINT "comment_reports_publication_id_fk"
      FOREIGN KEY ("publication_id") REFERENCES "publications"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

-- 8. Add composite unique constraint on comments(id, publication_id) for child composite FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_id_publication_unique') THEN
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_id_publication_unique"
      UNIQUE ("id", "publication_id");
  END IF;
END $$;

-- 9. Drop old single-column FKs to replace with composite FKs
DO $$
BEGIN
  ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_post_id_posts_id_fk";
  ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_member_id_members_id_fk";
  ALTER TABLE "comment_likes" DROP CONSTRAINT IF EXISTS "comment_likes_comment_id_comments_id_fk";
  ALTER TABLE "comment_likes" DROP CONSTRAINT IF EXISTS "comment_likes_member_id_members_id_fk";
  ALTER TABLE "comment_reports" DROP CONSTRAINT IF EXISTS "comment_reports_comment_id_comments_id_fk";
  ALTER TABLE "comment_reports" DROP CONSTRAINT IF EXISTS "comment_reports_reporter_id_members_id_fk";
END $$;

-- 10. Add composite foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_post_pub_fk') THEN
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_post_pub_fk"
      FOREIGN KEY ("post_id", "publication_id")
      REFERENCES "posts"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_member_pub_fk') THEN
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_member_pub_fk"
      FOREIGN KEY ("member_id", "publication_id")
      REFERENCES "members"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_parent_pub_fk') THEN
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_parent_pub_fk"
      FOREIGN KEY ("parent_id", "publication_id")
      REFERENCES "comments"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_comment_pub_fk') THEN
    ALTER TABLE "comment_likes"
      ADD CONSTRAINT "comment_likes_comment_pub_fk"
      FOREIGN KEY ("comment_id", "publication_id")
      REFERENCES "comments"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_member_pub_fk') THEN
    ALTER TABLE "comment_likes"
      ADD CONSTRAINT "comment_likes_member_pub_fk"
      FOREIGN KEY ("member_id", "publication_id")
      REFERENCES "members"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_reports_comment_pub_fk') THEN
    ALTER TABLE "comment_reports"
      ADD CONSTRAINT "comment_reports_comment_pub_fk"
      FOREIGN KEY ("comment_id", "publication_id")
      REFERENCES "comments"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_reports_reporter_pub_fk') THEN
    ALTER TABLE "comment_reports"
      ADD CONSTRAINT "comment_reports_reporter_pub_fk"
      FOREIGN KEY ("reporter_id", "publication_id")
      REFERENCES "members"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;
END $$;

-- 11. Create comment_moderation_events Table (Immutable Audit Log)
CREATE TABLE IF NOT EXISTS "comment_moderation_events" (
  "id" text PRIMARY KEY NOT NULL,
  "publication_id" text NOT NULL REFERENCES "publications"("id") ON DELETE CASCADE,
  "comment_id" text NOT NULL,
  "actor_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "reason" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "comment_mod_events_comment_pub_fk"
    FOREIGN KEY ("comment_id", "publication_id")
    REFERENCES "comments"("id", "publication_id")
    ON DELETE CASCADE
);

-- 12. Create indexes for performance, idempotency, and anti-abuse
CREATE UNIQUE INDEX IF NOT EXISTS "comments_pub_member_client_unique"
  ON "comments" ("publication_id", "member_id", "client_comment_id")
  WHERE "client_comment_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "comments_post_pub_status_created_idx"
  ON "comments" ("post_id", "publication_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "comments_member_pub_idx"
  ON "comments" ("member_id", "publication_id");

CREATE INDEX IF NOT EXISTS "comments_publication_id_idx"
  ON "comments" ("publication_id");

CREATE INDEX IF NOT EXISTS "comment_likes_comment_pub_idx"
  ON "comment_likes" ("comment_id", "publication_id");

CREATE INDEX IF NOT EXISTS "comment_reports_pub_status_idx"
  ON "comment_reports" ("publication_id", "status");

CREATE INDEX IF NOT EXISTS "comment_mod_events_comment_idx"
  ON "comment_moderation_events" ("comment_id", "created_at");

CREATE INDEX IF NOT EXISTS "comment_mod_events_pub_idx"
  ON "comment_moderation_events" ("publication_id", "created_at");

-- 13. Enforce database-level append-only immutability on comment_moderation_events
CREATE OR REPLACE FUNCTION prevent_comment_moderation_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'comment_moderation_events is an immutable audit log. UPDATE and DELETE operations are prohibited at database engine level.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_comment_moderation_events ON "comment_moderation_events";
CREATE TRIGGER trg_immutable_comment_moderation_events
BEFORE UPDATE OR DELETE ON "comment_moderation_events"
FOR EACH ROW
EXECUTE FUNCTION prevent_comment_moderation_events_mutation();
