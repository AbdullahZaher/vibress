import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDbPool, schema } from "@vibress/database";
import { DrizzlePluginUpgradePlanRepository } from
  "../../packages/domains/plugins/src/infrastructure/drizzle-plugin-upgrade-plans";
import { PluginUpgradePlanError } from
  "../../packages/domains/plugins/src/application/plugin-upgrade-plan";

const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);
const d = "d".repeat(64);
const e = "e".repeat(64);
const f = "f".repeat(64);

describe("PLUG-UPD-02A PostgreSQL staged-plan CAS and atomic audit", () => {
  it("denies stale, foreign and unsafe aborts; rolls back on audit failure", async () => {
    const client = await getDbPool().connect();
    const name = "plugin_abort_" + randomUUID().replaceAll("-", "");
    const pluginId = randomUUID();
    const otherPluginId = randomUUID();
    const audit = { actorUserId: "operator-" + randomUUID(), requestId: "request-" + randomUUID() };
    let created = false;
    try {
      await client.query(`CREATE SCHEMA "${name}"`);
      created = true;
      await client.query(`SET search_path TO "${name}"`);
      await client.query(`
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          version text NOT NULL, capabilities jsonb NOT NULL
        );
        CREATE TABLE audit_events (
          id text PRIMARY KEY, publication_id text,
          actor_user_id text, request_id text, action text NOT NULL,
          target_type text, target_id text, metadata jsonb
        );
      `);
      await client.query(
        `INSERT INTO plugins (id, manifest_id, version, capabilities)
         VALUES ($1,'test-upgrade','1.0.0','["events.subscribe"]'::jsonb),
                ($2,'foreign-upgrade','1.0.0','[]'::jsonb)`,
        [pluginId, otherPluginId],
      );
      await client.query(readFileSync(
        resolve(process.cwd(), "packages/database/migrations/0047_plugin_upgrade_plans.sql"),
        "utf8",
      ));
      const repository = new DrizzlePluginUpgradePlanRepository(
        () => drizzle(client, { schema }),
      );
      const receipt = (version: string, sha: string, lock: string) => ({
        schemaVersion: 1, signatureVerified: true,
        publicKeySha256: f, lockfileSha256: lock, releases: [{
          pluginId: "test-upgrade", version, sha256: sha, adminViewCount: 0,
        }],
      });
      const plan = await repository.stage({
        pluginId, sourceAdmission: receipt("1.0.0", a, c),
        targetAdmission: receipt("2.0.0", b, d),
        targetManifest: {
          id: "test-upgrade", version: "2.0.0", capabilities: ["members.read"],
        },
      });
      const abort = {
        pluginId, planId: plan.id, expectedRevision: 1,
        expectedPlanSha256: plan.planSha256,
      };
      const refused = async (args: typeof abort, ctx = audit) => {
        try {
          await repository.abortStaged(args, ctx);
          throw new Error("Unexpectedly accepted unsafe abort");
        } catch (error) {
          expect(error).toBeInstanceOf(PluginUpgradePlanError);
          expect(error).toMatchObject({ code: "PLUGIN_UPGRADE_ABORT_CONFLICT" });
        }
      };
      await refused({ ...abort, pluginId: otherPluginId });
      await refused({ ...abort, expectedPlanSha256: e });
      await refused({ ...abort, expectedRevision: 2 });
      await expect(repository.abortStaged(abort, { ...audit, actorUserId: "" }))
        .rejects.toMatchObject({ code: "PLUGIN_UPGRADE_ABORT_INVALID_INPUT" });
      expect((await client.query("SELECT count(*)::int AS total FROM audit_events"))
        .rows[0]?.total).toBe(0);

      // Failure of an atomic audit write must roll back the status mutation.
      await client.query(`ALTER TABLE audit_events ADD CONSTRAINT reject_aborts
        CHECK (action <> 'plugin.upgrade_aborted')`);
      await expect(repository.abortStaged(abort, audit))
        .rejects.toMatchObject({ code: "23514" });
      expect((await client.query(
        "SELECT status, revision FROM plugin_upgrade_plans WHERE id = $1", [plan.id],
      )).rows).toEqual([{ status: "staged", revision: 1 }]);
      await client.query("ALTER TABLE audit_events DROP CONSTRAINT reject_aborts");

      const aborted = await repository.abortStaged(abort, audit);
      expect(aborted.status).toBe("aborted");
      expect(aborted.revision).toBe(2);
      await refused(abort);
      expect((await client.query(
        "SELECT action, publication_id, actor_user_id, request_id, target_id FROM audit_events",
      )).rows).toEqual([{
        action: "plugin.upgrade_aborted", publication_id: null,
        actor_user_id: audit.actorUserId, request_id: audit.requestId,
        target_id: plan.id,
      }]);
      // The partial unique index ignores terminal plans. The original plan
      // remains retained and cannot be accidentally un-aborted.
      const next = await repository.stage({
        pluginId, sourceAdmission: receipt("1.0.0", a, c),
        targetAdmission: receipt("2.0.0", b, d),
        targetManifest: {
          id: "test-upgrade", version: "2.0.0", capabilities: ["members.read"],
        },
      });
      expect(next.id).not.toBe(plan.id);
      await client.query(
        "UPDATE plugin_upgrade_plans SET status = 'approved' WHERE id = $1", [next.id],
      );
      await refused({ ...abort, planId: next.id, expectedPlanSha256: next.planSha256 });
      expect((await client.query(
        "SELECT count(*)::int AS total FROM audit_events",
      )).rows[0]?.total).toBe(1);
    } finally {
      if (created) {
        await client.query("RESET search_path");
        await client.query(`DROP SCHEMA "${name}" CASCADE`);
      }
      client.release();
    }
  });
});
