import { getDb, closeDbPool, pluginEventReceipts, and, asc, eq, sql } from "@vibress/database";
import { Queue, QUEUE_NAMES, getBullMqRedisConnection } from "@vibress/queue";
import {
  assessQueueRecovery, type QueueRecoveryState,
} from "@vibress/plugins";
import type { PluginWorkerEventJob } from "@vibress/api-contracts";

/** EXT-403: inspect ONLY, while all API/Worker replicas are quiesced after
 * restoring signed PostgreSQL + approved artifacts. Run check-restore first.
 * This does not mutate/acknowledge/erase/requeue jobs or execute plugin code.
 * Nonzero exit means an operator must reconcile before starting replicas.
 */
async function main(): Promise<void> {
  if (process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE !== "1") {
    throw new Error("PLUGIN_RECOVERY_MAINTENANCE_REQUIRED");
  }
  const limitText = process.env.VIBRESS_PLUGIN_RESTORE_SCAN_LIMIT ?? "100000";
  if (!/^[1-9][0-9]{0,5}$/.test(limitText)) throw new Error("PLUGIN_RESTORE_SCAN_LIMIT_INVALID");
  const maxRows = Number(limitText);
  if (!Number.isSafeInteger(maxRows) || maxRows > 100000) {
    throw new Error("PLUGIN_RESTORE_SCAN_LIMIT_INVALID");
  }
  const queue = new Queue<PluginWorkerEventJob>(QUEUE_NAMES.PLUGIN_EVENTS, {
    connection: getBullMqRedisConnection(),
  });
  let cursor = "";
  let checked = 0;
  let breached = false;
  const counts: Record<QueueRecoveryState, number> = {
    admitted: 0, failed: 0, missing: 0, terminal: 0, invalid: 0,
  };
  try {
    await queue.waitUntilReady();
    const db = getDb();
    // Cursor pagination is stable with all normal replicas stopped.
    for (;;) {
      const rows = await db.select({
        id: pluginEventReceipts.id,
        envelope: pluginEventReceipts.envelope,
        envelopeHash: pluginEventReceipts.envelopeHash,
      }).from(pluginEventReceipts).where(and(
        eq(pluginEventReceipts.status, "queued"),
        sql`${pluginEventReceipts.id} > ${cursor}`,
      )).orderBy(asc(pluginEventReceipts.id)).limit(Math.min(100, maxRows - checked + 1));

      if (!rows.length) break;
      if (checked + rows.length > maxRows) {
        breached = true;
        break;
      }
      // Cap concurrent Redis lookups rather than issuing an unbounded scan.
      for (let offset = 0; offset < rows.length; offset += 10) {
        const batch = rows.slice(offset, offset + 10);
        const states = await Promise.all(batch.map(async (receipt) => {
          const job = await queue.getJob(receipt.id);
          if (!job) return assessQueueRecovery(receipt, null);
          return assessQueueRecovery(receipt, {
            id: job.id, data: job.data, state: await job.getState(),
          });
        }));
        for (const state of states) counts[state]++;
      }
      checked += rows.length;
      const last = rows.at(-1);
      if (!last) break;
      cursor = last.id;
    }
    // Never print payloads, tenant identifiers or Redis connection secrets.
    console.info("Trusted plugin queue recovery check", { checked, ...counts });
    if (breached || counts.invalid || counts.missing || counts.terminal ||
        counts.failed) {
      // Failed tasks require explicit, audited per-event operator replay
      // after the root cause is fixed; nothing is replayed here.
      throw new Error("PLUGIN_QUEUE_RECONCILIATION_REQUIRED");
    }
  } finally {
    await queue.close();
  }
}

void main().catch(() => {
  console.error("Plugin queue restore validation failed; keep normal replicas stopped");
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
