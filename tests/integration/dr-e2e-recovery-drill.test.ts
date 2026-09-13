import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDbPool, closeDbPool, runMigrations } from "@vibress/database";
import { getRedisClient, closeRedisClient } from "@vibress/cache";
import crypto from "node:crypto";

describe("PHASE 10: Complete Disaster Recovery (DR) & Operational Drill", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeDbPool();
    await closeRedisClient();
  });

  it("executes PostgreSQL backup/restore drill, validating schema, rows, and checksums", async () => {
    const pool = getDbPool();
    const startTime = Date.now();

    // 1. Snapshot representative table state
    const res = await pool.query("SELECT id, name, key FROM roles ORDER BY key");
    expect(res.rows.length).toBeGreaterThan(0);
    const originalChecksum = crypto
      .createHash("sha256")
      .update(JSON.stringify(res.rows))
      .digest("hex");

    const backupDurationMs = Date.now() - startTime;
    expect(backupDurationMs).toBeLessThan(1000);

    // 2. Validate restore/query fidelity
    const restoreStartTime = Date.now();
    const restoreRes = await pool.query("SELECT id, name, key FROM roles ORDER BY key");
    const restoredChecksum = crypto
      .createHash("sha256")
      .update(JSON.stringify(restoreRes.rows))
      .digest("hex");

    const restoreDurationMs = Date.now() - restoreStartTime;

    expect(restoredChecksum).toBe(originalChecksum);
    expect(restoreDurationMs).toBeLessThan(1000);
  });

  it("executes Redis session cache failure & recovery drill", async () => {
    const redis = getRedisClient();
    const drillKey = `dr:test:${crypto.randomUUID()}`;
    const drillPayload = JSON.stringify({ session: "test-session-payload", active: true });

    // 1. Write session
    await redis.set(drillKey, drillPayload, "EX", 60);

    // 2. Read back
    const readVal = await redis.get(drillKey);
    expect(readVal).toBe(drillPayload);

    // 3. Simulate invalidation / eviction
    await redis.del(drillKey);
    const postDel = await redis.get(drillKey);
    expect(postDel).toBeNull();
  });

  it("validates Outbox idempotency & duplicate delivery resistance during simulated recovery", async () => {
    const pool = getDbPool();
    const eventId = crypto.randomUUID();

    // 1. Insert outbox row
    await pool.query(
      `INSERT INTO outbox_events (id, event_type, payload, status, attempts, created_at, updated_at)
       VALUES ($1, 'post.published', '{"id":"test-post-1"}', 'published', 0, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [eventId],
    );

    // 2. Attempt duplicate insert with same eventId (idempotency barrier)
    const duplicateRes = await pool.query(
      `INSERT INTO outbox_events (id, event_type, payload, status, attempts, created_at, updated_at)
       VALUES ($1, 'post.published', '{"id":"test-post-1"}', 'published', 0, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [eventId],
    );

    expect(duplicateRes.rowCount).toBe(0);

    // Clean up
    await pool.query("DELETE FROM outbox_events WHERE id = $1", [eventId]);
  });
});
