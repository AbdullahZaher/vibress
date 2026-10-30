import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getDbPool, runMigrations, seedDatabase, closeDbPool } from "@vibress/database";
import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import {
  pluginEventEnvelopeHash, pluginEventJobId, readPluginReceiptDiagnostics,
} from "@vibress/plugins";

describe("PLUG-OPS-06 bounded PostgreSQL receipt diagnosis", () => {
  const pluginId = randomUUID();
  const manifestId = "receipt-probe-" + pluginId.slice(0, 12);
  let publicationId: string;

  beforeAll(async () => {
    await runMigrations();
    await seedDatabase();
    const pool = getDbPool();
    const existing = await pool.query<{ id: string }>("SELECT id FROM publications LIMIT 1");
    if (!existing.rows[0]) throw new Error("Missing test publication");
    publicationId = existing.rows[0].id;
    await pool.query(
      `INSERT INTO plugins (id, manifest_id, name, version, vibress_api_version, entrypoint)
       VALUES ($1, $2, 'Receipt Probe Fixture', '1.0.0', '1.0.0', 'dist/plugin.mjs')`,
      [pluginId, manifestId],
    );
    for (const state of ["pending", "dispatching"] as const) {
      const envelope = PluginWorkerEventJobSchema.parse({
        schemaVersion: 1, scope: "publication",
        pluginId, publicationId, manifestId, pluginVersion: "1.0.0",
        artifactSha256: "a".repeat(64), eventId: randomUUID(),
        eventName: "post.published", payload: { postId: "never-expose-payload-in-metrics" },
      });
      await pool.query(
        `INSERT INTO plugin_event_receipts
         (id, event_id, plugin_id, publication_id, envelope_hash, envelope,
          status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7,
                 now() - interval '50 years', now() - interval '10 minutes')`,
        [pluginEventJobId(envelope), envelope.eventId, pluginId, publicationId,
          pluginEventEnvelopeHash(envelope), JSON.stringify(envelope), state],
      );
    }
  }, 30000);

  afterAll(async () => {
    const pool = getDbPool();
    await pool.query("DELETE FROM plugin_event_receipts WHERE plugin_id = $1", [pluginId]);
    await pool.query("DELETE FROM plugins WHERE id = $1", [pluginId]);
    await closeDbPool();
  });

  it("detects stale durable admissions with index-bounded, identity-free results", async () => {
    const report = await readPluginReceiptDiagnostics();
    expect(report.sampleLimit).toBe(250);
    expect(report.pending.sampled).toBeGreaterThanOrEqual(1);
    expect(report.dispatching.sampled).toBeGreaterThanOrEqual(1);
    expect(report.pending.staleSampled).toBeGreaterThanOrEqual(1);
    expect(report.dispatching.staleSampled).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(pluginId);
    expect(serialized).not.toContain(publicationId);
    expect(serialized).not.toContain("never-expose-payload-in-metrics");
    expect(serialized).not.toContain("envelope");
  });
});
