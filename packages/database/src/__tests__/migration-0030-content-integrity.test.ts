import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDbPool, runMigrations } from "../index";
import type { PoolClient } from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

describe("Migration 0030 content relationship publication integrity", () => {
  let client: PoolClient;
  const migrationsDir = path.resolve(__dirname, "../../migrations");
  const migrationSql = fs.readFileSync(
    path.join(
      migrationsDir,
      "0030_content_relationship_publication_integrity.sql",
    ),
    "utf8",
  );
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const userId = `m0030_user_${suffix}`;
  const invalidUserId = `m0030_invalid_user_${suffix}`;
  const publicationB = `m0030_pub_b_${suffix}`;
  const tagA = `m0030_tag_a_${suffix}`;
  const tagB = `m0030_tag_b_${suffix}`;
  const postA = `m0030_post_a_${suffix}`;
  const pageA = `m0030_page_a_${suffix}`;
  const invalidPost = `m0030_invalid_post_${suffix}`;
  const invitationId = `m0030_invite_${suffix}`;

  const applyMigration = async () => {
    await client.query(migrationSql);
  };

  const rollback0030Schema = async () => {
    await client.query(`
      ALTER TABLE "post_tags" DROP CONSTRAINT IF EXISTS "post_tags_post_publication_fk";
      ALTER TABLE "post_tags" DROP CONSTRAINT IF EXISTS "post_tags_tag_publication_fk";
      ALTER TABLE "post_authors" DROP CONSTRAINT IF EXISTS "post_authors_post_publication_fk";
      ALTER TABLE "post_authors" DROP CONSTRAINT IF EXISTS "post_authors_membership_fk";
      ALTER TABLE "page_authors" DROP CONSTRAINT IF EXISTS "page_authors_page_publication_fk";
      ALTER TABLE "page_authors" DROP CONSTRAINT IF EXISTS "page_authors_membership_fk";
      ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_primary_author_publication_fk";
      ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_primary_author_publication_fk";

      DROP INDEX IF EXISTS "post_tags_publication_id_idx";
      DROP INDEX IF EXISTS "post_authors_publication_id_idx";
      DROP INDEX IF EXISTS "post_authors_publication_user_idx";
      DROP INDEX IF EXISTS "page_authors_publication_id_idx";
      DROP INDEX IF EXISTS "page_authors_publication_user_idx";
      DROP INDEX IF EXISTS "posts_primary_author_publication_idx";
      DROP INDEX IF EXISTS "pages_primary_author_publication_idx";
      DROP INDEX IF EXISTS "user_invitations_publication_id_idx";

      ALTER TABLE "post_tags" DROP COLUMN IF EXISTS "publication_id";
      ALTER TABLE "post_authors" DROP COLUMN IF EXISTS "publication_id";
      ALTER TABLE "page_authors" DROP COLUMN IF EXISTS "publication_id";
      ALTER TABLE "user_invitations" DROP COLUMN IF EXISTS "publication_id";
      ALTER TABLE "user_invitations" DROP COLUMN IF EXISTS "publication_role";

      ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_id_publication_unique";
      ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_id_publication_unique";
      ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_id_publication_unique";
    `);
  };

  const cleanupFixtures = async () => {
    await client.query(`
      DELETE FROM "user_invitations" WHERE "id" = '${invitationId}';
      DELETE FROM "post_tags"
        WHERE "post_id" IN ('${postA}', '${invalidPost}');
      DELETE FROM "post_authors"
        WHERE "post_id" IN ('${postA}', '${invalidPost}');
      DELETE FROM "page_authors" WHERE "page_id" = '${pageA}';
      DELETE FROM "posts" WHERE "id" IN ('${postA}', '${invalidPost}');
      DELETE FROM "pages" WHERE "id" = '${pageA}';
      DELETE FROM "tags" WHERE "id" IN ('${tagA}', '${tagB}');
      DELETE FROM "publication_memberships"
        WHERE "user_id" IN ('${userId}', '${invalidUserId}');
      DELETE FROM "user_roles"
        WHERE "user_id" IN ('${userId}', '${invalidUserId}');
      DELETE FROM "users" WHERE "id" IN ('${userId}', '${invalidUserId}');
      DELETE FROM "roles" WHERE "id" = 'm0030_author_role';
      DELETE FROM "publications" WHERE "id" = '${publicationB}';
    `);
  };

  beforeAll(async () => {
    await runMigrations();
    client = await getDbPool().connect();
    await cleanupFixtures();
  }, 30_000);

  afterAll(async () => {
    try {
      await client.query("ROLLBACK");
      const columns = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'post_tags'
          AND column_name = 'publication_id'
      `);
      if (columns.rows.length === 0) {
        await cleanupFixtures();
        await applyMigration();
      } else {
        await cleanupFixtures();
      }
    } finally {
      client.release();
    }
  }, 30_000);

  it("backfills valid legacy relationships and invitation intent without data loss", async () => {
    await rollback0030Schema();

    await client.query(`
      INSERT INTO "roles" (
        "id", "key", "name", "is_system", "created_at", "updated_at"
      )
      VALUES (
        'm0030_author_role', 'author', 'Author', true, NOW(), NOW()
      )
      ON CONFLICT ("key") DO NOTHING;

      INSERT INTO "users" (
        "id", "email", "name", "password_hash", "status", "created_at", "updated_at"
      )
      VALUES (
        '${userId}',
        '${userId}@example.test',
        'Migration 0030 Author',
        'not-used',
        'active',
        NOW(),
        NOW()
      );

      INSERT INTO "user_roles" ("user_id", "role_id", "created_at")
      SELECT '${userId}', "id", NOW()
      FROM "roles"
      WHERE "key" = 'author'
      ON CONFLICT DO NOTHING;

      INSERT INTO "publications" (
        "id", "workspace_id", "name", "slug", "primary_locale", "created_at", "updated_at"
      )
      VALUES (
        '${publicationB}',
        'ws_default',
        'Migration 0030 B',
        '${publicationB}',
        'en',
        NOW(),
        NOW()
      );

      INSERT INTO "tags" (
        "id", "publication_id", "name", "slug", "created_at", "updated_at"
      )
      VALUES
        ('${tagA}', 'pub_default', 'Tag A', '${tagA}', NOW(), NOW()),
        ('${tagB}', '${publicationB}', 'Tag B', '${tagB}', NOW(), NOW());

      INSERT INTO "posts" (
        "id", "publication_id", "title", "slug", "content",
        "primary_author_id", "created_by", "updated_by", "created_at", "updated_at"
      )
      VALUES (
        '${postA}',
        'pub_default',
        'Legacy Post',
        '${postA}',
        '{"version":1,"root":{}}'::jsonb,
        '${userId}',
        '${userId}',
        '${userId}',
        NOW(),
        NOW()
      );

      INSERT INTO "pages" (
        "id", "publication_id", "title", "slug", "content",
        "primary_author_id", "created_by", "updated_by", "created_at", "updated_at"
      )
      VALUES (
        '${pageA}',
        'pub_default',
        'Legacy Page',
        '${pageA}',
        '{"version":1,"root":{}}'::jsonb,
        '${userId}',
        '${userId}',
        '${userId}',
        NOW(),
        NOW()
      );

      INSERT INTO "post_tags" ("post_id", "tag_id", "sort_order", "created_at")
      VALUES ('${postA}', '${tagA}', 0, NOW());

      INSERT INTO "post_authors" (
        "post_id", "user_id", "sort_order", "is_primary", "created_at"
      )
      VALUES ('${postA}', '${userId}', 0, true, NOW());

      INSERT INTO "page_authors" (
        "page_id", "user_id", "sort_order", "is_primary", "created_at"
      )
      VALUES ('${pageA}', '${userId}', 0, true, NOW());

      INSERT INTO "user_invitations" (
        "id", "user_id", "email", "token_hash", "status",
        "expires_at", "created_at", "updated_at"
      )
      VALUES (
        '${invitationId}',
        '${userId}',
        '${userId}@example.test',
        'm0030_token_${suffix}',
        'pending',
        NOW() + INTERVAL '1 day',
        NOW(),
        NOW()
      );
    `);

    await applyMigration();

    const relations = await client.query(`
      SELECT
        (SELECT "publication_id" FROM "post_tags"
          WHERE "post_id" = '${postA}' AND "tag_id" = '${tagA}') AS post_tag_pub,
        (SELECT "publication_id" FROM "post_authors"
          WHERE "post_id" = '${postA}' AND "user_id" = '${userId}') AS post_author_pub,
        (SELECT "publication_id" FROM "page_authors"
          WHERE "page_id" = '${pageA}' AND "user_id" = '${userId}') AS page_author_pub,
        (SELECT "publication_id" FROM "user_invitations"
          WHERE "id" = '${invitationId}') AS invitation_pub,
        (SELECT "publication_role" FROM "user_invitations"
          WHERE "id" = '${invitationId}') AS invitation_role
    `);

    expect(relations.rows[0]).toMatchObject({
      post_tag_pub: "pub_default",
      post_author_pub: "pub_default",
      page_author_pub: "pub_default",
      invitation_pub: "pub_default",
      invitation_role: "author",
    });

    const membership = await client.query(`
      SELECT "role"
      FROM "publication_memberships"
      WHERE "publication_id" = 'pub_default'
        AND "user_id" = '${userId}'
    `);
    expect(membership.rows[0]).toMatchObject({ role: "author" });

    await expect(
      client.query(`
        INSERT INTO "post_tags" (
          "publication_id", "post_id", "tag_id", "sort_order", "created_at"
        )
        VALUES ('pub_default', '${postA}', '${tagB}', 1, NOW())
      `)),
    ).rejects.toThrow();

    await cleanupFixtures();
  }, 30_000);

  it("fails closed on a legacy cross-publication post-tag relationship", async () => {
    await rollback0030Schema();

    await client.query(`
      INSERT INTO "users" (
        "id", "email", "name", "password_hash", "status", "created_at", "updated_at"
      )
      VALUES (
        '${invalidUserId}',
        '${invalidUserId}@example.test',
        'Migration 0030 Invalid Author',
        'not-used',
        'active',
        NOW(),
        NOW()
      );

      INSERT INTO "roles" (
        "id", "key", "name", "is_system", "created_at", "updated_at"
      )
      VALUES (
        'm0030_author_role', 'author', 'Author', true, NOW(), NOW()
      )
      ON CONFLICT ("key") DO NOTHING;

      INSERT INTO "user_roles" ("user_id", "role_id", "created_at")
      SELECT '${invalidUserId}', "id", NOW()
      FROM "roles"
      WHERE "key" = 'author'
      ON CONFLICT DO NOTHING;

      INSERT INTO "publications" (
        "id", "workspace_id", "name", "slug", "primary_locale", "created_at", "updated_at"
      )
      VALUES (
        '${publicationB}',
        'ws_default',
        'Migration 0030 Invalid B',
        '${publicationB}',
        'en',
        NOW(),
        NOW()
      );

      INSERT INTO "tags" (
        "id", "publication_id", "name", "slug", "created_at", "updated_at"
      )
      VALUES ('${tagB}', '${publicationB}', 'Invalid Tag B', '${tagB}', NOW(), NOW());

      INSERT INTO "posts" (
        "id", "publication_id", "title", "slug", "content",
        "primary_author_id", "created_by", "updated_by", "created_at", "updated_at"
      )
      VALUES (
        '${invalidPost}',
        'pub_default',
        'Invalid Legacy Post',
        '${invalidPost}',
        '{"version":1,"root":{}}'::jsonb,
        '${invalidUserId}',
        '${invalidUserId}',
        '${invalidUserId}',
        NOW(),
        NOW()
      );

      INSERT INTO "post_tags" ("post_id", "tag_id", "sort_order", "created_at")
      VALUES ('${invalidPost}', '${tagB}', 0, NOW());
    `);

    let migrationError: unknown;
    try {
      await applyMigration();
    } catch (err: unknown) {
      migrationError = err;
      await client.query("ROLLBACK");
    }
    expect(migrationError).toBeInstanceOf(Error);
    expect((migrationError as Error).message).toMatch(/another publication/i);

    await cleanupFixtures();
    await applyMigration();
  }, 30_000);
});
