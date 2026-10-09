import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "packages/database/migrations/0031_theme_publication_isolation.sql",
  ),
  "utf8",
);

async function createLegacyThemeSchema(client: PoolClient, schema: string) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE "publications" ("id" text PRIMARY KEY);
    INSERT INTO "publications" ("id") VALUES ('pub_default'), ('pub_b');

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
      "updated_at" timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT "theme_settings_theme_id_unique" UNIQUE ("theme_id")
    );
    CREATE UNIQUE INDEX "theme_settings_theme_id_unique_idx"
      ON "theme_settings" ("theme_id");

    INSERT INTO "theme_configurations"
      ("id", "theme_id", "theme_version", "settings_json")
    VALUES ('active', 'vibress-default', '1.0.0', '{"accentColor":"#123456"}');

    INSERT INTO "theme_settings" ("id", "theme_id", "settings_json")
    VALUES ('settings_1', 'vibress-default', '{"accentColor":"#654321"}');
  `);
}

async function cleanup(client: PoolClient, schema: string) {
  await client.query("ROLLBACK");
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0031 theme publication isolation upgrade", () => {
  it("preserves legacy global state for every existing publication, then isolates future writes", async () => {
    const client = await getDbPool().connect();
    const schema = `theme_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await createLegacyThemeSchema(client, schema);
      await client.query(migrationSql);

      const configuration = await client.query<{
        publication_id: string;
        theme_id: string;
        settings_json: { accentColor: string };
      }>('SELECT "publication_id", "theme_id", "settings_json" FROM "theme_configurations"');
      const settings = await client.query<{
        publication_id: string;
        settings_json: { accentColor: string };
      }>('SELECT "publication_id", "settings_json" FROM "theme_settings"');

      expect(configuration.rows).toHaveLength(2);
      expect(settings.rows).toHaveLength(2);

      expect(configuration.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publication_id: "pub_default",
            theme_id: "vibress-default",
            settings_json: { accentColor: "#123456" },
          }),
          expect.objectContaining({
            publication_id: "pub_b",
            theme_id: "vibress-default",
            settings_json: { accentColor: "#123456" },
          }),
        ]),
      );
      expect(settings.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publication_id: "pub_default",
            settings_json: { accentColor: "#654321" },
          }),
          expect.objectContaining({
            publication_id: "pub_b",
            settings_json: { accentColor: "#654321" },
          }),
        ]),
      );

      await client.query(
        'UPDATE "theme_settings" SET "settings_json" = $1::jsonb WHERE "publication_id" = $2',
        [JSON.stringify({ accentColor: "#abcdef" }), "pub_b"],
      );
      await client.query(
        'UPDATE "theme_configurations" SET "settings_json" = $1::jsonb WHERE "publication_id" = $2',
        [JSON.stringify({ accentColor: "#fedcba" }), "pub_b"],
      );

      const isolatedSettings = await client.query<{
        publication_id: string;
        settings_json: { accentColor: string };
      }>(
        'SELECT "publication_id", "settings_json" FROM "theme_settings" ORDER BY "publication_id"',
      );
      const isolatedConfigurations = await client.query<{
        publication_id: string;
        settings_json: { accentColor: string };
      }>(
        'SELECT "publication_id", "settings_json" FROM "theme_configurations" ORDER BY "publication_id"',
      );

      expect(
        isolatedSettings.rows.find((row) => row.publication_id === "pub_default")
          ?.settings_json.accentColor,
      ).toBe("#654321");
      expect(
        isolatedSettings.rows.find((row) => row.publication_id === "pub_b")
          ?.settings_json.accentColor,
      ).toBe("#abcdef");
      expect(
        isolatedConfigurations.rows.find(
          (row) => row.publication_id === "pub_default",
        )?.settings_json.accentColor,
      ).toBe("#123456");
      expect(
        isolatedConfigurations.rows.find((row) => row.publication_id === "pub_b")
          ?.settings_json.accentColor,
      ).toBe("#fedcba");
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });

  it("fails closed without deleting ambiguous legacy configurations", async () => {
    const client = await getDbPool().connect();
    const schema = `theme_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await createLegacyThemeSchema(client, schema);
      await client.query(`
        INSERT INTO "theme_configurations" ("id", "theme_id", "theme_version")
        VALUES ('legacy_second', 'vibress-minimal', '1.0.0')
      `);

      let migrationError: Error | null = null;
      try {
        await client.query(migrationSql);
      } catch (error: unknown) {
        migrationError = error instanceof Error ? error : new Error(String(error));
        await client.query("ROLLBACK");
      }

      expect(migrationError?.message).toContain(
        "multiple legacy active theme configurations exist",
      );
      const legacyRows = await client.query(
        'SELECT "id" FROM "theme_configurations" ORDER BY "id"',
      );
      expect(legacyRows.rows).toHaveLength(2);

      const publicationColumn = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = 'theme_configurations'
           AND column_name = 'publication_id'`,
        [schema],
      );
      expect(publicationColumn.rowCount).toBe(0);
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });
});
