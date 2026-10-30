import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDbPool, schema } from "@vibress/database";
import {
  DrizzleMarketplaceAdmissionRepository,
  MarketplaceAdmissionError,
  parseDurableMarketplaceAdmission,
} from "../src/infrastructure/drizzle-marketplace-admissions.js";
import { validateMarketplaceAdmissionRefresh } from "../src/runtime/tier2-process-supervisor.js";

const migration = () => readFileSync(resolve(
  process.cwd(), "packages/database/migrations/0049_plugin_marketplace_admissions.sql",
), "utf8");

const sha = "a".repeat(64);

describe("M8.8 durable Marketplace release admission — PostgreSQL", () => {
  it("rejects malformed or insufficient authorization documents at runtime", () => {
    const valid = {
      pluginId: "plugin_1",
      releaseDigest: "sha256:" + sha,
      trustTier: "untrusted_marketplace",
      publisherId: "publisher_1",
      releaseDirectory: "/opt/vibress/releases/plugin_1",
      allowedEntrypoints: ["/opt/vibress/releases/plugin_1/index.js"],
      releaseArtifactManifest: { "index.js": sha },
      approvedPublicationIds: ["pub_a"],
      approvedCapabilities: ["extension.storage.read"],
    };
    expect(parseDurableMarketplaceAdmission(valid)).toEqual(valid);
    for (const hostile of [
      { ...valid, trustTier: "curated_operator" },
      { ...valid, pluginId: "plugin_2", approvedPublicationIds: [] },
      { ...valid, releaseArtifactManifest: {} },
      { ...valid, releaseArtifactManifest: { "index.js": "0" } },
      { ...valid, approvedPublicationIds: ["pub_a", "pub_a"] },
      { ...valid, approvedCapabilities: ["extension.storage.read", "extension.storage.read"] },
      { ...valid, leakedSecret: "no" },
    ]) {
      expect(() => parseDurableMarketplaceAdmission(hostile))
        .toThrow(MarketplaceAdmissionError);
    }
  });

  it("retains a scoped, audited, monotonic policy across two DB clients and refuses revoked approvals", async () => {
    const pool = getDbPool();
    const clientA = await pool.connect();
    const clientB = await pool.connect();
    const schemaName = "marketplace_admission_" + randomUUID().replaceAll("-", "");
    const pluginId = randomUUID();
    const pubA = randomUUID();
    const pubB = randomUUID();
    let created = false;
    try {
      await clientA.query(`CREATE SCHEMA "${schemaName}"`);
      created = true;
      await clientA.query(`SET search_path TO "${schemaName}"`);
      await clientB.query(`SET search_path TO "${schemaName}"`);
      await clientA.query(`
        CREATE TABLE plugins (id text PRIMARY KEY, status text NOT NULL);
        CREATE TABLE plugin_publication_states (
          plugin_id text NOT NULL, publication_id text NOT NULL,
          enabled boolean NOT NULL DEFAULT false
        );
        CREATE TABLE audit_events (
          id text PRIMARY KEY, publication_id text,
          actor_user_id text, request_id text, action text NOT NULL,
          target_type text, target_id text, metadata jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await clientA.query(migration());
      await clientA.query(readFileSync(resolve(
        process.cwd(), "packages/database/migrations/0050_plugin_marketplace_publisher_revocations.sql",
      ), "utf8"));
      await clientA.query("INSERT INTO plugins(id,status) VALUES ($1,'active')", [pluginId]);
      await clientA.query(
        "INSERT INTO plugin_publication_states(plugin_id,publication_id,enabled) VALUES ($1,$2,true),($1,$3,false)",
        [pluginId, pubA, pubB],
      );

      const a = new DrizzleMarketplaceAdmissionRepository(() => drizzle(clientA, { schema }));
      const b = new DrizzleMarketplaceAdmissionRepository(() => drizzle(clientB, { schema }));
      const policy = {
        pluginId,
        releaseDigest: "sha256:" + sha,
        trustTier: "untrusted_marketplace" as const,
        publisherId: "publisher_verified",
        releaseDirectory: "/opt/vibress/immutable/plugin",
        allowedEntrypoints: ["/opt/vibress/immutable/plugin/index.js"],
        releaseArtifactManifest: { "index.js": sha },
        approvedPublicationIds: [pubA],
        approvedCapabilities: ["extension.storage.read"],
      };
      const audit = { actorUserId: "operator_test", requestId: randomUUID() };
      expect(await a.loadMarketplaceAdmission(pluginId, pubA)).toBeNull();
      await expect(a.approveOperatorRelease(
        { ...policy, approvedPublicationIds: [pubA, pubB] }, 0, audit,
      )).rejects.toMatchObject({ code: "MARKETPLACE_PUBLICATION_NOT_ACTIVE" });
      const first = await a.approveOperatorRelease(policy, 0, audit);
      expect(first.policyRevision).toBe(1);
      const replicaRead = await b.loadMarketplaceAdmission(pluginId, pubA);
      expect(replicaRead).toMatchObject({
        pluginId, releaseDigest: policy.releaseDigest, policyRevision: 1,
        approvedPublicationIds: [pubA],
      });
      expect(await b.loadMarketplaceAdmission(pluginId, pubB)).toBeNull();
      await expect(b.approveOperatorRelease(policy, 0, audit))
        .rejects.toMatchObject({ code: "MARKETPLACE_REVISION_CONFLICT" });

      const second = await b.approveOperatorRelease({
        ...policy, approvedCapabilities: [],
      }, 1, audit);
      expect(second.policyRevision).toBe(2);
      expect(() => validateMarketplaceAdmissionRefresh(pluginId, second, first))
        .toThrowError(/UNTRUSTED_ADMISSION_STALE/);

      expect(await a.revokeOperatorRelease(pluginId, 2, audit)).toBe(3);
      expect(await b.loadMarketplaceAdmission(pluginId, pubA)).toBeNull();
      await expect(b.approveOperatorRelease(policy, 3, audit))
        .rejects.toMatchObject({ code: "MARKETPLACE_REVOKED_CANNOT_REACTIVATE" });
      await expect(a.revokeOperatorRelease(pluginId, 2, audit))
        .rejects.toMatchObject({ code: "MARKETPLACE_REVISION_CONFLICT" });

      const row = await clientA.query(
        "SELECT policy_revision, revoked FROM plugin_marketplace_admissions WHERE plugin_id=$1",
        [pluginId],
      );
      expect(row.rows[0]).toMatchObject({ policy_revision: "3", revoked: true });
      const pluginAfterRevocation = randomUUID();
      await clientA.query("INSERT INTO plugins(id,status) VALUES ($1,'active')", [pluginAfterRevocation]);
      await clientA.query(
        "INSERT INTO plugin_publication_states(plugin_id,publication_id,enabled) VALUES ($1,$2,true)",
        [pluginAfterRevocation, pubA],
      );
      const otherApproved = await a.approveOperatorRelease({
        ...policy, pluginId: pluginAfterRevocation,
      }, 0, audit);
      expect(otherApproved.policyRevision).toBe(1);
      // The durable tombstone revokes EVERY approved release of this publisher.
      expect(await b.revokeOperatorPublisher("publisher_verified", audit, "compromised")).toBe(1);
      expect(await a.revokeOperatorPublisher("publisher_verified", audit)).toBe(0);
      expect(await a.loadMarketplaceAdmission(pluginAfterRevocation, pubA)).toBeNull();
      const publisherRevoked = await clientA.query(
        "SELECT policy_revision, revoked FROM plugin_marketplace_admissions WHERE plugin_id=$1",
        [pluginAfterRevocation],
      );
      expect(publisherRevoked.rows[0]).toMatchObject({ policy_revision: "2", revoked: true });

      const newPluginAfterBan = randomUUID();
      await clientA.query("INSERT INTO plugins(id,status) VALUES ($1,'active')", [newPluginAfterBan]);
      await clientA.query(
        "INSERT INTO plugin_publication_states(plugin_id,publication_id,enabled) VALUES ($1,$2,true)",
        [newPluginAfterBan, pubA],
      );
      await expect(a.approveOperatorRelease({
        ...policy, pluginId: newPluginAfterBan,
      }, 0, audit)).rejects.toMatchObject({ code: "MARKETPLACE_PUBLISHER_REVOKED" });
      expect(await b.loadMarketplaceAdmission(pluginId, pubA)).toBeNull();

      const auditRows = await clientA.query(
        "SELECT action FROM audit_events ORDER BY created_at, id",
      );
      expect(auditRows.rows.map((record: { action: string }) => record.action).sort()).toEqual([
        "plugin.marketplace_admission_approved",
        "plugin.marketplace_admission_approved",
        "plugin.marketplace_admission_approved",
        "plugin.marketplace_admission_revoked",
        "plugin.marketplace_publisher_revoked",
      ]);

      await clientA.query(
        "UPDATE plugin_marketplace_admissions SET revoked=false, publisher_id='publisher_corruption_probe', admission='{}'::jsonb WHERE plugin_id=$1",
        [pluginId],
      );
      await expect(b.loadMarketplaceAdmission(pluginId, pubA))
        .rejects.toMatchObject({ code: "MARKETPLACE_ADMISSION_INVALID" });
    } finally {
      if (created) {
        await clientA.query('SET search_path TO public');
        await clientB.query('SET search_path TO public');
        await clientA.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      clientA.release();
      clientB.release();
    }
  });
});
