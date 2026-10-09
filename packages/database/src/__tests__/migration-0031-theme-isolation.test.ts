import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import type { PoolClient } from "pg";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "packages/database/migrations/0031_theme_publication_isolation.sql",
  ),
  "utf8",
);

const schemaName = () =>
  `ticket2_theme_${randomUUID().replaceAll("-", "")}`;

async function createLegacySchema(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE "publications" ("id" text PRIMARY KEY);
    CREATE TABLE "theme_configurations" (
      "id" text PRIMARY KEY,
      "theme_id" text NOT NULL,
      "theme_version" text NOT NULL,
      "settings_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "settings_schema_version" integer NOT NULL DEFAULT 1,
      "activated_by" text,
      "activated_at" timestamptz NOT NULL DEFAULT NOW(),
      "updated_at" timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE TABLE "theme_settings" (
      "id" text PRIMARY KEY,
      "theme_id" text NOT NULL,
      "settings_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "updated_at" timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX "theme_settings_theme_id_unique_idx"
      ON "theme_settings" ("theme_id");
    INSERT INTO "publications" ("id")
    VALUES ('pub_default'), ('pub_b');
    INSERT INTO "theme_configurations" (
      "id", "theme_id", "theme_version", "settings_json"
    ) VALUES (
      'active', 'vibress-default', '1.0.0',
      '{"accentColor":"#123456"}'::jsonb
    );
    INSERT INTO "theme_settings" ("id", "theme_id", "settings_json")
    VALUES ('settings_legacy', 'vibress-default',
      '{"headline":"Legacy headline"}'::jsonb);
  `);
}

async function dropTestSchema(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query("ROLLBACK");
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0031 theme publication isolation upgrade", () => {
  it("preserves legacy JSON in pub_default and allows independent publication themes", async () => {
    const client = await getDbPool().connect();
    const schema = schemaName();

    try {
      await createLegacySchema(client, schema);
      await client.query(migrationSql);

      const legacy = await client.query<{
        id: string;
        publication_id: string;
        theme_id: string;
        settings_json: { accentColor: string };
      }>(`
        SELECT "id", "publication_id", "theme_id", "settings_json"
        FROM "theme_configurations"
        WHERE "publication_id" = 'pub_default'
      `);
      expect(legacy.rows[0]).toMatchObject({
        id: "active",
        publication_id: "pub_default",
        theme_id: "vibress-default",
        settings_json: { accentColor: "#123456" },
      });

      const legacySettings = await client.query<{
        publication_id: string;
        theme_id: string;
        settings_json: { headline: string };
      }>(`
        SELECT "publication_id", "theme_id", "settings_json"
        FROM "theme_settings"
      `);
      expect(legacySettings.rows[0]).toMatchObject({
        publication_id: "pub_default",
        theme_id: "vibress-default",
        settings_json: { headline: "Legacy headline" },
      });

      await client.query(`
        INSERT INTO "theme_configurations" (
          "id", "publication_id", "theme_id", "theme_version"
        ) VALUES ('active_b', 'pub_b', 'vibress-minimal', '1.0.0');

        INSERT INTO "theme_settings" (
          "id", "publication_id", "theme_id", "settings_json"
        ) VALUES (
          'settings_b', 'pub_b', 'vibress-default',
          '{"headline":"Publication B"}'::jsonb
        );
      `);

      const configs = await client.query<{
        publication_id: string;
        theme_id: string;
      }>(`
        SELECT "publication_id", "theme_id"
        FROM "theme_configurations"
        ORDER BY "publication_id"
      `);
      expect(configs.rows).toEqual([
        { publication_id: "pub_b", theme_id: "vibress-minimal" },
        { publication_id: "pub_default", theme_id: "vibress-default" },
      ]);

      const settings = await client.query<{
        publication_id: string;
        headline: string;
      }>(`
        SELECT "publication_id", "settings_json"->>'headline' AS headline
        FROM "theme_settings"
        ORDER BY "publication_id"
      `);
      expect(settings.rows).toEqual([
        { publication_id: "pub_b", headline: "Publication B" },
        { publication_id: "pub_default", headline: "Legacy headline" },
      ]);

      await client.query(`DELETE FROM "publications" WHERE "id" = 'pub_b'`);
      const remaining = await client.query<{ publication_id: string }>(`
        SELECT "publication_id" FROM "theme_settings"
      `);
      expect(remaining.rows).toEqual([{ publication_id: "pub_default" }]);
    } finally {
      await dropTestSchema(client, schema);
      client.release();
    }
  });

  it("fails closed rather than silently selecting one of multiple legacy active rows", async () => {
    const client = await getDbPool().connect();
    const schema = schemaName();

    try {
      await createLegacySchema(client, schema);
      await client.query(`
        INSERT INTO "theme_configurations" (
          "id", "theme_id", "theme_version"
        ) VALUES ('legacy_conflict', 'vibress-minimal', '1.0.0')
      `);

      let error: Error | null = null;
      try {
        await client.query(migrationSql);
      } catch (caught: unknown) {
        error = caught instanceof Error ? caught : new Error(String(caught));
        await client.query("ROLLBACK");
      }
      expect(error?.message).toContain("multiple active theme configurations");

      const column = await client.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'theme_configurations'
          AND column_name = 'publication_id'
      `, [schema]);
      expect(column.rows).toHaveLength(0);
    } finally {
      await dropTestSchema(client, schema);
      client.release();
    }
  });
});
