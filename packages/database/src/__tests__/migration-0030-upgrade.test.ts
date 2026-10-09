import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { PoolClient } from "pg";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "packages/database/migrations/0030_content_relationship_publication_integrity.sql",
  ),
  "utf8",
);

function schemaName(): string {
  return `ticket1_upgrade_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function createLegacySchema(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE "publications" (
      "id" text PRIMARY KEY,
      "workspace_id" text NOT NULL
    );

    CREATE TABLE "users" (
      "id" text PRIMARY KEY
    );

    CREATE TABLE "roles" (
      "id" text PRIMARY KEY,
      "key" text NOT NULL
    );

    CREATE TABLE "user_roles" (
      "user_id" text NOT NULL,
      "role_id" text NOT NULL
    );

    CREATE TABLE "workspace_members" (
      "workspace_id" text NOT NULL,
      "user_id" text NOT NULL,
      "role" text NOT NULL
    );

    CREATE TABLE "publication_memberships" (
      "id" text PRIMARY KEY,
      "publication_id" text NOT NULL,
      "user_id" text NOT NULL,
      "role" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT NOW(),
      "updated_at" timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE ("publication_id", "user_id")
    );

    CREATE TABLE "user_invitations" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL,
      "email" text NOT NULL,
      "token_hash" text NOT NULL UNIQUE,
      "status" text NOT NULL DEFAULT 'pending',
      "expires_at" timestamptz NOT NULL,
      "accepted_at" timestamptz,
      "invited_by" text,
      "created_at" timestamptz NOT NULL DEFAULT NOW(),
      "updated_at" timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE TABLE "posts" (
      "id" text PRIMARY KEY,
      "publication_id" text NOT NULL,
      "primary_author_id" text NOT NULL
    );

    CREATE TABLE "pages" (
      "id" text PRIMARY KEY,
      "publication_id" text NOT NULL,
      "primary_author_id" text NOT NULL
    );

    CREATE TABLE "tags" (
      "id" text PRIMARY KEY,
      "publication_id" text NOT NULL
    );

    CREATE TABLE "post_tags" (
      "post_id" text NOT NULL,
      "tag_id" text NOT NULL,
      PRIMARY KEY ("post_id", "tag_id")
    );

    CREATE TABLE "post_authors" (
      "post_id" text NOT NULL,
      "user_id" text NOT NULL,
      PRIMARY KEY ("post_id", "user_id")
    );

    CREATE TABLE "page_authors" (
      "page_id" text NOT NULL,
      "user_id" text NOT NULL,
      PRIMARY KEY ("page_id", "user_id")
    );
  `);
}

async function seedValidLegacyData(client: PoolClient): Promise<void> {
  await client.query(`
    INSERT INTO "publications" ("id", "workspace_id")
    VALUES
      ('pub_default', 'ws_a'),
      ('pub_a', 'ws_a'),
      ('pub_b', 'ws_a');

    INSERT INTO "users" ("id")
    VALUES ('user_a'), ('user_b');
    INSERT INTO "roles" ("id", "key")
    VALUES ('role_author', 'author');

    INSERT INTO "user_roles" ("user_id", "role_id")
    VALUES ('user_a', 'role_author');

    INSERT INTO "publication_memberships"
      ("id", "publication_id", "user_id", "role")
    VALUES
      ('pm_a', 'pub_a', 'user_a', 'author'),
      ('pm_b', 'pub_b', 'user_b', 'author');

    INSERT INTO "posts" ("id", "publication_id", "primary_author_id")
    VALUES ('post_a', 'pub_a', 'user_a');

    INSERT INTO "pages" ("id", "publication_id", "primary_author_id")
    VALUES ('page_a', 'pub_a', 'user_a');

    INSERT INTO "tags" ("id", "publication_id")
    VALUES ('tag_a', 'pub_a'), ('tag_b', 'pub_b');

    INSERT INTO "post_tags" ("post_id", "tag_id")
    VALUES ('post_a', 'tag_a');

    INSERT INTO "post_authors" ("post_id", "user_id")
    VALUES ('post_a', 'user_a');

    INSERT INTO "page_authors" ("page_id", "user_id")
    VALUES ('page_a', 'user_a');

    INSERT INTO "user_invitations" (
      "id", "user_id", "email", "token_hash", "status", "expires_at"
    )
    VALUES (
      'invite_a',
      'user_a',
      'user-a@example.test',
      'invite_token_hash_a',
      'pending',
      NOW() + INTERVAL '1 day'
    );
  `);
}

async function dropSchema(client: PoolClient, schema: string): Promise<void> {
  await client.query("ROLLBACK");
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0030 publication content integrity upgrade", () => {
  it("backfills valid legacy relationships and installs publication constraints", async () => {
    const client = await getDbPool().connect();
    const schema = schemaName();

    try {
      await createLegacySchema(client, schema);
      await seedValidLegacyData(client);
      await client.query(migrationSql);

      const postTags = await client.query<{
        publication_id: string;
      }>(`SELECT "publication_id" FROM "post_tags" WHERE "post_id" = 'post_a'`);
      const postAuthors = await client.query<{
        publication_id: string;
      }>(`SELECT "publication_id" FROM "post_authors" WHERE "post_id" = 'post_a'`);
      const pageAuthors = await client.query<{
        publication_id: string;
      }>(`SELECT "publication_id" FROM "page_authors" WHERE "page_id" = 'page_a'`);

      expect(postTags.rows[0]?.publication_id).toBe("pub_a");
      expect(postAuthors.rows[0]?.publication_id).toBe("pub_a");
      expect(pageAuthors.rows[0]?.publication_id).toBe("pub_a");
      const invitation = await client.query<{
        publication_id: string;
        publication_role: string;
      }>(`
        SELECT "publication_id", "publication_role"
        FROM "user_invitations"
        WHERE "id" = 'invite_a'
      `);
      const defaultMembership = await client.query<{ role: string }>(`
        SELECT "role"
        FROM "publication_memberships"
        WHERE "publication_id" = 'pub_default'
          AND "user_id" = 'user_a'
      `);

      expect(invitation.rows[0]).toMatchObject({
        publication_id: "pub_default",
        publication_role: "author",
      });
      expect(defaultMembership.rows[0]?.role).toBe("author");

      const deferredMembershipConstraints = await client.query<{
        conname: string;
        condeferrable: boolean;
        condeferred: boolean;
      }>(`
        SELECT conname, condeferrable, condeferred
        FROM pg_constraint
        WHERE conrelid IN (
          'post_authors'::regclass,
          'page_authors'::regclass,
          'posts'::regclass,
          'pages'::regclass
        )
          AND conname IN (
            'post_authors_membership_fk',
            'page_authors_membership_fk',
            'posts_primary_author_publication_fk',
            'pages_primary_author_publication_fk'
          )
        ORDER BY conname
      `);
      expect(deferredMembershipConstraints.rows).toHaveLength(4);
      expect(
        deferredMembershipConstraints.rows.every(
          (row) => row.condeferrable && row.condeferred,
        ),
      ).toBe(true);

      await expect(
        client.query(`
          INSERT INTO "post_tags" ("publication_id", "post_id", "tag_id")
          VALUES ('pub_a', 'post_a', 'tag_b')
        `),
      ).rejects.toThrow();
    } finally {
      await dropSchema(client, schema);
      client.release();
    }
  });

  it("fails closed and rolls back historical cross-publication tag links", async () => {
    const client = await getDbPool().connect();
    const schema = schemaName();

    try {
      await createLegacySchema(client, schema);
      await seedValidLegacyData(client);
      await client.query(
        `UPDATE "post_tags" SET "tag_id" = 'tag_b' WHERE "post_id" = 'post_a'`,
      );

      let migrationError: Error | null = null;
      try {
        await client.query(migrationSql);
      } catch (error: unknown) {
        migrationError =
          error instanceof Error ? error : new Error(String(error));
        await client.query("ROLLBACK");
      }

      expect(migrationError?.message).toContain(
        "post_tags rows link posts to tags from another publication",
      );

      const column = await client.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = '${schema}'
          AND table_name = 'post_tags'
          AND column_name = 'publication_id'
      `);
      expect(column.rowCount).toBe(0);
    } finally {
      await dropSchema(client, schema);
      client.release();
    }
  });

  it("fails closed and rolls back authors lacking publication membership", async () => {
    const client = await getDbPool().connect();
    const schema = schemaName();

    try {
      await createLegacySchema(client, schema);
      await seedValidLegacyData(client);
      await client.query(
        `UPDATE "posts" SET "primary_author_id" = 'user_b' WHERE "id" = 'post_a'`,
      );

      let migrationError: Error | null = null;
      try {
        await client.query(migrationSql);
      } catch (error: unknown) {
        migrationError =
          error instanceof Error ? error : new Error(String(error));
        await client.query("ROLLBACK");
      }

      expect(migrationError?.message).toContain(
        "missing publication memberships",
      );

      const column = await client.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = '${schema}'
          AND table_name = 'post_authors'
          AND column_name = 'publication_id'
      `);
      expect(column.rowCount).toBe(0);
    } finally {
      await dropSchema(client, schema);
      client.release();
    }
  });
});
