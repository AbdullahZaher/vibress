
import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function migration(name: string): string {
  const folder = path.resolve(__dirname, "../../migrations");
  const root = path.resolve(process.cwd(), "packages/database/migrations");
  const directory = fs.existsSync(path.join(folder, name)) ? folder : root;
  return fs.readFileSync(path.join(directory, name), "utf8");
}

describe("0043 — plugin physical ownership catalog upgrade", () => {
  it.each(["fresh", "populated"])("preserves earlier records on %s", async (mode) => {
    const client = await getDbPool().connect();
    const namespace = "ddl_0043_" + randomUUID().replaceAll("-", "");
    try {
      await client.query('CREATE SCHEMA "' + namespace + '"');
      await client.query('SET search_path TO "' + namespace + '"');
      await client.query(
        "CREATE TABLE publications (id text PRIMARY KEY);" +
        "CREATE TABLE plugins (id text PRIMARY KEY, manifest_id text UNIQUE);" +
        "INSERT INTO plugins VALUES ('plugin-a','approved-a');",
      );
      for (const name of [
        "0040_plugin_publication_states.sql",
        "0041_plugin_publication_settings.sql",
        "0042_plugin_migration_storage_foundation.sql",
      ]) await client.query(migration(name));
      if (mode === "populated") {
        await client.query(
          "INSERT INTO plugin_schema_migrations (plugin_id,migration_id,package_version,artifact_sha256,migration_sha256) " +
          "VALUES ('plugin-a','0001_created','1.0.0',$1,$1)",
          ["a".repeat(64)],
        );
        await client.query(
          "INSERT INTO plugin_storage_models (plugin_id,model_key,migration_id,schema_sha256) " +
          "VALUES ('plugin-a','courses','0001_created',$1)",
          ["a".repeat(64)],
        );
      }
      const ddl = migration("0043_plugin_storage_physical_models.sql");
      await client.query(ddl);
      await client.query(ddl);
      expect((await client.query(
        "SELECT count(*)::int AS n FROM plugin_storage_physical_models",
      )).rows[0]?.n).toBe(0);
      if (mode === "populated") {
        expect((await client.query(
          "SELECT count(*)::int AS n FROM plugin_storage_models",
        )).rows[0]?.n).toBe(1);
      }
      await expect(client.query(
        "INSERT INTO plugin_storage_physical_models (plugin_id,model_key,table_name,schema_sha256) " +
        "VALUES ('plugin-a','unknown',$1,$2)",
        ["ext_" + "1".repeat(40), "b".repeat(64)],
      )).rejects.toMatchObject({ code: "23503" });
      if (mode === "populated") {
        await client.query(
          "INSERT INTO plugin_storage_physical_models (plugin_id,model_key,table_name,schema_sha256) " +
          "VALUES ('plugin-a','courses',$1,$2)",
          ["ext_" + "1".repeat(40), "a".repeat(64)],
        );
        await expect(client.query(
          "UPDATE plugin_storage_physical_models SET schema_sha256=$1",
          ["b".repeat(64)],
        )).rejects.toMatchObject({ code: "23514" });
        await expect(client.query(
          "DELETE FROM plugin_storage_physical_models",
        )).rejects.toMatchObject({ code: "23514" });
      }
    } finally {
      await client.query("RESET search_path");
      await client.query('DROP SCHEMA IF EXISTS "' + namespace + '" CASCADE');
      client.release();
    }
  });
});
