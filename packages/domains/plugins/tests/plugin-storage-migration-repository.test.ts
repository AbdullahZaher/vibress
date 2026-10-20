import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDbPool, schema } from "@vibress/database";
import {
  PluginStorageMigrationService,
  type ApprovedPluginCatalogMigration,
} from "../src/application/plugin-storage-migrations";
import { DrizzlePluginStorageMigrationRepository } from "../src/infrastructure/drizzle-plugin-storage-migrations";

function migrationSql(file: string): string {
  const local = path.resolve(__dirname, "../../../database/migrations", file);
  const fromRoot = path.resolve(process.cwd(), "packages/database/migrations", file);
  return fs.readFileSync(fs.existsSync(local) ? local : fromRoot, "utf8");
}
const migrations = [
  "0040_plugin_publication_states.sql",
  "0041_plugin_publication_settings.sql",
  "0042_plugin_migration_storage_foundation.sql",
].map(migrationSql);

const declaration: ApprovedPluginCatalogMigration = {
  manifestId: "independent-lms",
  migrationId: "0001_courses",
  packageVersion: "0.1.0",
  artifactSha256: "a".repeat(64),
  migrationSha256: "b".repeat(64),
  models: [{ key: "courses", schemaSha256: "c".repeat(64) }],
};

describe("EXT-203A PostgreSQL transaction, replay and upgrade safety", () => {
  afterEach(() => {
    // Each test owns and tears down its own isolated schema and connection.
  });

  it("replays atomically, rejects checksum drift and model-key collisions, enforces stop-before-upgrade", async () => {
    const client = await getDbPool().connect();
    const isolated = `migration_runner_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${isolated}"`);
      await client.query(`SET search_path TO "${isolated}"`);
      await client.query(`
        CREATE TABLE publications (id text PRIMARY KEY);
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          status text NOT NULL
        );
        INSERT INTO publications (id) VALUES ('pub-a'), ('pub-b');
        INSERT INTO plugins (id, manifest_id, status)
        VALUES ('p-a', 'independent-lms', 'inactive'),
               ('p-b', 'second-plugin', 'inactive');
      `);
      for (const sql of migrations) await client.query(sql);
      const db = drizzle(client, { schema });
      const service = new PluginStorageMigrationService(
        new DrizzlePluginStorageMigrationRepository(() => db),
      );
      expect(await service.registerApprovedCatalog(declaration)).toBe("applied");
      expect(await service.registerApprovedCatalog(declaration)).toBe("already_applied");

      const ledger = await client.query(
        "SELECT migration_id FROM plugin_schema_migrations WHERE plugin_id='p-a'",
      );
      expect(ledger.rows).toEqual([{ migration_id: "0001_courses" }]);
      const namespace = await client.query(
        "SELECT model_key FROM plugin_storage_models WHERE plugin_id='p-a'",
      );
      expect(namespace.rows).toEqual([{ model_key: "courses" }]);

      await expect(service.registerApprovedCatalog({
        ...declaration, migrationSha256: "d".repeat(64),
      })).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_CHECKSUM_CONFLICT" });
      await expect(service.registerApprovedCatalog({
        ...declaration, models: [{ key: "lessons", schemaSha256: "c".repeat(64) }],
      })).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_CHECKSUM_CONFLICT" });
      await expect(service.registerApprovedCatalog({
        ...declaration, migrationId: "0000_earlier",
      })).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_OUT_OF_ORDER" });

      // The new ledger row must roll back if ANY model reservation collides.
      await expect(service.registerApprovedCatalog({
        ...declaration,
        migrationId: "0002_colliding",
        migrationSha256: "d".repeat(64),
        models: [
          { key: "new_model", schemaSha256: "e".repeat(64) },
          { key: "courses", schemaSha256: "c".repeat(64) },
        ],
      })).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_MODEL_COLLISION" });
      expect((await client.query(
        "SELECT count(*)::int AS count FROM plugin_schema_migrations WHERE plugin_id='p-a'",
      )).rows[0]?.count).toBe(1);
      expect((await client.query(
        "SELECT count(*)::int AS count FROM plugin_storage_models WHERE plugin_id='p-a'",
      )).rows[0]?.count).toBe(1);

      await client.query("UPDATE plugins SET status='active' WHERE id='p-a'");
      await expect(service.registerApprovedCatalog({
        ...declaration, migrationId: "0002_lessons",
        migrationSha256: "e".repeat(64), models: [],
      })).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_LIFECYCLE" });
      await client.query("UPDATE plugins SET status='inactive' WHERE id='p-a'");
      expect(await service.registerApprovedCatalog({
        ...declaration, migrationId: "0002_lessons",
        migrationSha256: "e".repeat(64),
        models: [{ key: "lessons", schemaSha256: "f".repeat(64) }],
      })).toBe("applied");

      // Logical model names belong to a plugin, never to a global namespace.
      expect(await service.registerApprovedCatalog({
        ...declaration,
        manifestId: "second-plugin", migrationId: "0001_courses",
      })).toBe("applied");
      expect((await client.query(
        "SELECT count(*)::int AS count FROM plugin_storage_models WHERE model_key='courses'",
      )).rows[0]?.count).toBe(2);

      // Historical migrations continue to prevent casual uninstall.
      await expect(client.query("DELETE FROM plugins WHERE id='p-a'"))
        .rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
      client.release();
    }
  });

  it("serializes simultaneous replicas with a per-plugin transaction lock", async () => {
    const client1 = await getDbPool().connect();
    const client2 = await getDbPool().connect();
    const isolated = `migration_race_${randomUUID().replaceAll("-", "")}`;
    try {
      await client1.query(`CREATE SCHEMA "${isolated}"`);
      await client1.query(`SET search_path TO "${isolated}"`);
      await client2.query(`SET search_path TO "${isolated}"`);
      await client1.query(`
        CREATE TABLE publications (id text PRIMARY KEY);
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          status text NOT NULL
        );
        INSERT INTO plugins (id, manifest_id, status)
        VALUES ('p-a', 'independent-lms', 'inactive');
      `);
      for (const ddl of migrations) await client1.query(ddl);
      const service1 = new PluginStorageMigrationService(
        new DrizzlePluginStorageMigrationRepository(
          () => drizzle(client1, { schema }),
        ),
      );
      const service2 = new PluginStorageMigrationService(
        new DrizzlePluginStorageMigrationRepository(
          () => drizzle(client2, { schema }),
        ),
      );
      const results = await Promise.all([
        service1.registerApprovedCatalog(declaration),
        service2.registerApprovedCatalog(declaration),
      ]);
      expect(results.sort()).toEqual(["already_applied", "applied"]);
      expect((await client1.query(
        "SELECT count(*)::int AS count FROM plugin_schema_migrations",
      )).rows[0]?.count).toBe(1);
    } finally {
      await client1.query("RESET search_path");
      await client2.query("RESET search_path");
      await client1.query(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
      client1.release();
      client2.release();
    }
  });
});
