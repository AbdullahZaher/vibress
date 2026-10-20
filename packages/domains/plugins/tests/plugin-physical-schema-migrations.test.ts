
import { describe, expect, it, vi } from "vitest";
import { getDbPool, schema } from "@vibress/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PluginPhysicalSchemaMigrationService,
  pluginPhysicalModelDigest,
  pluginPhysicalMigrationDigest,
  type ApprovedPluginPhysicalMigration,
} from "../src/application/plugin-storage-migrations";
import { DrizzlePluginStorageMigrationRepository } from "../src/infrastructure/drizzle-plugin-storage-migrations";

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

const columns = [{ name: "title", type: "text", required: true }] as const;
const model = { key: "courses", columns, schemaSha256: pluginPhysicalModelDigest(columns) };
const approved: ApprovedPluginPhysicalMigration = {
  manifestId: "independent-lms",
  migrationId: "0001_courses",
  packageVersion: "0.1.0",
  artifactSha256: "a".repeat(64),
  models: [model],
  migrationSha256: pluginPhysicalMigrationDigest([model]),
};

async function setup(client: Awaited<ReturnType<ReturnType<typeof getDbPool>["connect"]>>) {
  const ns = "physical_" + randomUUID().replaceAll("-", "");
  await client.query('CREATE SCHEMA "' + ns + '"');
  await client.query('SET search_path TO "' + ns + '"');
  await client.query(
    "CREATE TABLE publications (id text PRIMARY KEY);" +
    "CREATE TABLE plugins (id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE, status text NOT NULL, version text NOT NULL);" +
    "INSERT INTO publications VALUES ('pub-a'),('pub-b');" +
    "INSERT INTO plugins VALUES ('p-a','independent-lms','inactive','0.1.0'),('p-b','second-plugin','inactive','0.1.0');",
  );
  for (const ddl of migrations) await client.query(ddl);
  return ns;
}

describe("EXT-203B1 operator-only physical model table creation", () => {
  it.each(["fresh", "populated upgrade"])("creates scoped scalar model on %s", async (mode) => {
    const client = await getDbPool().connect();
    let ns: string | undefined;
    try {
      ns = await setup(client);
      if (mode === "populated upgrade") {
        await client.query(
          "INSERT INTO plugin_schema_migrations (plugin_id,migration_id,package_version,artifact_sha256,migration_sha256) " +
          "VALUES ('p-a','0000_legacy','0.1.0',$1,$1)",
          ["f".repeat(64)],
        );
        await client.query(
          "INSERT INTO plugin_storage_models (plugin_id,model_key,migration_id,schema_sha256) " +
          "VALUES ('p-a','legacy_records','0000_legacy',$1)",
          ["f".repeat(64)],
        );
      }
      const repo = new DrizzlePluginStorageMigrationRepository(
        () => drizzle(client, { schema }),
      );
      const service = new PluginPhysicalSchemaMigrationService(repo);
      expect(await service.applyApprovedPhysical(approved)).toBe("applied");
      expect(await service.applyApprovedPhysical(approved)).toBe("already_applied");
      const rows = await client.query(
        "SELECT table_name FROM plugin_storage_physical_models WHERE plugin_id='p-a' AND model_key='courses'",
      );
      const table: string = rows.rows[0]?.table_name;
      expect(table).toMatch(/^ext_[a-f0-9]{40}$/);
      await client.query('INSERT INTO "' + table + '" (id,publication_id,title) VALUES ($1,$2,$3)', [
        "same-course", "pub-a", "عنوان الدورة",
      ]);
      await client.query('INSERT INTO "' + table + '" (id,publication_id,title) VALUES ($1,$2,$3)', [
        "same-course", "pub-b", "Course B",
      ]);
      expect((await client.query('SELECT count(*)::int AS n FROM "' + table + '"')).rows[0]?.n).toBe(2);
      await expect(client.query('INSERT INTO "' + table + '" (id,publication_id,title) VALUES ($1,$2,$3)', [
        "bad", "foreign-publication", "X",
      ])).rejects.toMatchObject({ code: "23503" });
      await expect(client.query('INSERT INTO "' + table + '" (id,publication_id,title) VALUES ($1,$2,$3)', [
        "same-course", "pub-a", "duplicate",
      ])).rejects.toMatchObject({ code: "23505" });
      await expect(client.query(
        "UPDATE plugin_storage_physical_models SET schema_sha256=$1 WHERE plugin_id='p-a'",
        ["b".repeat(64)],
      )).rejects.toMatchObject({ code: "23514" });
      // Another installed plugin can use the same logical model name but
      // MUST receive a separate physical table.
      expect(await service.applyApprovedPhysical({
        ...approved, manifestId: "second-plugin",
      })).toBe("applied");
      const other = await client.query(
        "SELECT table_name FROM plugin_storage_physical_models WHERE plugin_id='p-b'",
      );
      expect(other.rows[0]?.table_name).not.toBe(table);
      if (mode === "populated upgrade") {
        expect((await client.query(
          "SELECT count(*)::int AS n FROM plugin_schema_migrations WHERE migration_id='0000_legacy'",
        )).rows[0]?.n).toBe(1);
      }
    } finally {
      await client.query("RESET search_path");
      if (ns) await client.query('DROP SCHEMA IF EXISTS "' + ns + '" CASCADE');
      client.release();
    }
  });

  it("rolls back all DDL, reservations and the ledger on a later collision", async () => {
    const client = await getDbPool().connect();
    let ns: string | undefined;
    try {
      ns = await setup(client);
      const second = {
        key: "lessons", columns, schemaSha256: pluginPhysicalModelDigest(columns),
      };
      const collision = "ext_" + createHash("sha256")
        .update("independent-lms:lessons").digest("hex").slice(0, 40);
      await client.query('CREATE TABLE "' + collision + '" (other_column text)');
      const repo = new DrizzlePluginStorageMigrationRepository(() => drizzle(client, { schema }));
      const plan = {
        ...approved, models: [model, second],
        migrationSha256: pluginPhysicalMigrationDigest([model, second]),
      };
      await expect(new PluginPhysicalSchemaMigrationService(repo).applyApprovedPhysical(plan))
        .rejects.toMatchObject({ code: "42P07" });
      expect((await client.query(
        "SELECT count(*)::int AS n FROM plugin_schema_migrations",
      )).rows[0]?.n).toBe(0);
      expect((await client.query(
        "SELECT count(*)::int AS n FROM plugin_storage_physical_models",
      )).rows[0]?.n).toBe(0);
      const first = "ext_" + createHash("sha256")
        .update("independent-lms:courses").digest("hex").slice(0, 40);
      expect((await client.query(
        "SELECT to_regclass($1) AS name", [first],
      )).rows[0]?.name).toBeNull();
    } finally {
      await client.query("RESET search_path");
      if (ns) await client.query('DROP SCHEMA IF EXISTS "' + ns + '" CASCADE');
      client.release();
    }
  });

  it("rejects bad fields, digests and forged descriptors before repository access", async () => {
    const applyApprovedPhysical = vi.fn(async () => "applied" as const);
    const service = new PluginPhysicalSchemaMigrationService({ applyApprovedPhysical });
    const invalid = [
      { ...approved, models: [{ ...model, columns: [{ name: "publication_id", type: "text", required: true }] }] },
      { ...approved, models: [{ ...model, columns: [{ name: "sql;drop", type: "text", required: true }] }] },
      { ...approved, models: [{ ...model, columns: [{ name: "title", type: "jsonb", required: true }] }] },
      { ...approved, models: [{ ...model, columns: [{ name: "title", type: "text", required: "true" }] }] },
      { ...approved, migrationSha256: "a".repeat(64) },
      { ...approved, models: [] },
    ];
    for (const input of invalid) {
      // The service is a runtime boundary despite TypeScript declarations.
      const untrusted: unknown = input;
      await expect(service.applyApprovedPhysical(untrusted as ApprovedPluginPhysicalMigration))
        .rejects.toMatchObject({ code: expect.stringMatching(/^PLUGIN_MIGRATION_/) });
    }
    expect(applyApprovedPhysical).not.toHaveBeenCalled();
  });

  it("rejects replaying a prior catalog-only registration as physical DDL", async () => {
    const client = await getDbPool().connect();
    let ns: string | undefined;
    try {
      ns = await setup(client);
      await client.query(
        "INSERT INTO plugin_schema_migrations (plugin_id,migration_id,package_version,artifact_sha256,migration_sha256) " +
        "VALUES ('p-a','0001_courses','0.1.0',$1,$2)",
        [approved.artifactSha256, approved.migrationSha256],
      );
      await client.query(
        "INSERT INTO plugin_storage_models (plugin_id,model_key,migration_id,schema_sha256) " +
        "VALUES ('p-a','courses','0001_courses',$1)",
        [model.schemaSha256],
      );
      const repo = new DrizzlePluginStorageMigrationRepository(() => drizzle(client, { schema }));
      await expect(new PluginPhysicalSchemaMigrationService(repo).applyApprovedPhysical(approved))
        .rejects.toMatchObject({ code: "PLUGIN_PHYSICAL_SCHEMA_MISSING" });
      expect((await client.query(
        "SELECT count(*)::int AS n FROM plugin_storage_physical_models",
      )).rows[0]?.n).toBe(0);
    } finally {
      await client.query("RESET search_path");
      if (ns) await client.query('DROP SCHEMA IF EXISTS "' + ns + '" CASCADE');
      client.release();
    }
  });
});
