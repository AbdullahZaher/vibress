/**
 * M1A PG/Redis/BullMQ crash-boundary integration drill on an entirely
 * disposable GitHub-hosted CI runner. Uses the PRODUCTION ledger, relay and
 * admission/identity gate. Dispatch side effects are a counting stub;
 * no unreviewed external plugin module is ever imported.
 *
 * Docker faults are confined to the namespaced compose.dev.yml project.
 * NOT a release-attestation or exactly-once external side-effect test.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getDbPool, closeDbPool } from "@vibress/database";
import { PluginWorkerEventJobSchema, type PluginWorkerEventJob } from "@vibress/api-contracts";
import {
  DrizzlePluginRepository, DrizzlePluginPublicationStateRepository,
  pluginEventLedger, pluginEventJobId,
} from "@vibress/plugins";
import { Queue, Worker, QUEUE_NAMES, getBullMqRedisConnection } from "@vibress/queue";
import { processAdmittedPluginEvent, relayClaimedPluginEvent } from "../../apps/worker/src/processors/plugin-event-worker";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true" ||
    process.env.VIBRESS_M1A_DISPOSABLE_DRILL !== "1" ||
    !/^[0-9]{1,20}$/.test(process.env.GITHUB_RUN_ID ?? "") ||
    process.env.NODE_ENV !== "development" ||
    process.env.DATABASE_URL !== "postgresql://vibress:vibress@127.0.0.1:5433/vibress" ||
    process.env.REDIS_URL !== "redis://127.0.0.1:6380" ||
    process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE !== undefined) {
  throw new Error("PLUGIN_M1A_EVENT_DRILL_REQUIRES_DISPOSABLE_CI");
}

const project = `vibress-m1a-${process.env.GITHUB_RUN_ID}`;
const root = resolve(process.cwd());
const compose = (...args: string[]) => {
  execFileSync("docker", ["compose", "-p", project, "-f", "compose.dev.yml", ...args], {
    cwd: root, stdio: "ignore", timeout: 90000,
  });
};
const digest = "a".repeat(64);
const pluginId = randomUUID();
const manifestId = "event-drill-" + pluginId.slice(0, 12);
const pluginRepo = new DrizzlePluginRepository();
const publicationStates = new DrizzlePluginPublicationStateRepository();
let publicationId = "";
let queue: Queue<PluginWorkerEventJob> | null = null;
let consumer: Worker<PluginWorkerEventJob> | null = null;
let handlerCalls = 0;
let successfulEffects = 0;
let diagnosticStage = "initialize";
function stage(name: string): void {
  diagnosticStage = name; // Only code-owned static stage identifiers.
  console.info("PLUGIN_M1A_EVENT_STAGE: " + name);
}

async function assertEventually(
  description: string, condition: () => Promise<boolean>, timeoutMs = 35000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await delay(200);
  }
  throw new Error("PLUGIN_M1A_EVENT_DRILL_TIMEOUT: " + description);
}
function job(eventId = randomUUID(), changes: Partial<PluginWorkerEventJob> = {}) {
  return PluginWorkerEventJobSchema.parse({
    schemaVersion: 1, scope: "publication", pluginId, publicationId,
    manifestId, pluginVersion: "1.0.0", artifactSha256: digest,
    eventId, eventName: "post.published",
    payload: { marker: "disposable-drill" }, ...changes,
  });
}
async function ageReceipt(id: string, lease = "10 seconds") {
  // Restricted to the randomly-created fixture row in the disposable DB.
  await getDbPool().query(
    `UPDATE plugin_event_receipts
     SET created_at = now() - interval '100 years',
         updated_at = now() - $2::interval
     WHERE id = $1 AND plugin_id = $3 AND publication_id = $4`,
    [id, lease, pluginId, publicationId],
  );
}
async function claim(id: string) {
  const claimed = await pluginEventLedger.claimReady(1);
  const row = claimed.find((entry) => entry.id === id);
  if (!row) throw new Error("PLUGIN_M1A_EVENT_DRILL_EXPECTED_CLAIM");
  return row;
}
async function receiptStatus(item: PluginWorkerEventJob) {
  return (await pluginEventLedger.getReceipt(publicationId, pluginId, item.eventId))?.status;
}
async function realQueue() {
  if (!queue) throw new Error("PLUGIN_M1A_EVENT_DRILL_QUEUE_NOT_READY");
  return queue;
}
async function startConsumer() {
  if (consumer) throw new Error("PLUGIN_M1A_EVENT_DRILL_CONSUMER_ALREADY_RUNNING");
  consumer = new Worker<PluginWorkerEventJob>(
    QUEUE_NAMES.PLUGIN_EVENTS,
    async (queued) => processAdmittedPluginEvent(
      queued.data, queued.id, pluginEventLedger, {
        getPlugin: (id) => pluginRepo.findById(id),
        approvedDigests: async () => new Map([[manifestId, digest]]),
        isPublicationEnabled: (id, pub) => publicationStates.isEnabled(id, pub),
        dispatchEvent: async () => {
          handlerCalls++;
          // Simulated transient failure BEFORE an external side effect.
          if (handlerCalls === 1) throw new Error("DRILL_TRANSIENT_PROVIDER_FAILURE");
          successfulEffects++;
        },
      },
    ),
    { connection: getBullMqRedisConnection(), concurrency: 1 },
  );
  await consumer.waitUntilReady();
}
async function publish(id: string, item: PluginWorkerEventJob) {
  const q = await realQueue();
  await q.add("event", item, {
    jobId: id, attempts: 3, backoff: { type: "fixed", delay: 300 },
    removeOnComplete: false, removeOnFail: false,
  });
}
async function main() {
  const pool = getDbPool();
  const selected = await pool.query<{ id: string }>("SELECT id FROM publications LIMIT 1");
  const pub = selected.rows[0];
  if (!pub) throw new Error("PLUGIN_M1A_EVENT_DRILL_NO_SEEDED_PUBLICATION");
  publicationId = pub.id;
  await pluginRepo.create({
    id: pluginId, manifestId, name: "Disposable Event Transport Drill",
    version: "1.0.0", vibressApiVersion: "1.0.0", entrypoint: "dist/index.mjs",
    capabilities: ["events.subscribe"], hooks: ["post.published"],
    settingsSchema: {},
  });
  await pluginRepo.updateStatus(pluginId, "active");
  await publicationStates.setEnabled(pluginId, publicationId, true);

  const first = job();
  const firstId = pluginEventJobId(first);
  if (await pluginEventLedger.admit(first) !== firstId ||
      await pluginEventLedger.admit(first) !== firstId) {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_ADMISSION_DEDUP_FAILED");
  }
  await ageReceipt(firstId);
  await claim(firstId);
  console.info("PLUGIN_M1A_EVENT_STAGE: durable PostgreSQL admission and claim");

  // Redis unavailable after DB admission and claim. The receipt MUST remain
  // durable and not be misrepresented as queued or executed.
  compose("stop", "redis");
  if (await receiptStatus(first) !== "dispatching") {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_LOST_POSTGRES_ADMISSION");
  }
  compose("up", "-d", "--wait", "redis");
  // Advance only the fixture's dispatch lease to prove the production
  // reclaim path without sleeping for two minutes.
  await ageReceipt(firstId, "3 minutes");
  const reclaimed = await claim(firstId);
  console.info("PLUGIN_M1A_EVENT_STAGE: Redis outage and claim recovery");
  queue = new Queue<PluginWorkerEventJob>(QUEUE_NAMES.PLUGIN_EVENTS, {
    connection: getBullMqRedisConnection(),
  });
  await queue.waitUntilReady();
  if (await relayClaimedPluginEvent(reclaimed, pluginEventLedger,
      (row) => publish(row.id, row.envelope)) !== "enqueued") {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_RELAY_FAILED");
  }

  // Queue job remains durable with no consumer, then is handled by the same
  // production admission and version checks used by the actual Worker.
  if (!(await queue.getJob(firstId)) || await receiptStatus(first) !== "queued") {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_QUEUE_NOT_DURABLE");
  }
  await startConsumer();
  await assertEventually("retry then finalize", async () =>
    await receiptStatus(first) === "executed" && successfulEffects === 1);
  if (handlerCalls !== 2 || successfulEffects !== 1) {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_UNSAFE_RETRY");
  }
  console.info("PLUGIN_M1A_EVENT_STAGE: BullMQ handler retry and finalization");
  await publish(firstId, first); // stable ID, still present in Redis
  await delay(500);
  if (successfulEffects !== 1) throw new Error("PLUGIN_M1A_EVENT_DRILL_DUPLICATE_EFFECT");

  // Even a correctly shaped and version-pinned Redis job cannot execute
  // without its exact immutable PG admission for the chosen publication.
  const unadmitted = job(randomUUID(), { publicationId: "foreign-publication" });
  const unadmittedId = pluginEventJobId(unadmitted);
  await publish(unadmittedId, unadmitted);
  await assertEventually("unadmitted job consumed", async () =>
    (await (await realQueue()).getJob(unadmittedId))?.getState().then(
      (state) => state === "completed",
    ) ?? false);
  if (successfulEffects !== 1 ||
      await pluginEventLedger.getReceipt("foreign-publication", pluginId, unadmitted.eventId)) {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_CROSS_PUBLICATION_EXECUTION");
  }

  console.info("PLUGIN_M1A_EVENT_STAGE: unadmitted cross-publication job denied");
  // PostgreSQL fails AFTER Redis accepted a second job. The dispatcher
  // must not return its claimed receipt to pending on acknowledgement
  // failure. Reclaim the lease after restore; BullMQ keeps one stable job ID.
  stage("stop-first-consumer");
  await consumer?.close(true);
  consumer = null;
  stage("prepare-postgres-outage-event");
  const second = job();
  const secondId = await pluginEventLedger.admit(second);
  await ageReceipt(secondId);
  const secondClaim = await claim(secondId);
  await publish(secondId, secondClaim.envelope);
  stage("stop-postgres-after-bullmq-publish");
  compose("stop", "postgres");
  let dbRejected = false;
  try { await pluginEventLedger.markQueued(secondId); }
  catch { dbRejected = true; }
  if (!dbRejected) throw new Error("PLUGIN_M1A_EVENT_DRILL_EXPECTED_DB_OUTAGE");
  stage("restore-postgres");
  compose("up", "-d", "--wait", "postgres");
  stage("verify-durable-redis-and-postgres-lease");
  if (await receiptStatus(second) !== "dispatching" ||
      !(await (await realQueue()).getJob(secondId))) {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_LOST_POST_REDIS_LEASE");
  }
  stage("reclaim-dispatching-postgres-lease");
  await ageReceipt(secondId, "3 minutes");
  const secondReclaimed = await claim(secondId);
  stage("idempotently-republish-bullmq-job");
  await relayClaimedPluginEvent(secondReclaimed, pluginEventLedger,
    (row) => publish(row.id, row.envelope));
  if ((await (await realQueue()).getJobs(["waiting", "active", "delayed"]))
      .filter((item) => item.id === secondId).length !== 1) {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_DUPLICATE_REDIS_JOB");
  }
  console.info("PLUGIN_M1A_EVENT_STAGE: PostgreSQL ack outage and lease reclaim");
  await startConsumer();
  await assertEventually("post DB outage finalization", async () =>
    await receiptStatus(second) === "executed" && successfulEffects === 2);
  if (successfulEffects !== 2) throw new Error("PLUGIN_M1A_EVENT_DRILL_DUPLICATE_EFFECT");

  stage("post-outage-bullmq-finalized");
  // Mismatched approved artifact fingerprint must fail closed; a complete
  // BullMQ job with a valid PG receipt is insufficient for execution.
  const mismatched = job(randomUUID(), { artifactSha256: "b".repeat(64) });
  const mismatchId = await pluginEventLedger.admit(mismatched);
  await publish(mismatchId, mismatched);
  await assertEventually("release mismatch rejected", async () =>
    (await (await realQueue()).getJob(mismatchId))?.getState().then(
      (state) => state === "failed",
    ) ?? false);
  if (successfulEffects !== 2 ||
      await receiptStatus(mismatched) !== "pending") {
    throw new Error("PLUGIN_M1A_EVENT_DRILL_RELEASE_MISMATCH_EXECUTED");
  }

  console.info("PLUGIN_M1A_EVENT_DELIVERY_PASSED: real PG admission, Redis reclaim, BullMQ retry/de-dup, PG ack-outage replay, tenant denial and release mismatch");
}
async function executeAndClose(): Promise<void> {
  // The CI runner may have broken connection handles after a fault. Bound
  // shutdown even after failure, so a green stage never masks a hanging job.
  const cleanupDeadline = setTimeout(() => {
    console.error("PLUGIN_M1A_EVENT_DELIVERY_CLEANUP_TIMEOUT");
    process.exit(1); // Restricted disposable CI runner; outer trap drops volumes.
  }, 12000);
  cleanupDeadline.unref();
try {
  await main();
} catch {
  // Only a predetermined stage label is printed. No DB error, event ID,
  // envelope, password or plugin-provided string is emitted.
  console.error("PLUGIN_M1A_EVENT_DELIVERY_FAILED_AT: " + diagnosticStage);
  process.exitCode = 1;
} finally {
  if (consumer) {
    try { await consumer.close(true); } catch { process.exitCode = 1; }
  }
  if (queue) {
    try { await queue.close(); } catch { process.exitCode = 1; }
  }
  // Only fixture owned by this disposable run, never a real tenant row.
  if (publicationId) {
    try {
      await getDbPool().query("DELETE FROM plugin_event_receipts WHERE plugin_id = $1", [pluginId]);
      await getDbPool().query("DELETE FROM plugin_publication_states WHERE plugin_id = $1", [pluginId]);
      await getDbPool().query("DELETE FROM plugins WHERE id = $1", [pluginId]);
    } catch { process.exitCode = 1; }
  }
  await closeDbPool();
}
  clearTimeout(cleanupDeadline);
}
void executeAndClose().catch(() => {
  console.error("PLUGIN_M1A_EVENT_DELIVERY_FAILED: cleanup incomplete");
  process.exitCode = 1;
});
