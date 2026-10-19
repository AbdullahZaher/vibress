import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const migration0040 = fs.readFileSync(path.resolve(
  process.cwd(), "packages/database/migrations/0040_plugin_publication_states.sql",
), "utf8");
const migration0041 = fs.readFileSync(path.resolve(
  process.cwd(), "packages/database/migrations/0041_plugin_publication_settings.sql",
), "utf8");

describe("migrations 0040-0041: safe external plugin publication isolation", () => {
  it("preserves legacy global rows, adds disabled-by-default publication states and constrains secrets", async () => {
    const client = await getDbPool().connect();
    const isolatedSchema = `plugin_ext_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${isolatedSchema}"`);
      await client.query(`SET search_path TO "${isolatedSchema}"`);
      await client.query(`
        CREATE TABLE publications (id text PRIMARY KEY);
        CREATE TABLE plugins (id text PRIMARY KEY, manifest_id text NOT NULL);
        CREATE TABLE plugin_settings (
          id text PRIMARY KEY,
          plugin_id text NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
          key text NOT NULL,
          encrypted_value text
        );
        INSERT INTO publications (id) VALUES ('pub-a'), ('pub-b');
        INSERT INTO plugins (id, manifest_id) VALUES ('plugin-a', 'trusted-external');
        INSERT INTO plugin_settings (id, plugin_id, key, encrypted_value)
          VALUES ('legacy', 'plugin-a', 'token', 'legacy-encrypted');
      `);
      await client.query(migration0040);
      await client.query(migration0041);

      // Existing global settings and plugin rows must not be moved, copied or erased.
      const legacy = await client.query<{ encrypted_value: string }>(
        "SELECT encrypted_value FROM plugin_settings WHERE id = 'legacy'",
      );
      expect(legacy.rows[0]?.encrypted_value).toBe("legacy-encrypted");
      const states = await client.query("SELECT plugin_id FROM plugin_publication_states");
      expect(states.rowCount).toBe(0);

      await client.query(`
        INSERT INTO plugin_publication_states (plugin_id, publication_id)
          VALUES ('plugin-a', 'pub-a'), ('plugin-a', 'pub-b');
      `);
      const defaultFlags = await client.query<{ enabled: boolean }>(
        "SELECT enabled FROM plugin_publication_states ORDER BY publication_id",
      );
      expect(defaultFlags.rows).toEqual([{ enabled: false }, { enabled: false }]);

      await client.query(`
        INSERT INTO plugin_publication_settings
          (id, plugin_id, publication_id, key, encrypted_value, is_secret)
        VALUES ('s-a', 'plugin-a', 'pub-a', 'apiToken', 'encrypted-for-a', true);
      `);
      const scopeA = await client.query<{ publication_id: string }>(
        "SELECT publication_id FROM plugin_publication_settings WHERE key = 'apiToken'",
      );
      expect(scopeA.rows).toEqual([{ publication_id: "pub-a" }]);

      await expect(client.query(`
        INSERT INTO plugin_publication_settings
          (id, plugin_id, publication_id, key, value, is_secret)
        VALUES ('invalid', 'plugin-a', 'pub-a', 'apiToken', 'plaintext', true);
      `)).rejects.toMatchObject({ code: "23514" });

      await expect(client.query(`
        INSERT INTO plugin_publication_settings
          (id, plugin_id, publication_id, key, value, is_secret)
        VALUES ('foreign', 'plugin-a', 'pub-missing', 'locale', 'ar', false);
      `)).rejects.toMatchObject({ code: "23503" });

      await expect(client.query(`
        INSERT INTO plugin_publication_settings
          (id, plugin_id, publication_id, key, encrypted_value, is_secret)
        VALUES ('duplicate', 'plugin-a', 'pub-a', 'apiToken', 'another-encrypted', true);
      `)).rejects.toMatchObject({ code: "23505" });

      await client.query(`
        INSERT INTO plugin_publication_settings
          (id, plugin_id, publication_id, key, value, is_secret)
        VALUES ('s-b', 'plugin-a', 'pub-b', 'locale', 'ar', false);
      `);

      // Deleting the owning publication must cascade its state AND scoped secrets.
      // Another publication and the legacy global plugin/settings remain intact.
      await client.query("DELETE FROM publications WHERE id='pub-a'");
      const removed = await client.query(
        "SELECT id FROM plugin_publication_settings WHERE publication_id='pub-a'",
      );
      expect(removed.rowCount).toBe(0);
      const pubB = await client.query<{ value: string }>(
        "SELECT value FROM plugin_publication_settings WHERE publication_id='pub-b'",
      );
      expect(pubB.rows).toEqual([{ value: "ar" }]);
      const pubBState = await client.query(
        "SELECT enabled FROM plugin_publication_states WHERE publication_id='pub-b'",
      );
      expect(pubBState.rowCount).toBe(1);
      const oldGlobal = await client.query("SELECT * FROM plugin_settings");
      expect(oldGlobal.rowCount).toBe(1);
      const installedPlugin = await client.query("SELECT id FROM plugins WHERE id = 'plugin-a'");
      expect(installedPlugin.rowCount).toBe(1);

      // Reapplying migration DDL is intentionally idempotent for retry/recovery.
      await client.query(migration0040);
      await client.query(migration0041);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE`);
      client.release();
    }
  });
});
