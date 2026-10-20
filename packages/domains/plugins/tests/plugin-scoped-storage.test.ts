import { describe, expect, it, vi } from "vitest";
import { getDbPool, schema } from "@vibress/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PluginPhysicalSchemaMigrationService, pluginPhysicalModelDigest,
  pluginPhysicalMigrationDigest, type ApprovedPluginPhysicalMigration,
} from "../src/application/plugin-storage-migrations";
import {
  PluginScopedStorageService, type PluginStorageRecord,
} from "../src/application/plugin-scoped-storage";
import { DrizzlePluginStorageMigrationRepository } from "../src/infrastructure/drizzle-plugin-storage-migrations";
import { DrizzlePluginScopedStorageRepository } from "../src/infrastructure/drizzle-plugin-scoped-storage";

function migrationSql(name: string): string {
  const local = path.resolve(__dirname, "../../../database/migrations", name);
  const root = path.resolve(process.cwd(), "packages/database/migrations", name);
  return fs.readFileSync(fs.existsSync(local) ? local : root, "utf8");
}
const migrations = [
  "0040_plugin_publication_states.sql",
  "0041_plugin_publication_settings.sql",
  "0042_plugin_migration_storage_foundation.sql",
  "0043_plugin_storage_physical_models.sql",
].map(migrationSql);
const columns = [
  { name: "title", type: "text", required: true },
  { name: "seats", type: "integer", required: false },
  { name: "visible", type: "boolean", required: false },
  { name: "starts_at", type: "timestamptz", required: false },
] as const;
const model = { key: "courses", columns, schemaSha256: pluginPhysicalModelDigest(columns) };
function plan(manifestId: string): ApprovedPluginPhysicalMigration {
  return {
    manifestId, migrationId: "0001_courses", packageVersion: "1.0.0",
    artifactSha256: "a".repeat(64),
    migrationSha256: pluginPhysicalMigrationDigest([model]),
    models: [model],
  };
}

describe("EXT-203B2 host-bound typed publication storage", () => {
  it("enforces publication, model, plugin, capability and version at every database operation", async () => {
    const client = await getDbPool().connect();
    const ns = "storage_b2_" + randomUUID().replaceAll("-", "");
    try {
      await client.query('CREATE SCHEMA "' + ns + '"');
      await client.query('SET search_path TO "' + ns + '"');
      await client.query(`
        CREATE TABLE publications (id text PRIMARY KEY);
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          status text NOT NULL, version text NOT NULL,
          capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
        );
        INSERT INTO publications VALUES ('pub-a'), ('pub-b');
        INSERT INTO plugins VALUES
          ('plugin-a', 'independent-lms', 'inactive', '1.0.0',
           '["extension.storage.read","extension.storage.write"]'),
          ('plugin-b', 'other-courses', 'inactive', '1.0.0',
           '["extension.storage.read","extension.storage.write"]');
      `);
      for (const ddl of migrations) await client.query(ddl);
      const db = drizzle(client, { schema });
      const migrationService = new PluginPhysicalSchemaMigrationService(
        new DrizzlePluginStorageMigrationRepository(() => db),
      );
      expect(await migrationService.applyApprovedPhysical(plan("independent-lms")))
        .toBe("applied");
      expect(await migrationService.applyApprovedPhysical(plan("other-courses")))
        .toBe("applied");
      await client.query(`
        UPDATE plugins SET status='active';
        INSERT INTO plugin_publication_states (plugin_id,publication_id,enabled)
        VALUES ('plugin-a','pub-a',true), ('plugin-a','pub-b',true),
               ('plugin-b','pub-a',true), ('plugin-b','pub-b',false);
      `);
      const repository = new DrizzlePluginScopedStorageRepository(() => db);
      const a = new PluginScopedStorageService(repository,
        { pluginId: "plugin-a", publicationId: "pub-a" }, [model]);
      const b = new PluginScopedStorageService(repository,
        { pluginId: "plugin-a", publicationId: "pub-b" }, [model]);
      const other = new PluginScopedStorageService(repository,
        { pluginId: "plugin-b", publicationId: "pub-a" }, [model]);

      const created = await a.create("courses", "same-id", {
        title: "مقدمة", seats: 10, visible: true, starts_at: "2026-10-20T09:00:00Z",
      });
      expect(created).toEqual({
        id: "same-id", version: 1,
        fields: { title: "مقدمة", seats: 10, visible: true, starts_at: "2026-10-20T09:00:00.000Z" },
      });
      await b.create("courses", "same-id", { title: "Publication B" });
      expect((await b.get("courses", "same-id"))?.fields.title).toBe("Publication B");
      expect((await a.get("courses", "same-id"))?.fields.title).toBe("مقدمة");
      expect(await other.get("courses", "same-id")).toBeNull();
      expect((await other.create("courses", "same-id", { title: "Separate plugin" }))
        .fields.title).toBe("Separate plugin");

      await expect(a.create("courses", "spoof", {
        title: "Spoof", publication_id: "pub-b",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("courses", "spoof", {
        title: "Spoof", id: "foreign",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("courses", "bad-record", {
        title: "Bad", seats: 2147483648,
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("courses", "bad-record", {
        title: "Bad", starts_at: "tomorrow",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("unknown", "bad-record", {
        title: "No",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_MODEL_DENIED" });
      await expect(a.create("courses", "same-id", { title: "duplicate" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_CONFLICT" });

      expect((await a.update("courses", "same-id", 1, { title: "Updated" })).version).toBe(2);
      await expect(a.update("courses", "same-id", 1, { title: "stale" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_CONFLICT" });
      await expect(a.update("courses", "missing", 1, { title: "none" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_NOT_FOUND" });
      expect(await a.get("courses", "missing")).toBeNull();
      await a.create("courses", "zz-next", { title: "Next" });
      const page = await a.list("courses", 1);
      expect(page.items.map((item: PluginStorageRecord) => item.id)).toEqual(["same-id"]);
      expect(page.nextCursor).toBe("same-id");
      expect((await a.list("courses", 10, page.nextCursor)).items.map((item) => item.id))
        .toEqual(["zz-next"]);
      await expect(a.list("courses", 51)).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });

      await client.query(`
        UPDATE plugin_publication_states SET enabled=false
        WHERE plugin_id='plugin-a' AND publication_id='pub-b';
      `);
      await expect(b.get("courses", "same-id")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_DENIED",
      });
      await client.query(`
        UPDATE plugins SET capabilities='["extension.storage.read"]'::jsonb
        WHERE id='plugin-a';
      `);
      expect((await a.get("courses", "same-id"))?.version).toBe(2);
      await expect(a.update("courses", "same-id", 2, { title: "Denied" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_DENIED" });
      await client.query("UPDATE plugins SET status='inactive' WHERE id='plugin-a'");
      await expect(a.get("courses", "same-id")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_DENIED",
      });
      // Keep persisted rows on disable and later reactivation.
      await client.query(`
        UPDATE plugins SET status='active',
          capabilities='["extension.storage.read","extension.storage.write"]'::jsonb
        WHERE id='plugin-a';
      `);
      expect((await a.get("courses", "same-id"))?.fields.title).toBe("Updated");
      const wrongSchema = { ...model, schemaSha256: "b".repeat(64) };
      expect(() => new PluginScopedStorageService(repository,
        { pluginId: "plugin-a", publicationId: "pub-a" }, [wrongSchema]))
        .toThrow(expect.objectContaining({ code: "PLUGIN_STORAGE_INVALID" }));
      const oldMapping = await client.query(
        "SELECT count(*)::int AS n FROM plugin_schema_migrations",
      );
      expect(oldMapping.rows[0]?.n).toBe(2);
    } finally {
      await client.query("RESET search_path");
      await client.query('DROP SCHEMA IF EXISTS "' + ns + '" CASCADE');
      client.release();
    }
  });

  it("refuses malformed requests before contacting the repository", async () => {
    const repository = {
      get: vi.fn(async () => null),
      list: vi.fn(async () => ({ items: [] })),
      create: vi.fn(async () => ({ id: "x", version: 1, fields: { title: "x" } })),
      update: vi.fn(async () => ({ id: "x", version: 2, fields: { title: "x" } })),
    };
    const service = new PluginScopedStorageService(repository,
      { pluginId: "plugin-a", publicationId: "pub-a" }, [model]);
    await expect(service.create("courses", "../bad", { title: "x" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.create("courses", "valid", { seats: 2 }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.update("courses", "valid", 0, { title: "new" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.update("courses", "valid", 1, {}))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.list("courses", 1, "../escape"))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.list).not.toHaveBeenCalled();
  });
});
