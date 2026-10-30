import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getDbPool, runMigrations, seedDatabase, closeDbPool } from "@vibress/database";
import {
  DrizzlePluginEventLedger, pluginEventJobId,
} from "@vibress/plugins";
import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";

describe("EXT-401 scoped failed-event recovery ledger (PostgreSQL)", () => {
  const pluginId = randomUUID();
  const manifestId = "replay-check-" + pluginId.slice(0, 8);
  let publicationId: string;
  const ledger = new DrizzlePluginEventLedger();

  beforeAll(async () => {
    await runMigrations();
    await seedDatabase();
    const pool = getDbPool();
    const result = await pool.query<{ id: string }>("SELECT id FROM publications LIMIT 1");
    const publication = result.rows[0];
    if (!publication) throw new Error("Test database has no publication after seeding");
    publicationId = publication.id;
    await pool.query(
      `INSERT INTO plugins (id, manifest_id, name, version, vibress_api_version, entrypoint)
       VALUES ($1, $2, 'Recovery Fixture', '1.0.0', '1.0.0', 'dist/index.mjs')`,
      [pluginId, manifestId],
    );
  }, 30000);

  afterAll(async () => {
    const pool = getDbPool();
    await pool.query(
      `DELETE FROM audit_events WHERE action = 'plugin.event_replay_requested'
       AND target_id LIKE 'plugin-%' AND metadata->>'pluginId' = $1`,
      [pluginId],
    );
    await pool.query("DELETE FROM plugin_event_receipts WHERE plugin_id = $1", [pluginId]);
    await pool.query("DELETE FROM plugins WHERE id = $1", [pluginId]);
    await closeDbPool();
  });

  it("recovers a crashed DB-to-Redis relay claim without losing admission", async () => {
    const job = PluginWorkerEventJobSchema.parse({
      schemaVersion: 1, scope: "publication",
      publicationId, pluginId, manifestId,
      pluginVersion: "1.0.0", artifactSha256: "a".repeat(64),
      eventId: randomUUID(), eventName: "post.published",
      payload: { postId: "private-recovery-fixture" },
    });
    const id = pluginEventJobId(job);
    const pool = getDbPool();

    // A committed PG admission remains durable even when no Redis enqueue
    // happened; duplicate retries preserve the same immutable receipt.
    expect(await ledger.admit(job)).toBe(id);
    expect(await ledger.admit({ ...job })).toBe(id);
    await expect(ledger.admit({
      ...job, payload: { postId: "modified-duplicate" },
    })).rejects.toThrow("Event ID is already bound to a different envelope");

    // Simulate the publisher crashing before Redis accepted a job.
    // The integration database is shared by the test suite. Give our own
    // receipt the earliest claim order, and claim exactly one row so the test
    // cannot transition unrelated fixtures' durable admissions.
    await pool.query(
      `UPDATE plugin_event_receipts
       SET created_at = now() - interval '100 years',
           updated_at = now() - interval '10 seconds'
       WHERE id = $1`,
      [id],
    );
    const first = await ledger.claimReady(1);
    expect(first.some((entry) => entry.id === id)).toBe(true);
    expect((await ledger.getReceipt(publicationId, pluginId, job.eventId))?.status)
      .toBe("dispatching");

    // Simulate the other crash boundary: Redis may have accepted the job,
    // but markQueued() never returned. Reclaim only AFTER the lease expires.
    // Inspect our receipt only: calling claimReady here could mutate another
    // fixture while our fresh dispatching lease is still held.
    const immediate = await pool.query<{ id: string }>(
      `SELECT id FROM plugin_event_receipts WHERE id = $1
       AND ((status = 'pending' AND updated_at <= now() - interval '5 seconds')
         OR (status = 'dispatching' AND updated_at <= now() - interval '2 minutes'))`,
      [id],
    );
    expect(immediate.rows).toHaveLength(0);
    await pool.query(
      "UPDATE plugin_event_receipts SET updated_at = now() - interval '3 minutes' WHERE id = $1",
      [id],
    );
    const reclaimed = await ledger.claimReady(1);
    expect(reclaimed.some((entry) => entry.id === id)).toBe(true);
    await ledger.markQueued(id);
    expect((await ledger.getReceipt(publicationId, pluginId, job.eventId))?.status)
      .toBe("queued");

    // Mark/failure callbacks racing after a consumer already completed must
    // never resurrect a terminal delivery.
    await ledger.finalize(id, "executed");
    await ledger.markQueued(id);
    await ledger.returnPending(id);
    expect((await ledger.getReceipt(publicationId, pluginId, job.eventId))?.status)
      .toBe("executed");
    expect(await ledger.isAdmitted(job)).toBe(false);
  });

  it("audit is atomic, scoped, and refuses executed or cross-publication replays", async () => {
    const job = PluginWorkerEventJobSchema.parse({
      schemaVersion: 1, scope: "publication",
      pluginId, publicationId, manifestId,
      pluginVersion: "1.0.0", artifactSha256: "a".repeat(64),
      eventId: randomUUID(), eventName: "post.published",
      payload: { postId: "sensitive-test-post" },
    });
    const id = pluginEventJobId(job);
    const audit = { actorUserId: "authorized-operator", requestId: randomUUID() };
    const pool = getDbPool();
    await expect(ledger.admit(job)).resolves.toBe(id);
    expect(await ledger.getReceipt("foreign-publication", pluginId, job.eventId)).toBeNull();
    expect(await ledger.recordReplayRequest(
      publicationId, pluginId, job.eventId, "b".repeat(64), audit,
    )).toBe(false);
    // A receipt only becomes replay-eligible after it was actually queued.
    const receipt = await ledger.getReceipt(publicationId, pluginId, job.eventId);
    expect(receipt?.status).toBe("pending");
    await pool.query(
      "UPDATE plugin_event_receipts SET status = 'queued' WHERE id = $1",
      [id],
    );
    expect(await ledger.listQueuedEventIds(publicationId, pluginId, 0, 10))
      .toEqual([job.eventId]);
    expect(await ledger.listQueuedEventIds("foreign-publication", pluginId, 0, 10))
      .toEqual([]);
    expect(await ledger.listQueuedEventIds(publicationId, "foreign-plugin", 0, 10))
      .toEqual([]);
    await expect(ledger.listQueuedEventIds(publicationId, pluginId, 0, 51))
      .rejects.toThrow();
    const { pluginEventEnvelopeHash } = await import("@vibress/plugins");
    const hash = pluginEventEnvelopeHash(job);
    expect(await ledger.recordReplayRequest(
      "foreign-publication", pluginId, job.eventId, hash, audit,
    )).toBe(false);
    expect(await ledger.recordReplayRequest(
      publicationId, pluginId, job.eventId, hash, audit,
    )).toBe(true);
    const logged = await pool.query<{ request_id: string; metadata: unknown }>(
      `SELECT request_id, metadata FROM audit_events
       WHERE action = 'plugin.event_replay_requested' AND target_id = $1`, [id],
    );
    expect(logged.rows).toHaveLength(1);
    expect(logged.rows[0]?.request_id).toBe(audit.requestId);
    expect(JSON.stringify(logged.rows[0]?.metadata)).not.toContain("sensitive-test-post");
    await ledger.finalize(id, "executed");
    expect(await ledger.listQueuedEventIds(publicationId, pluginId, 0, 10))
      .toEqual([]);
    expect(await ledger.recordReplayRequest(
      publicationId, pluginId, job.eventId, hash, audit,
    )).toBe(false);
    const again = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE target_id = $1", [id],
    );
    expect(Number(again.rows[0]?.count)).toBe(1);
  });
});
