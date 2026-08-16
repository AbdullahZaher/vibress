import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../index";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

describe("Database Migration 0022 -> 0023 Canonical Upgrade Verification", () => {
  const migrationsDir = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const db = getDb();
    // Clean up tables to test migration sequence from clean state
    await db.execute(sql`DROP TABLE IF EXISTS "theme_settings" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "installed_themes" CASCADE`);
  });

  afterAll(async () => {
    // Re-apply final schema state cleanly
    const sql0023 = fs.readFileSync(path.join(migrationsDir, "0023_theme_multi_version.sql"), "utf-8");
    const statements = sql0023.split("--> statement-breakpoint");
    const db = getDb();
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await db.execute(sql.raw(trimmed));
      }
    }
  });

  it("applies 0022_external_themes.sql schema cleanly", async () => {
    const db = getDb();
    const sql0022 = fs.readFileSync(path.join(migrationsDir, "0022_external_themes.sql"), "utf-8");
    await db.execute(sql.raw(sql0022));

    // Verify table exists
    const res = await db.execute(sql`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'installed_themes'
    `);
    expect(res.rows.length).toBe(1);
  });

  it("populates existing real theme data on 0022 schema", async () => {
    const db = getDb();
    await db.execute(sql`
      INSERT INTO "installed_themes" (
        "id", "theme_id", "name", "version", "theme_api_version",
        "description", "author", "preview_image", "manifest_json",
        "settings_schema_json", "storage_path", "status", "is_built_in"
      ) VALUES (
        'inst-starter-v1',
        'vibress-starter-theme',
        'Vibress Starter Theme',
        '1.0.0',
        1,
        'Official starter theme',
        'Vibress Team',
        'preview.webp',
        '{"id":"vibress-starter-theme","name":"Vibress Starter Theme","version":"1.0.0"}'::jsonb,
        '{"fields":[]}'::jsonb,
        'content/themes/vibress-starter-theme/1.0.0',
        'installed',
        false
      )
    `);

    // Verify record exists under 0022
    const check = await db.execute(sql`
      SELECT * FROM "installed_themes" WHERE "theme_id" = 'vibress-starter-theme'
    `);
    expect(check.rows.length).toBe(1);
    expect((check.rows[0] as any).version).toBe("1.0.0");
  });

  it("applies canonical 0023_theme_multi_version.sql upgrade without manual SQL intervention", async () => {
    const db = getDb();
    const sql0023 = fs.readFileSync(path.join(migrationsDir, "0023_theme_multi_version.sql"), "utf-8");
    const statements = sql0023.split("--> statement-breakpoint");

    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await db.execute(sql.raw(trimmed));
      }
    }

    // Verify theme_settings table was created
    const settingsTableCheck = await db.execute(sql`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'theme_settings'
    `);
    expect(settingsTableCheck.rows.length).toBe(1);
  });

  it("verifies existing v1.0.0 theme data is completely intact post-upgrade", async () => {
    const db = getDb();
    const check = await db.execute(sql`
      SELECT * FROM "installed_themes" WHERE "theme_id" = 'vibress-starter-theme' AND "version" = '1.0.0'
    `);
    expect(check.rows.length).toBe(1);
    expect((check.rows[0] as any).name).toBe("Vibress Starter Theme");
    expect((check.rows[0] as any).storage_path).toBe("content/themes/vibress-starter-theme/1.0.0");
  });

  it("allows installing v2.0.0 of the SAME theme_id in parallel without unique constraint violation", async () => {
    const db = getDb();
    // This insert would FAIL with unique violation on 0022, but MUST succeed on 0023
    await db.execute(sql`
      INSERT INTO "installed_themes" (
        "id", "theme_id", "name", "version", "theme_api_version",
        "description", "author", "preview_image", "manifest_json",
        "settings_schema_json", "storage_path", "status", "is_built_in"
      ) VALUES (
        'inst-starter-v2',
        'vibress-starter-theme',
        'Vibress Starter Theme v2',
        '2.0.0',
        1,
        'Official starter theme upgraded',
        'Vibress Team',
        'preview.webp',
        '{"id":"vibress-starter-theme","name":"Vibress Starter Theme","version":"2.0.0"}'::jsonb,
        '{"fields":[]}'::jsonb,
        'content/themes/vibress-starter-theme/2.0.0',
        'installed',
        false
      )
    `);

    // Verify both versions exist simultaneously
    const versions = await db.execute(sql`
      SELECT "theme_id", "version", "name" FROM "installed_themes"
      WHERE "theme_id" = 'vibress-starter-theme'
      ORDER BY "version" ASC
    `);
    expect(versions.rows.length).toBe(2);
    expect((versions.rows[0] as any).version).toBe("1.0.0");
    expect((versions.rows[1] as any).version).toBe("2.0.0");
  });

  it("persists and updates theme settings independently in theme_settings table", async () => {
    const db = getDb();
    await db.execute(sql`
      INSERT INTO "theme_settings" ("id", "theme_id", "settings_json")
      VALUES ('settings-starter', 'vibress-starter-theme', '{"accentColor":"#ec4899","heroHeadline":"Upgraded Site"}'::jsonb)
      ON CONFLICT ("theme_id") DO UPDATE SET "settings_json" = EXCLUDED."settings_json"
    `);

    const settingsRes = await db.execute(sql`
      SELECT * FROM "theme_settings" WHERE "theme_id" = 'vibress-starter-theme'
    `);
    expect(settingsRes.rows.length).toBe(1);
    expect((settingsRes.rows[0] as any).settings_json.accentColor).toBe("#ec4899");
    expect((settingsRes.rows[0] as any).settings_json.heroHeadline).toBe("Upgraded Site");
  });
});
