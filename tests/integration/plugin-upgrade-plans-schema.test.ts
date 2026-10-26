import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getDbPool } from "@vibress/database";

/**
 * PLUG-UPD-01: migration regression on a populated tenant-independent plugin
 * catalog. The ephemeral schema is owned only by this test and is dropped
 * even when assertions fail; never use production connections for tests.
 */
describe("0046 staged plugin upgrade history migration", () => {
  it("preserves installed plugins, restricts duplicate staging and digest corruption", async () => {
    const pool = getDbPool();
    const client = await pool.connect();
    const schemaName = "upgrade_" + randomUUID().replaceAll("-", "");
    let created = false;
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      created = true;
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(
        "CREATE TABLE plugins (id text PRIMARY KEY);" +
        "INSERT INTO plugins(id) VALUES ('plug-a'), ('plug-b');",
      );
      const sql = readFileSync(
        resolve(process.cwd(), "packages/database/migrations/0047_plugin_upgrade_plans.sql"),
        "utf8",
      );
      await client.query(sql);
      const fields = [
        "id", "plugin_id", "manifest_id", "from_version", "to_version",
        "from_artifact_sha256", "to_artifact_sha256", "from_lockfile_sha256",
        "to_lockfile_sha256", "from_signer_sha256", "to_signer_sha256", "plan_sha256",
      ];
      const insert = async (id: string, owner: string, digest = "a".repeat(64)) =>
        client.query(
          `INSERT INTO plugin_upgrade_plans (${fields.join(",")})
           VALUES (${fields.map((_, index) => "$" + (index + 1)).join(",")})`,
          [
            id, owner, "trusted-extension", "1.0.0", "1.1.0",
            digest, "b".repeat(64), "c".repeat(64), "d".repeat(64),
            "e".repeat(64), "f".repeat(64), "a".repeat(64),
          ],
        );
      await insert("one", "plug-a");
      await expect(insert("duplicate", "plug-a")).rejects.toMatchObject({ code: "23505" });
      await expect(insert("wrong-checksum", "plug-b", "not-sha"))
        .rejects.toMatchObject({ code: "23514" });
      await client.query("UPDATE plugin_upgrade_plans SET status='aborted' WHERE id='one'");
      await insert("new", "plug-a");
      await expect(client.query("DELETE FROM plugins WHERE id='plug-a'"))
        .rejects.toMatchObject({ code: "23503" });
      const remaining = await client.query("SELECT id FROM plugins ORDER BY id");
      expect(remaining.rows).toEqual([{ id: "plug-a" }, { id: "plug-b" }]);
      const plans = await client.query(
        "SELECT status FROM plugin_upgrade_plans ORDER BY id",
      );
      expect(plans.rows).toEqual([{ status: "staged" }, { status: "aborted" }]);
    } finally {
      if (created) {
        await client.query("RESET search_path");
        await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      client.release();
    }
  });
});
