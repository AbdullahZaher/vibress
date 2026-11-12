import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

const migrationTag = "0051_default_theme_legacy_accent";
const migrationSql = fs.readFileSync(
  path.resolve(process.cwd(), `packages/database/migrations/${migrationTag}.sql`),
  "utf8",
);

/**
 * Reproduce the actual, migrated Drizzle table definitions (including indexes
 * and constraints) in an isolated PostgreSQL schema. No customer data or real
 * production schema is modified by these migration checks.
 */
async function fixture(client: PoolClient, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE publications (LIKE public.publications INCLUDING ALL);
    CREATE TABLE settings (LIKE public.settings INCLUDING ALL);
    CREATE TABLE theme_configurations (LIKE public.theme_configurations INCLUDING ALL);
    CREATE TABLE theme_settings (LIKE public.theme_settings INCLUDING ALL);
    ALTER TABLE settings
      ADD FOREIGN KEY (publication_id) REFERENCES publications(id);
    ALTER TABLE theme_configurations
      ADD FOREIGN KEY (publication_id) REFERENCES publications(id);
    ALTER TABLE theme_settings
      ADD FOREIGN KEY (publication_id) REFERENCES publications(id);

    INSERT INTO publications (id, workspace_id, name, slug) VALUES
      ('pub_a', 'ws_default', 'Alpha', 'alpha'),
      ('pub_b', 'ws_default', 'Beta', 'beta'),
      ('pub_c', 'ws_default', 'Gamma', 'gamma'),
      ('pub_d', 'ws_default', 'Delta', 'delta'),
      ('pub_e', 'ws_default', 'Epsilon', 'epsilon'),
      ('pub_f', 'ws_default', 'Zeta', 'zeta'),
      ('pub_g', 'ws_default', 'Eta', 'eta'),
      ('pub_h', 'ws_default', 'Theta', 'theta'),
      ('pub_i', 'ws_default', 'Iota', 'iota');

    INSERT INTO settings (id, publication_id, namespace, key, value)
      VALUES
        ('a-site', 'pub_a', 'site', 'accentColor', '"#0088cc"'),
        ('b-site', 'pub_b', 'site', 'accentColor', '"#778899"'),
        ('d-site', 'pub_d', 'site', 'accentColor', '"invalid"'),
        ('e-site', 'pub_e', 'site', 'accentColor', '"#990000"'),
        ('f-site', 'pub_f', 'site', 'accentColor', '"#123456"'),
        ('g-site', 'pub_g', 'site', 'accentColor', '"#abcdef"'),
        ('i-site', 'pub_i', 'site', 'accentColor', '"#ABC"'),
        ('a-logo', 'pub_a', 'site', 'logoUrl', '"/media/logo.png"');

    INSERT INTO theme_configurations (id, publication_id, theme_id, theme_version, settings_json)
      VALUES
        ('a-active', 'pub_a', 'vibress-default', '1.0.0',
         '{"accentColor":"#f05230","contentWidth":1200}'),
        ('b-active', 'pub_b', 'vibress-minimal', '1.0.0',
         '{"accentColor":"#112233","typography":"Serif"}'),
        ('d-active', 'pub_d', 'vibress-default', '1.0.0',
         '{"accentColor":"#222222","colorScheme":"Dark"}'),
        ('e-active', 'pub_e', 'vibress-molten', '1.0.0',
         '{"accentColor":"#050505","navigationLayout":"Stacked"}'),
        ('f-active', 'pub_f', 'external-editorial', '2.1.0',
         '{"accentColor":"#abcabc","specialSetting":"preserve"}'),
        ('h-active', 'pub_h', 'vibress-default', '1.0.0',
         '{"accentColor":"#c0ffee","footerText":"Unchanged"}'),
        ('i-active', 'pub_i', 'vibress-default', '1.0.0',
         '{"accentColor":"#123456","titleFont":"Elegant serif"}');

    INSERT INTO theme_settings (id, publication_id, theme_id, settings_json)
      VALUES
        ('a-editor', 'pub_a', 'vibress-default',
         '{"accentColor":"#ff0000","colorScheme":"Dark"}'),
        ('a-inactive', 'pub_a', 'vibress-molten',
         '{"accentColor":"#ff0000","navigationLayout":"Stacked"}'),
        ('b-editor', 'pub_b', 'vibress-minimal',
         '{"accentColor":"#112233","typography":"Serif"}'),
        ('b-inactive', 'pub_b', 'vibress-default',
         '{"accentColor":"#111111","footerText":"Inactive"}'),
        ('e-editor', 'pub_e', 'vibress-molten',
         '{"accentColor":"#050505","navigationLayout":"Stacked"}'),
        ('f-editor', 'pub_f', 'external-editorial',
         '{"accentColor":"#abcabc","specialSetting":"preserve"}'),
        ('h-editor', 'pub_h', 'vibress-default',
         '{"accentColor":"#000000","showAuthor":false}');
  `);
}

async function cleanup(client: PoolClient, schema: string): Promise<void> {
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0051 Default theme compatibility on real Drizzle tables", () => {
  it("is registered after 0050 for the standard migration runner", () => {
    const journal = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), "packages/database/migrations/meta/_journal.json"),
      "utf8",
    )) as { entries: Array<{ idx: number; tag: string }> };
    const position = journal.entries.findIndex((entry) => entry.tag === migrationTag);
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toMatchObject({ idx: 51, tag: migrationTag });
    expect(journal.entries[position - 1]?.tag).toBe(
      "0050_plugin_marketplace_publisher_revocations",
    );
  });

  it("preserves effective published colors without changing other themes or publications", async () => {
    const client = await getDbPool().connect();
    const schema = `default_accent_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await fixture(client, schema);
      await client.query(migrationSql);

      const active = await client.query<{
        publication_id: string;
        theme_id: string;
        settings_json: Record<string, unknown>;
      }>("SELECT publication_id, theme_id, settings_json FROM theme_configurations ORDER BY publication_id");
      expect(active.rows).toHaveLength(9);
      const configs = new Map(active.rows.map((row) => [row.publication_id, row]));
      expect(configs.get("pub_a")?.settings_json).toEqual({ accentColor: "#0088cc", contentWidth: 1200 });
      expect(configs.get("pub_b")?.settings_json).toEqual({ accentColor: "#112233", typography: "Serif" });
      expect(configs.get("pub_c")?.settings_json).toEqual({ accentColor: "#6366f1" });
      expect(configs.get("pub_d")?.settings_json).toEqual({ accentColor: "#6366f1", colorScheme: "Dark" });
      expect(configs.get("pub_e")?.settings_json).toEqual({ accentColor: "#050505", navigationLayout: "Stacked" });
      expect(configs.get("pub_f")?.settings_json).toEqual({ accentColor: "#abcabc", specialSetting: "preserve" });
      expect(configs.get("pub_g")?.settings_json).toEqual({ accentColor: "#abcdef" });
      expect(configs.get("pub_h")?.settings_json).toEqual({ accentColor: "#6366f1", footerText: "Unchanged" });
      expect(configs.get("pub_i")?.settings_json).toEqual({ accentColor: "#ABC", titleFont: "Elegant serif" });

      const saved = await client.query<{
        publication_id: string;
        theme_id: string;
        settings_json: Record<string, unknown>;
      }>("SELECT publication_id, theme_id, settings_json FROM theme_settings ORDER BY publication_id, theme_id");
      const setting = (publication: string, theme: string) =>
        saved.rows.find((row) => row.publication_id === publication && row.theme_id === theme)?.settings_json;
      expect(setting("pub_a", "vibress-default")).toEqual({ accentColor: "#0088cc", colorScheme: "Dark" });
      expect(setting("pub_a", "vibress-molten")).toEqual({ accentColor: "#ff0000", navigationLayout: "Stacked" });
      expect(setting("pub_b", "vibress-default")).toEqual({ accentColor: "#111111", footerText: "Inactive" });
      expect(setting("pub_b", "vibress-minimal")).toEqual({ accentColor: "#112233", typography: "Serif" });
      expect(setting("pub_f", "external-editorial")).toEqual({ accentColor: "#abcabc", specialSetting: "preserve" });
      expect(setting("pub_h", "vibress-default")).toEqual({ accentColor: "#6366f1", showAuthor: false });
      expect(setting("pub_g", "vibress-default")).toEqual({ accentColor: "#abcdef" });

      // Existing site identity values remain untouched for third-party contracts.
      const legacy = await client.query<{ key: string; value: string }>(
        "SELECT key, value FROM settings WHERE publication_id = 'pub_a' ORDER BY key",
      );
      expect(legacy.rows).toEqual([
        { key: "accentColor", value: "#0088cc" },
        { key: "logoUrl", value: "/media/logo.png" },
      ]);

      // Fresh publications created *after* the upgrade have no seeded theme
      // row and use the new schema default until the editor saves settings.
      await client.query(`
        INSERT INTO publications (id, workspace_id, name, slug)
        VALUES ('pub_new', 'ws_default', 'New', 'new');
      `);
      expect((await client.query(
        "SELECT id FROM theme_configurations WHERE publication_id = 'pub_new'",
      )).rows).toHaveLength(0);

      // Switching away and back must retrieve the saved Default settings;
      // the migration may not erase the inactive record on activation.
      await client.query(`
        UPDATE theme_configurations SET theme_id = 'vibress-minimal',
          settings_json = '{"accentColor":"#000000"}'
        WHERE publication_id = 'pub_a';
      `);
      expect(setting("pub_a", "vibress-default")).toEqual({ accentColor: "#0088cc", colorScheme: "Dark" });
      await client.query(`
        UPDATE theme_configurations SET theme_id = 'vibress-default',
          settings_json = (SELECT settings_json FROM theme_settings
            WHERE publication_id = 'pub_a' AND theme_id = 'vibress-default')
        WHERE publication_id = 'pub_a';
      `);
      const reactivated = await client.query<{ settings_json: Record<string, unknown> }>(
        "SELECT settings_json FROM theme_configurations WHERE publication_id = 'pub_a'",
      );
      expect(reactivated.rows[0]?.settings_json).toEqual({ accentColor: "#0088cc", colorScheme: "Dark" });

      // Unique publication constraints are real, not mocked.
      await expect(client.query(`
        INSERT INTO theme_configurations (id, publication_id, theme_id, theme_version)
        VALUES ('duplicate', 'pub_a', 'vibress-default', '1.0.0')
      `)).rejects.toMatchObject({ code: "23505" });
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });
});
