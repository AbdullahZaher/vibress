import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool, runMigrations, seedDatabase } from "@vibress/database";
import { listPluginActivity, pluginEventEnvelopeHash, pluginEventJobId } from "@vibress/plugins";
import { PluginActivityListQuerySchema, PluginActivityListResponseSchema,
  PluginWorkerEventJobSchema } from "@vibress/api-contracts";

/** Real PostgreSQL regression for the same bounded query used by Admin. */
describe("PLUG-OPS-06 historical audit, publication and plugin isolation", () => {
  const pluginId = randomUUID();
  const foreignPluginId = randomUUID();
  const auditIds: string[] = [];
  let publicationId: string;
  let validReceipt = "";

  beforeAll(async () => {
    await runMigrations();
    await seedDatabase();
    const pool = getDbPool();
    const row = await pool.query<{ id: string }>("SELECT id FROM publications LIMIT 1");
    if (!row.rows[0]) throw new Error("No publication in seeded database");
    publicationId = row.rows[0].id;
    for (const id of [pluginId, foreignPluginId]) {
      await pool.query(
        `INSERT INTO plugins (id, manifest_id, name, version, vibress_api_version, entrypoint)
         VALUES ($1, $2, 'Audit Fixture', '1.0.0', '1.0.0', 'dist/index.mjs')`,
        [id, "audit-" + id.slice(0, 24)],
      );
    }
    const insertReceipt = async (id: string) => {
      const envelope = PluginWorkerEventJobSchema.parse({
        schemaVersion: 1, scope: "publication", pluginId: id, publicationId,
        manifestId: "audit-" + id.slice(0, 24), pluginVersion: "1.0.0",
        artifactSha256: "a".repeat(64), eventId: randomUUID(),
        eventName: "post.published", payload: { confidential: "never-return-this" },
      });
      const receiptId = pluginEventJobId(envelope);
      await pool.query(
        `INSERT INTO plugin_event_receipts
         (id, event_id, plugin_id, publication_id, envelope_hash, envelope)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [receiptId, envelope.eventId, id, publicationId,
          pluginEventEnvelopeHash(envelope), JSON.stringify(envelope)],
      );
      return receiptId;
    };
    validReceipt = await insertReceipt(pluginId);
    const foreignReceipt = await insertReceipt(foreignPluginId);
    const insertAudit = async (action: string, pub: string, type: string,
      target: string, date: string) => {
      const id = randomUUID();
      auditIds.push(id);
      await pool.query(
        `INSERT INTO audit_events
         (id, publication_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [id, pub, action, type, target,
          JSON.stringify({ pluginId, token: "never-return-this", secret: "private-value" }),
          date],
      );
    };
    const t = "2026-10-25T10:00:00.000Z";
    await insertAudit("plugin.publication_settings_updated", publicationId,
      "plugin", pluginId, t);
    await insertAudit("plugin.publication_secret_revoked", publicationId,
      "plugin", pluginId, t);
    await insertAudit("plugin.event_replay_requested", publicationId,
      "plugin_event", validReceipt, t);
    // Metadata is not authority: spoofing pluginId cannot bypass the
    // receipt-owned plugin and publication boundary.
    await insertAudit("plugin.event_replay_requested", publicationId,
      "plugin_event", foreignReceipt, t);
    await insertAudit("plugin.publication_settings_updated", "other-publication",
      "plugin", pluginId, t);
    await insertAudit("plugin.publication_secret_revoked", publicationId,
      "plugin", foreignPluginId, t);
    await insertAudit("plugin.unknown_unreviewed_action", publicationId,
      "plugin", pluginId, t);
  }, 30000);

  afterAll(async () => {
    const pool = getDbPool();
    await pool.query("DELETE FROM audit_events WHERE id = ANY($1::text[])", [auditIds]);
    await pool.query("DELETE FROM plugin_event_receipts WHERE plugin_id = ANY($1::text[])",
      [[pluginId, foreignPluginId]]);
    await pool.query("DELETE FROM plugins WHERE id = ANY($1::text[])",
      [[pluginId, foreignPluginId]]);
    await closeDbPool();
  });

  it("shows only whitelisted actions, correct owner, and no sensitive metadata", async () => {
    const results = await listPluginActivity(publicationId, pluginId, 0, 25);
    expect(results.nextOffset).toBeNull();
    expect(results.items).toHaveLength(3);
    expect(results.items.map(x => x.action).sort()).toEqual([
      "plugin.event_replay_requested",
      "plugin.publication_secret_revoked",
      "plugin.publication_settings_updated",
    ]);
    expect(PluginActivityListResponseSchema.parse(results)).toEqual(results);
    const serialized = JSON.stringify(results);
    for (const sensitive of [pluginId, foreignPluginId, publicationId,
      validReceipt, "never-return-this", "private-value", "metadata", "actorUserId"]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it("paginates without cross-publication or cross-plugin leakage", async () => {
    const first = await listPluginActivity(publicationId, pluginId, 0, 2);
    expect(first.items).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const second = await listPluginActivity(publicationId, pluginId, 2, 2);
    expect(second.items).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
    expect(await listPluginActivity("unknown-publication", pluginId, 0, 25))
      .toEqual({ items: [], nextOffset: null });
    expect((await listPluginActivity(publicationId, foreignPluginId, 0, 25)).items)
      .toHaveLength(1);
  });

  it("rejects invalid pagination and tenant override in shared request contract", () => {
    for (const bad of [
      { offset: "-1" }, { offset: "10001" }, { limit: "26" },
      { limit: "0" }, { publicationId: "other-publication" },
    ]) expect(PluginActivityListQuerySchema.safeParse(bad).success).toBe(false);
  });
});
