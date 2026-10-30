import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDbPool, schema } from "@vibress/database";
import { DrizzlePluginUpgradePlanRepository, PluginUpgradePlanError } from "@vibress/plugins";

const fingerprints = {
  source: "a".repeat(64), target: "b".repeat(64),
  sourceLock: "c".repeat(64), targetLock: "d".repeat(64),
  signer: "e".repeat(64), foreign: "f".repeat(64),
};
const migration = (name: string) => readFileSync(
  resolve(process.cwd(), "packages/database/migrations", name), "utf8",
);

describe("PLUG-UPD-02B durable operator preflight and approval", () => {
  it("rejects unsafe/stale transitions and commits preflight/approval with audit atomically", async () => {
    const client = await getDbPool().connect();
    const schemaName = "upgrade_approval_" + randomUUID().replaceAll("-", "");
    const pluginId = randomUUID();
    const foreignPluginId = randomUUID();
    const audit = { actorUserId: "operator-" + randomUUID(), requestId: "req-" + randomUUID() };
    let created = false;
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      created = true;
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          version text NOT NULL, status text NOT NULL, capabilities jsonb NOT NULL
        );
        CREATE TABLE plugin_publication_states (
          plugin_id text NOT NULL, enabled boolean NOT NULL
        );
        CREATE TABLE plugin_event_receipts (
          id text PRIMARY KEY, plugin_id text NOT NULL, status text NOT NULL
        );
        CREATE TABLE audit_events (
          id text PRIMARY KEY, publication_id text,
          actor_user_id text, request_id text, action text NOT NULL,
          target_type text, target_id text, metadata jsonb,
          ip_address text, user_agent text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await client.query(
        `INSERT INTO plugins (id, manifest_id, version, status, capabilities)
         VALUES ($1,'trusted-ext','1.0.0','inactive','["events.subscribe"]'::jsonb),
                ($2,'foreign-ext','1.0.0','inactive','[]'::jsonb)`,
        [pluginId, foreignPluginId],
      );
      await client.query(migration("0047_plugin_upgrade_plans.sql"));
      await client.query(migration("0048_plugin_upgrade_preflight_approval.sql"));
      const repository = new DrizzlePluginUpgradePlanRepository(
        () => drizzle(client, { schema }),
      );
      const receipt = (version: string, hash: string, lock: string) => ({
        schemaVersion: 1, signatureVerified: true,
        publicKeySha256: fingerprints.signer,
        lockfileSha256: lock, releases: [{
          pluginId: "trusted-ext", version, sha256: hash, adminViewCount: 0,
        }],
      });
      const plan = await repository.stage({
        pluginId,
        sourceAdmission: receipt("1.0.0", fingerprints.source, fingerprints.sourceLock),
        targetAdmission: receipt("2.0.0", fingerprints.target, fingerprints.targetLock),
        targetManifest: {
          id: "trusted-ext", version: "2.0.0",
          capabilities: ["extension.storage.read"],
        },
      });
      const preflight = {
        pluginId, planId: plan.id,
        expectedPlanSha256: plan.planSha256, expectedRevision: 1,
      };
      const reject = async (
        act: () => Promise<unknown>, code: string,
      ) => {
        try {
          await act();
          throw new Error("Forbidden upgrade transition unexpectedly succeeded");
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(PluginUpgradePlanError);
          expect(error).toMatchObject({ code });
        }
      };
      await reject(() => repository.preflight({
        ...preflight, pluginId: foreignPluginId,
      }, audit), "PLUGIN_UPGRADE_PREFLIGHT_CONFLICT");
      await reject(() => repository.preflight({
        ...preflight, expectedRevision: 2,
      }, audit), "PLUGIN_UPGRADE_PREFLIGHT_CONFLICT");
      await reject(() => repository.preflight({
        ...preflight, expectedPlanSha256: fingerprints.foreign,
      }, audit), "PLUGIN_UPGRADE_PREFLIGHT_CONFLICT");
      await reject(() => repository.preflight(preflight, {
        ...audit, actorUserId: "",
      }), "PLUGIN_UPGRADE_PREFLIGHT_INVALID_INPUT");

      await client.query("UPDATE plugins SET status='active' WHERE id=$1", [pluginId]);
      await reject(() => repository.preflight(preflight, audit), "PLUGIN_UPGRADE_PREFLIGHT_NOT_READY");
      await client.query("UPDATE plugins SET status='inactive' WHERE id=$1", [pluginId]);

      await client.query(
        "INSERT INTO plugin_publication_states(plugin_id, enabled) VALUES ($1,true)", [pluginId],
      );
      await reject(() => repository.preflight(preflight, audit), "PLUGIN_UPGRADE_PREFLIGHT_NOT_READY");
      await client.query("DELETE FROM plugin_publication_states WHERE plugin_id=$1", [pluginId]);
      await client.query(
        "INSERT INTO plugin_event_receipts(id,plugin_id,status) VALUES ($1,$2,'queued')",
        [randomUUID(), pluginId],
      );
      await reject(() => repository.preflight(preflight, audit), "PLUGIN_UPGRADE_PREFLIGHT_NOT_READY");
      await client.query("DELETE FROM plugin_event_receipts WHERE plugin_id=$1", [pluginId]);

      // An unavailable audit log must cancel the entire readiness transition.
      await client.query(`ALTER TABLE audit_events ADD CONSTRAINT reject_preflight
        CHECK (action <> 'plugin.upgrade_preflighted')`);
      await expect(repository.preflight(preflight, audit)).rejects.toThrow();
      const unchanged = await client.query(
        "SELECT status, revision, preflight_sha256 FROM plugin_upgrade_plans WHERE id=$1",
        [plan.id],
      );
      expect(unchanged.rows).toEqual([{
        status: "staged", revision: 1, preflight_sha256: null,
      }]);
      await client.query("ALTER TABLE audit_events DROP CONSTRAINT reject_preflight");

      const checked = await repository.preflight(preflight, audit);
      expect(checked.status).toBe("preflighted");
      expect(checked.revision).toBe(2);
      expect(checked.preflightSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(checked.preflightedAt).toBeInstanceOf(Date);
      await reject(() => repository.preflight(preflight, audit), "PLUGIN_UPGRADE_PREFLIGHT_CONFLICT");
      const approval = {
        ...preflight,
        expectedRevision: 2,
        expectedPreflightSha256: checked.preflightSha256!,
        decision: "approve" as const,
        reviewedCapabilitiesAdded: ["extension.storage.read"],
        reviewedCapabilitiesRemoved: ["events.subscribe"],
      };
      await reject(() => repository.approve({
        ...approval, expectedPreflightSha256: fingerprints.foreign,
      }, audit), "PLUGIN_UPGRADE_APPROVAL_CONFLICT");
      await reject(() => repository.approve({
        ...approval, expectedRevision: 1,
      }, audit), "PLUGIN_UPGRADE_APPROVAL_CONFLICT");
      await reject(() => repository.approve({
        ...approval, reviewedCapabilitiesAdded: [],
      }, audit), "PLUGIN_UPGRADE_APPROVAL_CONFLICT");
      await reject(() => repository.approve({
        ...approval, reviewedCapabilitiesRemoved: [],
      }, audit), "PLUGIN_UPGRADE_APPROVAL_CONFLICT");
      await reject(() => repository.approve(approval, {
        ...audit, requestId: "",
      }), "PLUGIN_UPGRADE_APPROVAL_INVALID_INPUT");

      // Readiness may change after preflight. Approval must fail again.
      await client.query("UPDATE plugins SET status='active' WHERE id=$1", [pluginId]);
      await reject(() => repository.approve(approval, audit), "PLUGIN_UPGRADE_APPROVAL_NOT_READY");
      await client.query("UPDATE plugins SET status='inactive' WHERE id=$1", [pluginId]);
      await client.query(
        "INSERT INTO plugin_publication_states(plugin_id, enabled) VALUES ($1,true)", [pluginId],
      );
      await reject(() => repository.approve(approval, audit), "PLUGIN_UPGRADE_APPROVAL_NOT_READY");
      await client.query("DELETE FROM plugin_publication_states WHERE plugin_id=$1", [pluginId]);
      await client.query(
        "INSERT INTO plugin_event_receipts(id,plugin_id,status) VALUES ($1,$2,'pending')",
        [randomUUID(), pluginId],
      );
      await reject(() => repository.approve(approval, audit), "PLUGIN_UPGRADE_APPROVAL_NOT_READY");
      await client.query("DELETE FROM plugin_event_receipts WHERE plugin_id=$1", [pluginId]);

      await client.query(`ALTER TABLE audit_events ADD CONSTRAINT reject_approval
        CHECK (action <> 'plugin.upgrade_approved')`);
      await expect(repository.approve(approval, audit)).rejects.toThrow();
      expect((await client.query(
        "SELECT status, revision, approved_at FROM plugin_upgrade_plans WHERE id=$1",
        [plan.id],
      )).rows).toEqual([{ status: "preflighted", revision: 2, approved_at: null }]);
      await client.query("ALTER TABLE audit_events DROP CONSTRAINT reject_approval");

      const approved = await repository.approve(approval, audit);
      expect(approved.status).toBe("approved");
      expect(approved.revision).toBe(3);
      expect(approved.approvedBy).toBe(audit.actorUserId);
      expect(approved.approvedAt).toBeInstanceOf(Date);
      await reject(() => repository.approve(approval, audit), "PLUGIN_UPGRADE_APPROVAL_CONFLICT");
      await reject(() => repository.abortStaged({
        ...preflight, expectedRevision: 3,
      }, audit), "PLUGIN_UPGRADE_ABORT_CONFLICT");
      const actions = await client.query(
        "SELECT action, publication_id, metadata FROM audit_events ORDER BY created_at, action",
      );
      expect(actions.rows.map(row => row.action).sort()).toEqual([
        "plugin.upgrade_approved", "plugin.upgrade_preflighted",
      ]);
      expect(actions.rows.every(row => row.publication_id === null && row.metadata === null))
        .toBe(true);
      const unchangedPlugin = await client.query(
        "SELECT version, status FROM plugins WHERE id=$1", [pluginId],
      );
      expect(unchangedPlugin.rows).toEqual([{ version: "1.0.0", status: "inactive" }]);
    } finally {
      if (created) {
        await client.query("RESET search_path");
        await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      client.release();
    }
  });
});
