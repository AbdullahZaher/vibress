-- Migration: 0030_content_relationship_publication_integrity
-- Description: Enforce publication ownership for post tags/authors, page authors, and primary authors.
-- Upgrade policy:
--   * No content rows are deleted or reassigned.
--   * Existing implicit pub_default staff access is materialized as publication memberships.
--   * Relationship publication_id values are backfilled only from authoritative parent posts/pages.
--   * Genuine cross-publication or missing-author-membership data fails closed with actionable diagnostics.

BEGIN;

-- 1. Materialize access that the current authorization model already treats as valid.
-- 1a. Legacy/default publication fallback: users with an assigned global role can already
-- resolve pub_default without an explicit publication membership. Persist that existing
-- access so author FKs do not break upgrades. Disabled/soft-deleted historical authors
-- are included because membership rows do not bypass authentication/user-status checks.
INSERT INTO "publication_memberships" (
  "id",
  "publication_id",
  "user_id",
  "role",
  "created_at",
  "updated_at"
)
SELECT
  'pm_default_' || md5(u."id"),
  'pub_default',
  u."id",
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."role_id"
      WHERE ur."user_id" = u."id" AND r."key" = 'owner'
    ) THEN 'owner'
    WHEN EXISTS (
      SELECT 1 FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."role_id"
      WHERE ur."user_id" = u."id" AND r."key" = 'administrator'
    ) THEN 'admin'
    WHEN EXISTS (
      SELECT 1 FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."role_id"
      WHERE ur."user_id" = u."id" AND r."key" = 'author'
    ) THEN 'author'
    WHEN EXISTS (
      SELECT 1 FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."role_id"
      WHERE ur."user_id" = u."id" AND r."key" = 'contributor'
    ) THEN 'contributor'
    ELSE 'editor'
  END,
  NOW(),
  NOW()
FROM "users" u
WHERE EXISTS (
    SELECT 1
    FROM "user_roles" ur
    WHERE ur."user_id" = u."id"
  )
  AND EXISTS (
    SELECT 1 FROM "publications" p WHERE p."id" = 'pub_default'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "publication_memberships" pm
    WHERE pm."publication_id" = 'pub_default'
      AND pm."user_id" = u."id"
  );

-- 1b. Workspace owners/admins already have access to every publication in their
-- workspace. Materialize only that existing broad access; lower workspace roles
-- are intentionally not inferred across publications.
INSERT INTO "publication_memberships" (
  "id",
  "publication_id",
  "user_id",
  "role",
  "created_at",
  "updated_at"
)
SELECT
  'pm_ws_' || md5(p."id" || ':' || wm."user_id"),
  p."id",
  wm."user_id",
  CASE WHEN wm."role" = 'owner' THEN 'owner' ELSE 'admin' END,
  NOW(),
  NOW()
FROM "workspace_members" wm
JOIN "publications" p ON p."workspace_id" = wm."workspace_id"
WHERE wm."role" IN ('owner', 'admin')
  AND NOT EXISTS (
    SELECT 1
    FROM "publication_memberships" pm
    WHERE pm."publication_id" = p."id"
      AND pm."user_id" = wm."user_id"
  );

-- 1c. Persist publication intent on existing invitations. Legacy invitations
-- predate multi-publication targeting, so pub_default is the only deterministic
-- publication backfill. Unknown/custom global roles map to least-privilege contributor.
ALTER TABLE "user_invitations"
  ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "user_invitations"
  ADD COLUMN IF NOT EXISTS "publication_role" text;

UPDATE "user_invitations"
SET "publication_id" = 'pub_default'
WHERE "publication_id" IS NULL;

UPDATE "user_invitations" ui
SET "publication_role" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE ur."user_id" = ui."user_id" AND r."key" = 'owner'
  ) THEN 'owner'
  WHEN EXISTS (
    SELECT 1 FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE ur."user_id" = ui."user_id" AND r."key" = 'administrator'
  ) THEN 'admin'
  WHEN EXISTS (
    SELECT 1 FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE ur."user_id" = ui."user_id" AND r."key" = 'editor'
  ) THEN 'editor'
  WHEN EXISTS (
    SELECT 1 FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE ur."user_id" = ui."user_id" AND r."key" = 'author'
  ) THEN 'author'
  ELSE 'contributor'
END
WHERE ui."publication_role" IS NULL;

ALTER TABLE "user_invitations"
  ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "user_invitations"
  ALTER COLUMN "publication_role" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "user_invitations_publication_id_idx"
  ON "user_invitations" ("publication_id");

-- 2. Add publication_id to relationship tables as nullable for deterministic backfill.
ALTER TABLE "post_tags" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "post_authors" ADD COLUMN IF NOT EXISTS "publication_id" text;
ALTER TABLE "page_authors" ADD COLUMN IF NOT EXISTS "publication_id" text;

-- 3. Backfill only from authoritative parent content ownership.
UPDATE "post_tags" pt
SET "publication_id" = p."publication_id"
FROM "posts" p
WHERE pt."post_id" = p."id"
  AND pt."publication_id" IS NULL;

UPDATE "post_authors" pa
SET "publication_id" = p."publication_id"
FROM "posts" p
WHERE pa."post_id" = p."id"
  AND pa."publication_id" IS NULL;

UPDATE "page_authors" pa
SET "publication_id" = p."publication_id"
FROM "pages" p
WHERE pa."page_id" = p."id"
  AND pa."publication_id" IS NULL;

-- 4. Assert backfill completeness.
DO $$
DECLARE
  null_post_tags integer;
  null_post_authors integer;
  null_page_authors integer;
BEGIN
  SELECT count(*) INTO null_post_tags FROM "post_tags" WHERE "publication_id" IS NULL;
  SELECT count(*) INTO null_post_authors FROM "post_authors" WHERE "publication_id" IS NULL;
  SELECT count(*) INTO null_page_authors FROM "page_authors" WHERE "publication_id" IS NULL;

  IF null_post_tags > 0 OR null_post_authors > 0 OR null_page_authors > 0 THEN
    RAISE EXCEPTION
      'Ticket 1 backfill failed: post_tags null=%, post_authors null=%, page_authors null=%',
      null_post_tags, null_post_authors, null_page_authors;
  END IF;
END $$;

-- 5. Fail closed on historical cross-publication tag links.
DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM "post_tags" pt
  JOIN "posts" p ON p."id" = pt."post_id"
  JOIN "tags" t ON t."id" = pt."tag_id"
  WHERE p."publication_id" <> t."publication_id";

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Ticket 1 preflight failed: % post_tags rows link posts to tags from another publication. Correct those relationships before retrying migration 0030.',
      invalid_count;
  END IF;
END $$;

-- 6. Fail closed when historical authors do not belong to the content publication.
DO $$
DECLARE
  invalid_post_authors integer;
  invalid_page_authors integer;
  invalid_post_primary integer;
  invalid_page_primary integer;
BEGIN
  SELECT count(*) INTO invalid_post_authors
  FROM "post_authors" pa
  JOIN "posts" p ON p."id" = pa."post_id"
  LEFT JOIN "publication_memberships" pm
    ON pm."publication_id" = p."publication_id"
   AND pm."user_id" = pa."user_id"
  WHERE pm."user_id" IS NULL;

  SELECT count(*) INTO invalid_page_authors
  FROM "page_authors" pa
  JOIN "pages" p ON p."id" = pa."page_id"
  LEFT JOIN "publication_memberships" pm
    ON pm."publication_id" = p."publication_id"
   AND pm."user_id" = pa."user_id"
  WHERE pm."user_id" IS NULL;

  SELECT count(*) INTO invalid_post_primary
  FROM "posts" p
  LEFT JOIN "publication_memberships" pm
    ON pm."publication_id" = p."publication_id"
   AND pm."user_id" = p."primary_author_id"
  WHERE pm."user_id" IS NULL;

  SELECT count(*) INTO invalid_page_primary
  FROM "pages" p
  LEFT JOIN "publication_memberships" pm
    ON pm."publication_id" = p."publication_id"
   AND pm."user_id" = p."primary_author_id"
  WHERE pm."user_id" IS NULL;

  IF invalid_post_authors > 0
    OR invalid_page_authors > 0
    OR invalid_post_primary > 0
    OR invalid_page_primary > 0
  THEN
    RAISE EXCEPTION
      'Ticket 1 preflight failed: missing publication memberships (post_authors=%, page_authors=%, post primary authors=%, page primary authors=%). Add the correct publication_memberships rows or correct content ownership before retrying migration 0030.',
      invalid_post_authors, invalid_page_authors, invalid_post_primary, invalid_page_primary;
  END IF;
END $$;

-- 7. Composite uniqueness required by publication-aware foreign keys.
-- Run this only after historical data preflight succeeds so invalid upgrades fail
-- before building redundant composite indexes on potentially large content tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_id_publication_unique' AND conrelid = 'posts'::regclass) THEN
    ALTER TABLE "posts"
      ADD CONSTRAINT "posts_id_publication_unique" UNIQUE ("id", "publication_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_id_publication_unique' AND conrelid = 'pages'::regclass) THEN
    ALTER TABLE "pages"
      ADD CONSTRAINT "pages_id_publication_unique" UNIQUE ("id", "publication_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_id_publication_unique' AND conrelid = 'tags'::regclass) THEN
    ALTER TABLE "tags"
      ADD CONSTRAINT "tags_id_publication_unique" UNIQUE ("id", "publication_id");
  END IF;
END $$;

-- 8. Relationship publication ownership is now mandatory.
ALTER TABLE "post_tags" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "post_authors" ALTER COLUMN "publication_id" SET NOT NULL;
ALTER TABLE "page_authors" ALTER COLUMN "publication_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "post_tags_publication_id_idx"
  ON "post_tags" ("publication_id");
CREATE INDEX IF NOT EXISTS "post_authors_publication_id_idx"
  ON "post_authors" ("publication_id");
CREATE INDEX IF NOT EXISTS "post_authors_publication_user_idx"
  ON "post_authors" ("publication_id", "user_id");
CREATE INDEX IF NOT EXISTS "page_authors_publication_id_idx"
  ON "page_authors" ("publication_id");
CREATE INDEX IF NOT EXISTS "page_authors_publication_user_idx"
  ON "page_authors" ("publication_id", "user_id");
CREATE INDEX IF NOT EXISTS "posts_primary_author_publication_idx"
  ON "posts" ("publication_id", "primary_author_id");
CREATE INDEX IF NOT EXISTS "pages_primary_author_publication_idx"
  ON "pages" ("publication_id", "primary_author_id");

-- 9. Add publication-aware relationship and membership constraints.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_post_publication_fk' AND conrelid = 'post_tags'::regclass) THEN
    ALTER TABLE "post_tags"
      ADD CONSTRAINT "post_tags_post_publication_fk"
      FOREIGN KEY ("post_id", "publication_id")
      REFERENCES "posts"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tags_tag_publication_fk' AND conrelid = 'post_tags'::regclass) THEN
    ALTER TABLE "post_tags"
      ADD CONSTRAINT "post_tags_tag_publication_fk"
      FOREIGN KEY ("tag_id", "publication_id")
      REFERENCES "tags"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_authors_post_publication_fk' AND conrelid = 'post_authors'::regclass) THEN
    ALTER TABLE "post_authors"
      ADD CONSTRAINT "post_authors_post_publication_fk"
      FOREIGN KEY ("post_id", "publication_id")
      REFERENCES "posts"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_authors_membership_fk' AND conrelid = 'post_authors'::regclass) THEN
    ALTER TABLE "post_authors"
      ADD CONSTRAINT "post_authors_membership_fk"
      FOREIGN KEY ("publication_id", "user_id")
      REFERENCES "publication_memberships"("publication_id", "user_id")
      ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_authors_page_publication_fk' AND conrelid = 'page_authors'::regclass) THEN
    ALTER TABLE "page_authors"
      ADD CONSTRAINT "page_authors_page_publication_fk"
      FOREIGN KEY ("page_id", "publication_id")
      REFERENCES "pages"("id", "publication_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_authors_membership_fk' AND conrelid = 'page_authors'::regclass) THEN
    ALTER TABLE "page_authors"
      ADD CONSTRAINT "page_authors_membership_fk"
      FOREIGN KEY ("publication_id", "user_id")
      REFERENCES "publication_memberships"("publication_id", "user_id")
      ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_primary_author_publication_fk' AND conrelid = 'posts'::regclass) THEN
    ALTER TABLE "posts"
      ADD CONSTRAINT "posts_primary_author_publication_fk"
      FOREIGN KEY ("publication_id", "primary_author_id")
      REFERENCES "publication_memberships"("publication_id", "user_id")
      ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_primary_author_publication_fk' AND conrelid = 'pages'::regclass) THEN
    ALTER TABLE "pages"
      ADD CONSTRAINT "pages_primary_author_publication_fk"
      FOREIGN KEY ("publication_id", "primary_author_id")
      REFERENCES "publication_memberships"("publication_id", "user_id")
      ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

COMMIT;
