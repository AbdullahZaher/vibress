import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDbPool, schema } from "@vibress/database";
import {
  DrizzlePluginUpgradePlanRepository,
  DrizzlePluginRepository,
  PluginsService,
  PluginUpgradePlanError,
} from "@vibress/plugins";

const fingerprints = {
  source: "a".repeat(64),
  target: "b".repeat(64),
  sourceLock: "c".repeat(64),
  targetLock: "d".repeat(64),
  signer: "e".repeat(64),
  foreign: "f".repeat(64),
};

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), "packages/database/migrations", name), "utf8");

describe("M2: Complete Plugin Upgrade Lifecycle, Quiescence, Activation, Rollback, and Purge", () => {
  it("executes full stage → preflight → approve → quiesce → migrate → activate → observe → complete lifecycle", async () => {
    const client = await getDbPool().connect();
    const schemaName = "upgrade_lifecycle_" + randomUUID().replaceAll("-", "");
    const pluginId = randomUUID();
    const audit = { actorUserId: "operator-" + randomUUID(), requestId: "req-" + randomUUID() };
    let created = false;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      created = true;
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          name text NOT NULL DEFAULT 'Trusted Extension',
          version text NOT NULL, vibress_api_version text NOT NULL DEFAULT '1.0.0',
          description text, entrypoint text NOT NULL DEFAULT 'index.js',
          status text NOT NULL, capabilities jsonb NOT NULL,
          hooks jsonb NOT NULL DEFAULT '[]'::jsonb,
          settings_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_publication_states (
          plugin_id text NOT NULL, publication_id text NOT NULL DEFAULT 'default',
          enabled boolean NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (plugin_id, publication_id)
        );
        CREATE TABLE plugin_publication_settings (
          id text PRIMARY KEY, plugin_id text NOT NULL, publication_id text NOT NULL,
          key text NOT NULL, value text, encrypted_value text, is_secret boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_settings (
          id text PRIMARY KEY, plugin_id text NOT NULL,
          key text NOT NULL, value text, encrypted_value text, is_secret boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_schema_migrations (
          id text PRIMARY KEY, plugin_id text NOT NULL, manifest_id text NOT NULL,
          migration_id text NOT NULL, schema_version integer NOT NULL,
          package_version text NOT NULL, artifact_sha256 text NOT NULL,
          migration_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_storage_models (
          id text PRIMARY KEY, plugin_id text NOT NULL, manifest_id text NOT NULL,
          migration_id text NOT NULL, model_key text NOT NULL,
          storage_mode text NOT NULL, schema_sha256 text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_storage_physical_models (
          plugin_id text NOT NULL, model_key text NOT NULL,
          table_name text NOT NULL, schema_sha256 text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (plugin_id, model_key)
        );
        CREATE TABLE plugin_member_records (
          record_id text NOT NULL, plugin_id text NOT NULL, publication_id text NOT NULL,
          member_id text NOT NULL, model_key text NOT NULL, fields jsonb NOT NULL,
          version integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (plugin_id, publication_id, member_id, model_key, record_id)
        );
        CREATE TABLE plugin_event_receipts (
          id text PRIMARY KEY, plugin_id text NOT NULL, status text NOT NULL,
          publication_id text, event_id text NOT NULL DEFAULT 'evt-1',
          event_type text NOT NULL DEFAULT 'test',
          created_at timestamptz NOT NULL DEFAULT now()
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
         VALUES ($1, 'trusted-ext', '1.0.0', 'inactive', '["events.subscribe", "legacy.perm"]'::jsonb)`,
        [pluginId],
      );

      await client.query(migration("0047_plugin_upgrade_plans.sql"));
      await client.query(migration("0048_plugin_upgrade_preflight_approval.sql"));

      const repository = new DrizzlePluginUpgradePlanRepository(
        () => drizzle(client, { schema }),
      );

      const receipt = (ver: string, hash: string, lock: string) => ({
        schemaVersion: 1,
        signatureVerified: true,
        publicKeySha256: fingerprints.signer,
        lockfileSha256: lock,
        releases: [{
          pluginId: "trusted-ext",
          version: ver,
          sha256: hash,
          adminViewCount: 0,
        }],
      });

      // 1. Stage
      const staged = await repository.stage({
        pluginId,
        sourceAdmission: receipt("1.0.0", fingerprints.source, fingerprints.sourceLock),
        targetAdmission: receipt("2.0.0", fingerprints.target, fingerprints.targetLock),
        targetManifest: {
          id: "trusted-ext",
          version: "2.0.0",
          capabilities: ["events.subscribe", "extension.storage.read"],
        },
      });
      expect(staged.status).toBe("staged");
      expect(staged.revision).toBe(1);

      // 2. Preflight
      const preflighted = await repository.preflight({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 1,
      }, audit);
      expect(preflighted.status).toBe("preflighted");
      expect(preflighted.revision).toBe(2);

      // 3. Approve
      const approved = await repository.approve({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 2,
        expectedPreflightSha256: preflighted.preflightSha256!,
        decision: "approve",
        reviewedCapabilitiesAdded: ["extension.storage.read"],
        reviewedCapabilitiesRemoved: ["legacy.perm"],
      }, audit);
      expect(approved.status).toBe("approved");
      expect(approved.revision).toBe(3);

      // 4. Quiesce (UPD-03)
      // If plugin has pending events, quiesce must be rejected
      const eventReceiptId = randomUUID();
      await client.query(
        "INSERT INTO plugin_event_receipts(id, plugin_id, status) VALUES ($1, $2, 'dispatching')",
        [eventReceiptId, pluginId],
      );
      await expect(repository.quiesce({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 3,
      }, audit)).rejects.toMatchObject({ code: "PLUGIN_UPGRADE_QUIESCE_NOT_READY" });

      await client.query("DELETE FROM plugin_event_receipts WHERE id=$1", [eventReceiptId]);

      // Quiesce succeeds
      const quiesced = await repository.quiesce({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 3,
      }, audit);
      expect(quiesced.status).toBe("quiesced");
      expect(quiesced.revision).toBe(4);

      // 5. Migrate (UPD-04)
      let migrationRan = false;
      const migrated = await repository.migrate({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 4,
      }, audit, {
        migrationRunner: async () => {
          migrationRan = true;
        },
      });
      expect(migrationRan).toBe(true);
      expect(migrated.status).toBe("migrated");
      expect(migrated.revision).toBe(5);

      // Post-migration abort must be rejected (UPD-02, UPD-05)
      await expect(repository.abort({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 5,
      }, audit)).rejects.toMatchObject({ code: "PLUGIN_UPGRADE_ABORT_AFTER_MIGRATION_DENIED" });

      // 6. Activate (UPD-02E)
      const activated = await repository.activate({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 5,
      }, audit);
      expect(activated.status).toBe("activated");
      expect(activated.revision).toBe(6);

      // Verify installed plugin table metadata is atomically updated
      const [updatedPlugin] = (await client.query("SELECT version, capabilities FROM plugins WHERE id=$1", [pluginId])).rows;
      expect(updatedPlugin.version).toBe("2.0.0");
      expect(updatedPlugin.capabilities).toEqual(["events.subscribe", "extension.storage.read"]);

      // 7. Observe (UPD-02F)
      const observed = await repository.observe({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 6,
      }, audit);
      expect(observed.status).toBe("observed");
      expect(observed.revision).toBe(7);

      // 8. Complete (UPD-02G)
      const completed = await repository.complete({
        pluginId,
        planId: staged.id,
        expectedPlanSha256: staged.planSha256,
        expectedRevision: 7,
      }, audit);
      expect(completed.status).toBe("completed");
      expect(completed.revision).toBe(8);

      // Verify complete audit ledger trail
      const auditRows = (await client.query("SELECT action FROM audit_events ORDER BY created_at, action")).rows;
      const actions = auditRows.map((r: { action: string }) => r.action);
      expect(actions).toEqual([
        "plugin.upgrade_preflighted",
        "plugin.upgrade_approved",
        "plugin.upgrade_quiesced",
        "plugin.upgrade_migrated",
        "plugin.upgrade_activated",
        "plugin.upgrade_observed",
        "plugin.upgrade_completed",
      ]);
    } finally {
      if (created) {
        await client.query("RESET search_path");
        await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      client.release();
    }
  });

  it("handles controlled rollback and prevents irreversible schema rollback (UPD-05)", async () => {
    const client = await getDbPool().connect();
    const schemaName = "upgrade_rollback_" + randomUUID().replaceAll("-", "");
    const pluginId = randomUUID();
    const audit = { actorUserId: "operator-" + randomUUID(), requestId: "req-" + randomUUID() };
    let created = false;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      created = true;
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          version text NOT NULL, status text NOT NULL, capabilities jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
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
         VALUES ($1, 'rollback-ext', '1.0.0', 'inactive', '["events.subscribe", "old.perm"]'::jsonb)`,
        [pluginId],
      );

      await client.query(migration("0047_plugin_upgrade_plans.sql"));
      await client.query(migration("0048_plugin_upgrade_preflight_approval.sql"));

      const repository = new DrizzlePluginUpgradePlanRepository(
        () => drizzle(client, { schema }),
      );

      const receipt = (ver: string, hash: string, lock: string) => ({
        schemaVersion: 1,
        signatureVerified: true,
        publicKeySha256: fingerprints.signer,
        lockfileSha256: lock,
        releases: [{
          pluginId: "rollback-ext",
          version: ver,
          sha256: hash,
          adminViewCount: 0,
        }],
      });

      const staged = await repository.stage({
        pluginId,
        sourceAdmission: receipt("1.0.0", fingerprints.source, fingerprints.sourceLock),
        targetAdmission: receipt("2.0.0", fingerprints.target, fingerprints.targetLock),
        targetManifest: {
          id: "rollback-ext",
          version: "2.0.0",
          capabilities: ["events.subscribe", "new.perm"],
        },
      });

      const preflighted = await repository.preflight({
        pluginId, planId: staged.id, expectedPlanSha256: staged.planSha256, expectedRevision: 1,
      }, audit);

      await repository.approve({
        pluginId, planId: staged.id, expectedPlanSha256: staged.planSha256, expectedRevision: 2,
        expectedPreflightSha256: preflighted.preflightSha256!,
        decision: "approve",
        reviewedCapabilitiesAdded: ["new.perm"],
        reviewedCapabilitiesRemoved: ["old.perm"],
      }, audit);

      await repository.quiesce({
        pluginId, planId: staged.id, expectedPlanSha256: staged.planSha256, expectedRevision: 3,
      }, audit);

      await repository.migrate({
        pluginId, planId: staged.id, expectedPlanSha256: staged.planSha256, expectedRevision: 4,
      }, audit);

      await repository.activate({
        pluginId, planId: staged.id, expectedPlanSha256: staged.planSha256, expectedRevision: 5,
      }, audit);

      // Verify active version is 2.0.0
      const [activatedRow] = (await client.query("SELECT version, capabilities FROM plugins WHERE id=$1", [pluginId])).rows;
      expect(activatedRow.version).toBe("2.0.0");
      expect(activatedRow.capabilities).toEqual(["events.subscribe", "new.perm"]);

      // If irreversible migrations occurred without down-migration, rollback must be rejected (UPD-05)
      await expect(repository.rollback({
        pluginId, planId: staged.id, expectedPlanSha256: staged.planSha256, expectedRevision: 6,
      }, audit, { hasIrreversibleMigrations: true })).rejects.toMatchObject({
        code: "PLUGIN_UPGRADE_IRREVERSIBLE_MIGRATION",
      });

      // Rollback with safe down-migration runner restores 1.0.0
      let downRan = false;
      const rolledBack = await repository.rollback({
        pluginId, planId: staged.id, expectedPlanSha256: staged.planSha256, expectedRevision: 6,
      }, audit, {
        hasIrreversibleMigrations: true,
        downMigrationRunner: async () => {
          downRan = true;
        },
      });
      expect(downRan).toBe(true);
      expect(rolledBack.status).toBe("aborted");
      expect(rolledBack.revision).toBe(7);

      // Verify plugins table was restored to 1.0.0 and old capabilities
      const [restoredRow] = (await client.query("SELECT version, capabilities FROM plugins WHERE id=$1", [pluginId])).rows;
      expect(restoredRow.version).toBe("1.0.0");
      expect(restoredRow.capabilities).toEqual(["events.subscribe", "old.perm"]);

      // Verify audit logged rollback
      const [auditEntry] = (await client.query("SELECT action FROM audit_events WHERE action='plugin.upgrade_rolled_back'")).rows;
      expect(auditEntry.action).toBe("plugin.upgrade_rolled_back");
    } finally {
      if (created) {
        await client.query("RESET search_path");
        await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      client.release();
    }
  });

  it("proves data-preserving uninstall retains data and separate audited purge removes all data (UPD-06)", async () => {
    const client = await getDbPool().connect();
    const schemaName = "upgrade_purge_" + randomUUID().replaceAll("-", "");
    const pluginId = randomUUID();
    const audit = { actorUserId: "operator-" + randomUUID(), requestId: "req-" + randomUUID() };
    let created = false;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      created = true;
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          name text NOT NULL DEFAULT 'Purge Test',
          version text NOT NULL DEFAULT '1.0.0', vibress_api_version text NOT NULL DEFAULT '1.0.0',
          description text, entrypoint text NOT NULL DEFAULT 'index.js',
          status text NOT NULL DEFAULT 'inactive', capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
          hooks jsonb NOT NULL DEFAULT '[]'::jsonb,
          settings_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_publication_states (
          plugin_id text NOT NULL, publication_id text NOT NULL DEFAULT 'pub-1',
          enabled boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (plugin_id, publication_id)
        );
        CREATE TABLE plugin_publication_settings (
          id text PRIMARY KEY, plugin_id text NOT NULL, publication_id text NOT NULL,
          key text NOT NULL, value text, encrypted_value text, is_secret boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_settings (
          id text PRIMARY KEY, plugin_id text NOT NULL,
          key text NOT NULL, value text, encrypted_value text, is_secret boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_schema_migrations (
          id text PRIMARY KEY, plugin_id text NOT NULL, manifest_id text NOT NULL,
          migration_id text NOT NULL, schema_version integer NOT NULL,
          package_version text NOT NULL, artifact_sha256 text NOT NULL,
          migration_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_storage_models (
          id text PRIMARY KEY, plugin_id text NOT NULL, manifest_id text NOT NULL,
          migration_id text NOT NULL, model_key text NOT NULL,
          storage_mode text NOT NULL, schema_sha256 text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE plugin_storage_physical_models (
          plugin_id text NOT NULL, model_key text NOT NULL,
          table_name text NOT NULL, schema_sha256 text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (plugin_id, model_key)
        );
        CREATE TABLE plugin_member_records (
          record_id text NOT NULL, plugin_id text NOT NULL, publication_id text NOT NULL,
          member_id text NOT NULL, model_key text NOT NULL, fields jsonb NOT NULL,
          version integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (plugin_id, publication_id, member_id, model_key, record_id)
        );
        CREATE TABLE plugin_event_receipts (
          id text PRIMARY KEY, plugin_id text NOT NULL, status text NOT NULL,
          publication_id text, event_id text NOT NULL DEFAULT 'evt-1',
          event_type text NOT NULL DEFAULT 'test',
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE audit_events (
          id text PRIMARY KEY, publication_id text,
          actor_user_id text, request_id text, action text NOT NULL,
          target_type text, target_id text, metadata jsonb,
          ip_address text, user_agent text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      await client.query(migration("0047_plugin_upgrade_plans.sql"));
      await client.query(migration("0048_plugin_upgrade_preflight_approval.sql"));

      // Seed plugin with stored data across all tables
      await client.query(
        "INSERT INTO plugins(id, manifest_id, status) VALUES ($1, 'purge-plugin', 'inactive')",
        [pluginId],
      );
      await client.query(
        "INSERT INTO plugin_publication_states(plugin_id, publication_id, enabled) VALUES ($1, 'pub-1', false)",
        [pluginId],
      );
      await client.query(
        "INSERT INTO plugin_publication_settings(id, plugin_id, publication_id, key, value) VALUES ($1, $2, 'pub-1', 'api_key', 'val')",
        [randomUUID(), pluginId],
      );
      await client.query(
        "INSERT INTO plugin_member_records(record_id, plugin_id, publication_id, member_id, model_key, fields) VALUES ('r-1', $1, 'pub-1', 'm-1', 'grades', '{\"score\": 95}')",
        [pluginId],
      );
      await client.query(
        "INSERT INTO plugin_storage_models(id, plugin_id, manifest_id, migration_id, model_key, storage_mode, schema_sha256) VALUES ($1, $2, 'purge-plugin', '001', 'grades', 'member', $3)",
        [randomUUID(), pluginId, "a".repeat(64)],
      );

      const drizzleDb = drizzle(client, { schema });
      const repo = new DrizzlePluginRepository(() => drizzleDb as any);
      const service = new PluginsService(repo);

      // Explicit purge while active is rejected
      await client.query("UPDATE plugins SET status='active' WHERE id=$1", [pluginId]);
      await expect(service.purgePluginData(pluginId, audit)).rejects.toMatchObject({
        code: "PLUGIN_ACTIVE",
      });
      await client.query("UPDATE plugins SET status='inactive' WHERE id=$1", [pluginId]);

      // Direct purge call on DrizzlePluginRepository using test db
      await repo.purgePluginData(pluginId, audit);

      // Verify all records for pluginId are purged
      const memberRows = (await client.query("SELECT * FROM plugin_member_records WHERE plugin_id=$1", [pluginId])).rows;
      expect(memberRows).toHaveLength(0);
      const settingsRows = (await client.query("SELECT * FROM plugin_publication_settings WHERE plugin_id=$1", [pluginId])).rows;
      expect(settingsRows).toHaveLength(0);
      const storageRows = (await client.query("SELECT * FROM plugin_storage_models WHERE plugin_id=$1", [pluginId])).rows;
      expect(storageRows).toHaveLength(0);
      const pluginRows = (await client.query("SELECT * FROM plugins WHERE id=$1", [pluginId])).rows;
      expect(pluginRows).toHaveLength(0);

      // Verify audit recorded plugin.data_purged
      const purgeAudit = (await client.query("SELECT action, target_id FROM audit_events WHERE action='plugin.data_purged'")).rows;
      expect(purgeAudit).toHaveLength(1);
      expect(purgeAudit[0].target_id).toBe(pluginId);
    } finally {
      if (created) {
        await client.query("RESET search_path");
        await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      client.release();
    }
  });
});
