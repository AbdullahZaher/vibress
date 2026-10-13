import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "packages/database/migrations/0032_theme_legacy_installed_compat.sql",
  ),
  "utf8",
);

async function setup(client: PoolClient, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE publications (id text PRIMARY KEY);
    CREATE TABLE theme_configurations (
      id text PRIMARY KEY,
      publication_id text NOT NULL REFERENCES publications(id),
      theme_id text NOT NULL,
      theme_version text NOT NULL
    );
    CREATE TABLE installed_themes (
      id text PRIMARY KEY,
      publication_id text NOT NULL REFERENCES publications(id),
      theme_id text NOT NULL,
      name text NOT NULL,
      version text NOT NULL,
      theme_api_version integer NOT NULL DEFAULT 1,
      description text,
      author text,
      preview_image text,
      manifest_json jsonb NOT NULL,
      settings_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      storage_path text NOT NULL,
      status text NOT NULL DEFAULT 'installed',
      is_built_in boolean NOT NULL DEFAULT false,
      installed_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX installed_themes_pub_version_unique_idx
      ON installed_themes (publication_id, theme_id, version);

    INSERT INTO publications (id) VALUES
      ('pub_default'), ('pub_inherited'), ('pub_new'), ('pub_independent');
    INSERT INTO theme_configurations (id, publication_id, theme_id, theme_version)
    VALUES
      ('legacy_active', 'pub_default', 'editorial-pro', '1.0.0'),
      ('theme_config_' || md5('legacy_active:pub_inherited'),
       'pub_inherited', 'editorial-pro', '1.0.0'),
      ('newly_activated', 'pub_new', 'vibress-default', '1.0.0'),
      ('independent', 'pub_independent', 'other-theme', '1.0.0');

    INSERT INTO installed_themes
      (id, publication_id, theme_id, name, version, manifest_json, storage_path)
    VALUES
      ('src_a', 'pub_default', 'editorial-pro', 'Editorial Pro', '1.0.0',
       '{"id":"editorial-pro","version":"1.0.0"}', 'themes/editorial-pro/1.0.0'),
      ('src_b', 'pub_default', 'other-theme', 'Other Theme', '1.0.0',
       '{"id":"other-theme","version":"1.0.0"}', 'themes/other-theme/1.0.0'),
      ('already_installed', 'pub_inherited', 'other-theme', 'Local Version',
       '1.0.0', '{"id":"other-theme","version":"1.0.0"}',
       'themes/publications/pub_inherited/other-theme/1.0.0');
  `);
}

async function cleanup(client: PoolClient, schema: string): Promise<void> {
  await client.query("ROLLBACK");
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0032 legacy installed themes upgrade", () => {
  it("restores inherited themes without granting them to new publications", async () => {
    const client = await getDbPool().connect();
    const schema = `theme_legacy_${randomUUID().replaceAll("-", "")}`;

    try {
      await setup(client, schema);
      await client.query(migrationSql);

      const inherited = await client.query<{
        id: string;
        theme_id: string;
        name: string;
        storage_path: string;
        status: string;
      }>(`
        SELECT id, theme_id, name, storage_path, status
        FROM installed_themes
        WHERE publication_id = 'pub_inherited'
        ORDER BY theme_id
      `);

      expect(inherited.rows).toHaveLength(2);
      expect(inherited.rows[0]).toMatchObject({
        theme_id: "editorial-pro",
        storage_path: "themes/editorial-pro/1.0.0",
        status: "active",
      });
      expect(inherited.rows[1]).toMatchObject({
        id: "already_installed",
        theme_id: "other-theme",
        name: "Local Version",
        storage_path: "themes/publications/pub_inherited/other-theme/1.0.0",
      });

      const newlyCreated = await client.query(
        "SELECT id FROM installed_themes WHERE publication_id = 'pub_new'",
      );
      const independent = await client.query(
        "SELECT id FROM installed_themes WHERE publication_id = 'pub_independent'",
      );
      expect(newlyCreated.rows).toHaveLength(0);
      expect(independent.rows).toHaveLength(0);

      // The migration is additive and repeat-safe: it neither duplicates
      // inherited rows nor overwrites independently installed packages.
      await client.query(migrationSql);
      const inheritedAgain = await client.query(
        "SELECT id FROM installed_themes WHERE publication_id = 'pub_inherited'",
      );
      expect(inheritedAgain.rows).toHaveLength(2);
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });
});
