import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function migration(name: string): string {
  const local = path.resolve(__dirname, "../../migrations", name);
  const file = fs.existsSync(local)
    ? local : path.resolve(process.cwd(), "packages/database/migrations", name);
  return fs.readFileSync(file, "utf8");
}

const sql0040 = migration("0040_plugin_publication_states.sql");
const sql0041 = migration("0041_plugin_publication_settings.sql");
const sql0042 = migration("0042_plugin_migration_storage_foundation.sql");

describe("0042 — append-only plugin catalog and forward migration ledger", () => {
  it.each(["populated upgrade", "fresh installation"])(
    "adds non-destructive storage catalog on %s",
    async (mode) => {
      const client = await getDbPool().connect();
      const isolated = `ext203a_${randomUUID().replaceAll("-", "")}`;
      try {
        await client.query(`CREATE SCHEMA "${isolated}"`);
        await client.query(`SET search_path TO "${isolated}"`);
        await client.query(`
          CREATE TABLE publications (id text PRIMARY KEY);
          CREATE TABLE plugins (id text PRIMARY KEY, manifest_id text UNIQUE NOT NULL);
          CREATE TABLE plugin_settings (
            id text PRIMARY KEY, plugin_id text REFERENCES plugins(id),
            encrypted_value text
          );
          INSERT INTO publications (id) VALUES ('pub-a'), ('pub-b');
          INSERT INTO plugins (id, manifest_id) VALUES
            ('plugin-a', 'approved-a'), ('plugin-b', 'approved-b');
        `);
        if (mode === "populated upgrade") {
          await client.query(`
            INSERT INTO plugin_settings (id, plugin_id, encrypted_value)
            VALUES ('legacy', 'plugin-a', 'encrypted-legacy');
          `);
        }
        await client.query(sql0040);
        await client.query(sql0041);
        await client.query(`
          INSERT INTO plugin_publication_states (plugin_id, publication_id, enabled)
          VALUES ('plugin-a', 'pub-a', false), ('plugin-a', 'pub-b', false);
        `);
        await client.query(sql0042);
        await client.query(sql0042); // idempotent DDL on repeat deployment

        expect((await client.query("SELECT * FROM plugin_schema_migrations")).rowCount).toBe(0);
        expect((await client.query("SELECT * FROM plugin_storage_models")).rowCount).toBe(0);
        expect((await client.query(
          "SELECT count(*)::int AS n FROM plugin_publication_states WHERE enabled = true",
        )).rows[0]?.n).toBe(0);

        if (mode === "populated upgrade") {
          expect((await client.query(
            "SELECT encrypted_value FROM plugin_settings WHERE id = 'legacy'",
          )).rows[0]?.encrypted_value).toBe("encrypted-legacy");
        }

        const digest = "a".repeat(64);
        await client.query(`
          INSERT INTO plugin_schema_migrations
            (plugin_id, migration_id, package_version, artifact_sha256, migration_sha256)
          VALUES ('plugin-a', '0001_create_courses', '1.0.0', $1, $1);
        `, [digest]);
        await client.query(`
          INSERT INTO plugin_storage_models
            (plugin_id, model_key, migration_id, schema_sha256)
          VALUES ('plugin-a', 'courses', '0001_create_courses', $1);
        `, [digest]);

        await expect(client.query(`
          INSERT INTO plugin_storage_models
            (plugin_id, model_key, migration_id, schema_sha256)
          VALUES ('plugin-b', 'courses', '0001_create_courses', $1);
        `, [digest])).rejects.toMatchObject({ code: "23503" });

        // Other plugin can reserve the same logical key in its own namespace.
        await client.query(`
          INSERT INTO plugin_schema_migrations
            (plugin_id, migration_id, package_version, artifact_sha256, migration_sha256)
          VALUES ('plugin-b', '0001_create_courses', '1.0.0', $1, $1);
          INSERT INTO plugin_storage_models
            (plugin_id, model_key, migration_id, schema_sha256)
          VALUES ('plugin-b', 'courses', '0001_create_courses', $1);
        `, [digest]);

        await expect(client.query(`
          UPDATE plugin_schema_migrations SET migration_sha256 = $1
            WHERE plugin_id='plugin-a';
        `, ["b".repeat(64)])).rejects.toMatchObject({ code: "23514" });
        await expect(client.query(`
          DELETE FROM plugin_storage_models WHERE plugin_id='plugin-a';
        `)).rejects.toMatchObject({ code: "23514" });
        await expect(client.query(`
          DELETE FROM plugins WHERE id='plugin-a';
        `)).rejects.toMatchObject({ code: "23503" });

        await expect(client.query(`
          INSERT INTO plugin_schema_migrations
            (plugin_id, migration_id, package_version, artifact_sha256, migration_sha256)
          VALUES ('plugin-a', 'bad-name', '1.0', $1, $1);
        `, [digest])).rejects.toMatchObject({ code: "23514" });
        await expect(client.query(`
          INSERT INTO plugin_storage_models
            (plugin_id, model_key, migration_id, schema_sha256)
          VALUES ('plugin-a', '../bad', '0001_create_courses', $1);
        `, [digest])).rejects.toMatchObject({ code: "23514" });

        // Deleting a publication cascades its *settings*, not plugin schema
        // ownership. Disable/reenable cannot erase a migration.
        await client.query("DELETE FROM publications WHERE id='pub-a'");
        expect((await client.query(
          "SELECT plugin_id FROM plugin_schema_migrations WHERE plugin_id='plugin-a'",
        )).rowCount).toBe(1);
        expect((await client.query(
          "SELECT model_key FROM plugin_storage_models WHERE plugin_id='plugin-b'",
        )).rows[0]?.model_key).toBe("courses");
      } finally {
        await client.query("RESET search_path");
        await client.query(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
        client.release();
      }
    },
  );
});
