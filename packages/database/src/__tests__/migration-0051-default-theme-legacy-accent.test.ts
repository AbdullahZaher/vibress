import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

const migrationSql = fs.readFileSync(
  path.resolve(process.cwd(), "packages/database/migrations/0051_default_theme_legacy_accent.sql"),
  "utf8",
);

async function fixture(client: PoolClient, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE publications (id text PRIMARY KEY);
    CREATE TABLE settings (
      id text PRIMARY KEY,
      publication_id text NOT NULL REFERENCES publications(id),
      namespace text NOT NULL,
      key text NOT NULL,
      value jsonb,
      UNIQUE (publication_id, namespace, key)
    );
    CREATE TABLE theme_configurations (
      id text PRIMARY KEY,
      publication_id text NOT NULL REFERENCES publications(id) UNIQUE,
      theme_id text NOT NULL,
      theme_version text NOT NULL,
      settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      settings_schema_version integer NOT NULL DEFAULT 1,
      activated_by text,
      activated_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE TABLE theme_settings (
      id text PRIMARY KEY,
      publication_id text NOT NULL REFERENCES publications(id),
      theme_id text NOT NULL,
      settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE (publication_id, theme_id)
    );
    INSERT INTO publications(id) VALUES ('pub_a'), ('pub_b'), ('pub_c'), ('pub_d');
    INSERT INTO settings (id, publication_id, namespace, key, value)
      VALUES ('a-site', 'pub_a', 'site', 'accentColor', '"#0088cc"'),
             ('b-site', 'pub_b', 'site', 'accentColor', '"#778899"'),
             ('d-site', 'pub_d', 'site', 'accentColor', '"invalid"');
    INSERT INTO theme_configurations (id, publication_id, theme_id, theme_version, settings_json)
      VALUES
        ('a-active', 'pub_a', 'vibress-default', '1.0.0',
          '{"accentColor":"#f05230","contentWidth":1200}'::jsonb),
        ('b-active', 'pub_b', 'vibress-minimal', '1.0.0',
          '{"accentColor":"#112233","typography":"Serif"}'::jsonb),
        ('d-active', 'pub_d', 'vibress-default', '1.0.0',
          '{"accentColor":"#222222","colorScheme":"dark"}'::jsonb);
    INSERT INTO theme_settings (id, publication_id, theme_id, settings_json)
      VALUES
        ('a-editor', 'pub_a', 'vibress-default',
          '{"accentColor":"#ff0000","colorScheme":"dark"}'::jsonb),
        ('b-editor', 'pub_b', 'vibress-minimal',
          '{"accentColor":"#112233","typography":"Serif"}'::jsonb),
        ('a-inactive', 'pub_a', 'vibress-molten',
          '{"accentColor":"#ff0000","navigationLayout":"stacked"}'::jsonb);
  `);
}

describe("migration 0051 legacy Default theme accent", () => {
  it("preserves published colors, unrelated settings, inactive themes and publication isolation", async () => {
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
      expect(active.rows).toHaveLength(4);
      expect(active.rows[0]?.settings_json).toEqual({ accentColor: "#0088cc", contentWidth: 1200 });
      expect(active.rows[1]?.settings_json).toEqual({ accentColor: "#112233", typography: "Serif" });
      expect(active.rows[2]?.settings_json).toEqual({ accentColor: "#6366f1" });
      expect(active.rows[3]?.settings_json).toEqual({ accentColor: "#6366f1", colorScheme: "dark" });
      const saved = await client.query<{
        publication_id: string;
        theme_id: string;
        settings_json: Record<string, unknown>;
      }>("SELECT publication_id, theme_id, settings_json FROM theme_settings ORDER BY publication_id, theme_id");
      expect(saved.rows).toHaveLength(5);
      expect(saved.rows.find((r) => r.publication_id === "pub_a" && r.theme_id === "vibress-default")?.settings_json)
        .toEqual({ accentColor: "#0088cc", colorScheme: "dark" });
      expect(saved.rows.find((r) => r.publication_id === "pub_a" && r.theme_id === "vibress-molten")?.settings_json)
        .toEqual({ accentColor: "#ff0000", navigationLayout: "stacked" });
      expect(saved.rows.find((r) => r.publication_id === "pub_c" && r.theme_id === "vibress-default")?.settings_json)
        .toEqual({ accentColor: "#6366f1" });
      expect(saved.rows.find((r) => r.publication_id === "pub_b" && r.theme_id === "vibress-minimal")?.settings_json)
        .toEqual({ accentColor: "#112233", typography: "Serif" });
      const legacy = await client.query<{ value: string }>(
        "SELECT value FROM settings WHERE publication_id = 'pub_a' AND namespace = 'site' AND key = 'accentColor'",
      );
      expect(legacy.rows[0]?.value).toBe("#0088cc");
      await client.query("INSERT INTO publications(id) VALUES ('pub_fresh')");
      const fresh = await client.query(
        "SELECT id FROM theme_configurations WHERE publication_id = 'pub_fresh'",
      );
      expect(fresh.rows).toHaveLength(0);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
  });
});
