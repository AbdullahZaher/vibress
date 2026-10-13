import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "packages/database/migrations/0033_publication_settings_isolation.sql",
  ),
  "utf8",
);

async function createLegacySchema(client: PoolClient, schema: string) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE publications (id text PRIMARY KEY);
    CREATE TABLE settings (
      id text PRIMARY KEY,
      namespace text NOT NULL,
      key text NOT NULL,
      value jsonb,
      value_type text NOT NULL DEFAULT 'string',
      classification text NOT NULL DEFAULT 'staff-visible',
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      created_at timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX settings_namespace_key_idx
      ON settings (namespace, key);
    CREATE INDEX settings_namespace_idx ON settings (namespace);
    INSERT INTO publications (id) VALUES ('pub_default'), ('pub_alpha');
    INSERT INTO settings
      (id, namespace, key, value, classification)
    VALUES
      ('site.title', 'site', 'title', '"Legacy Site"', 'public'),
      ('security.passwordHash', 'security', 'passwordHash',
       '"legacy-hash"', 'secret');
  `);
}

async function cleanup(client: PoolClient, schema: string) {
  await client.query("ROLLBACK");
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0033 publication settings isolation", () => {
  it("preserves legacy settings for every existing publication and isolates future writes", async () => {
    const client = await getDbPool().connect();
    const schema = `settings_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await createLegacySchema(client, schema);
      await client.query(migrationSql);

      const original = await client.query<{
        id: string;
        publication_id: string;
        value: string;
      }>(`
        SELECT id, publication_id, value FROM settings
        WHERE namespace = 'site' AND key = 'title'
        ORDER BY publication_id
      `);
      expect(original.rows).toEqual([
        { id: expect.stringMatching(/^pub_setting_/), publication_id: "pub_alpha", value: "Legacy Site" },
        { id: "site.title", publication_id: "pub_default", value: "Legacy Site" },
      ]);

      const hashes = await client.query<{ publication_id: string; value: string }>(
        "SELECT publication_id, value FROM settings WHERE namespace = 'security' AND key = 'passwordHash'",
      );
      expect(hashes.rows).toHaveLength(2);
      expect(hashes.rows.every((row) => row.value === "legacy-hash")).toBe(true);

      await client.query(`
        UPDATE settings SET value = '"Alpha Site"'
        WHERE publication_id = 'pub_alpha'
          AND namespace = 'site' AND key = 'title';
        INSERT INTO publications (id) VALUES ('pub_new');
      `);
      const results = await client.query<{ publication_id: string; value: string }>(`
        SELECT publication_id, value FROM settings
        WHERE namespace = 'site' AND key = 'title'
        ORDER BY publication_id
      `);
      expect(results.rows).toEqual([
        { publication_id: "pub_alpha", value: "Alpha Site" },
        { publication_id: "pub_default", value: "Legacy Site" },
      ]);

      await expect(
        client.query(`
          INSERT INTO settings (id, publication_id, namespace, key, value)
          VALUES ('duplicate', 'pub_alpha', 'site', 'title', '"bad"');
        `),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });

  it("cascades publication-owned settings without deleting other publications", async () => {
    const client = await getDbPool().connect();
    const schema = `settings_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await createLegacySchema(client, schema);
      await client.query(migrationSql);
      await client.query("DELETE FROM publications WHERE id = 'pub_alpha'");
      const records = await client.query<{ publication_id: string }>(
        "SELECT publication_id FROM settings",
      );
      expect(records.rows).toHaveLength(2);
      expect(records.rows.every((row) => row.publication_id === "pub_default")).toBe(true);
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });
});
