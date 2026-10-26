/**
 * M1A PG/Redis/BullMQ crash-boundary integration drill on an entirely
 * disposable GitHub-hosted CI runner. Uses the PRODUCTION ledger, relay and
 * admission/identity gate. Side effects use a counting stub and disposable
 * PostgreSQL attempt sink; no external plugin module is ever imported.
 *
 * Docker faults are confined to the namespaced compose.dev.yml project.
 * NOT a release-attestation or exactly-once external side-effect test.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getDbPool, closeDbPool } from "@vibress/database";
import { closeRedisClient } from "@vibress/cache";
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
// A separate committed fixture sink models an external effect that is NOT
// atomic with the production PostgreSQL receipt finalization.
async function recordSimulatedSideEffect(id: string): Promise<void> {
  await getDbPool().query(
    "INSERT INTO public.m1a_drill_effect_attempts (job_id) VALUES ($1)", [id],
  );
}
async function simulatedSideEffectCount(id: string): Promise<number> {
  const result = await getDbPool().query<{ total: number }>(
    "SELECT count(*)::integer AS total FROM public.m1a_drill_effect_attempts WHERE job_id = $1",
    [id],
  );
  return result.rows[0]?.total ?? 0;
}
async function startConsumer(effectJobId?: string) {
  if (consumer) throw new Error("PLUGIN_M1A_EVENT_DRILL_CONSUMER_ALREADY_RUNNING");
  consumer = new Worker<PluginWorkerEventJob>(
    QUEUE_NAMES.PLUGIN_EVENTS,
    async (queued) => processAdmittedPluginEvent(
      queued.data, queued.id, pluginEventLedger, {
        getPlugin: (id) => pluginRepo.findById(id),
        approvedDigests: async () => new Map([[manifestId, digest]]),
        isPublicationEnabled: (id, pub) => publicationStates.isEnabled(id, pub),
        dispatchEvent: async (_pluginId, _eventName, payload) => {
          handlerCalls++;
          // Simulated transient failure BEFORE an external side effect.
          if (handlerCalls === 1) throw new Error("DRILL_TRANSIENT_PROVIDER_FAILURE");
          if (effectJobId) {
            if (typeof payload !== "object" || payload === null ||
                !("m1aEffectKey" in payload) || payload.m1aEffectKey !== effectJobId) {
              throw new Error("PLUGIN_M1A_UNEXPECTED_EFFECT_FIXTURE");
            }
            await recordSimulatedSideEffect(effectJobId);
          }
          successfulEffects++;
        },
      },
    ),
    { connection: getBullMqRedisConnection(), concurrency: 1 },
  );
  await consumer.waitUntilReady();
}
/**
 * Real OS-process termination at the admitted handler boundary. This child
 * runs the production PostgreSQL admission/release/tenant gate, then dies
 * before any external side effect or durable finalization. Its orphaned
 * BullMQ active job must be recovered by the normal stalled-job mechanism.
 */
async function runCrashConsumer(): Promise<void> {
  const afterEffect = process.argv.includes("--crash-after-effect-consumer");
  const expectedJobId = process.env.VIBRESS_M1A_CRASH_JOB_ID;
  const expectedManifestId = process.env.VIBRESS_M1A_CRASH_MANIFEST_ID;
  if (!expectedJobId?.startsWith("plugin-") ||
      !/^[0-9a-f]{64}$/.test(expectedJobId.slice(7)) ||
      !expectedManifestId?.startsWith("event-drill-")) {
    throw new Error("PLUGIN_M1A_INVALID_CRASH_CONSUMER_CONFIG");
  }
  const worker = new Worker<PluginWorkerEventJob>(
    QUEUE_NAMES.PLUGIN_EVENTS,
    async (queued) => {
      if (queued.id !== expectedJobId) {
        throw new Error("PLUGIN_M1A_CRASH_CONSUMER_UNEXPECTED_JOB");
      }
      return processAdmittedPluginEvent(queued.data, queued.id, pluginEventLedger, {
        getPlugin: (id) => pluginRepo.findById(id),
        approvedDigests: async () => new Map([[expectedManifestId, digest]]),
        isPublicationEnabled: (id, pub) => publicationStates.isEnabled(id, pub),
        dispatchEvent: async () => {
          // The second crash mode commits a simulated downstream effect
          // independently of the receipt, then SIGKILL prevents finalization.
          if (afterEffect) await recordSimulatedSideEffect(expectedJobId);
          // Flush an untrusted-data-free marker before SIGKILL; the process
          // cannot run a finally block, ACK Redis, or finalize PostgreSQL.
          await new Promise<void>((resolve, reject) => {
            process.stdout.write("PLUGIN_M1A_CHILD_HANDLER_ENTERED\\n", (error) => {
              if (error) reject(new Error("PLUGIN_M1A_CRASH_MARKER_WRITE_FAILED"));
              else resolve();
            });
          });
          process.kill(process.pid, "SIGKILL");
          await new Promise<void>(() => {});
        },
      });
    },
    { connection: getBullMqRedisConnection(), concurrency: 1 },
  );
  await worker.waitUntilReady();
  // A healthy worker must stay alive until its admitted handler is reached.
  await new Promise<void>(() => {});
}

async function crashDuringAdmittedDispatch(id: string, afterEffect = false): Promise<void> {
  let reachedHandler = false;
  // Spawn the Node process itself, not a pnpm wrapper: its observed
  // SIGKILL must be the signal of the process that held the BullMQ lease.
  const child = spawn(
    process.execPath, ["--import=tsx", "scripts/plugins/drill-event-delivery.ts",
      afterEffect ? "--crash-after-effect-consumer" : "--crash-consumer"],
    {
      cwd: root,
      env: {
        ...process.env,
        VIBRESS_M1A_CRASH_JOB_ID: id,
        VIBRESS_M1A_CRASH_MANIFEST_ID: manifestId,
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (text: string) => {
    if (text.includes("PLUGIN_M1A_CHILD_HANDLER_ENTERED")) reachedHandler = true;
  });
  const signal = await new Promise<string | null>((resolveSignal, reject) => {
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("PLUGIN_M1A_CRASH_CONSUMER_TIMEOUT"));
    }, 30_000);
    child.once("error", () => {
      clearTimeout(deadline);
      reject(new Error("PLUGIN_M1A_CRASH_CONSUMER_START_FAILED"));
    });
    // 'close' waits until stdout is drained, unlike 'exit'.
    child.once("close", (_code, exitSignal) => {
      clearTimeout(deadline);
      resolveSignal(exitSignal);
    });
  });
  if (signal !== "SIGKILL" || !reachedHandler) {
    throw new Error("PLUGIN_M1A_CRASH_CONSUMER_DID_NOT_DIE_IN_HANDLER");
  }
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
  // The whole Docker project is disposable, including this simulation table.
  // This table is not a production schema or a plugin-facing API.
  await pool.query("CREATE TABLE public.m1a_drill_effect_attempts (job_id text NOT NULL)");
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
  stage("verify-pg-lease-after-restart");
  // The first query on the pre-outage pg Pool can fail while PostgreSQL
  // evicts old TCP sessions. Retry reads within a bounded window, but never
  // accept a wrong state or synthesize a receipt; a missing row still fails.
  await assertEventually("PostgreSQL receipt survives restart", async () => {
    try { return await receiptStatus(second) === "dispatching"; }
    catch { return false; }
  }, 30000);
  stage("verify-redis-job-after-pg-restart");
  await assertEventually("Redis retains exact stable job ID", async () =>
    Boolean(await (await realQueue()).getJob(secondId)), 15000);
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

  // Kill an ENTIRE processing OS process after authorization but before
  // acknowledging/finalizing. On restart, BullMQ must reclaim the stalled
  // active job (not invent another PostgreSQL admission) and retry it.
  // The controlled handler has NO external side effect before SIGKILL.
  stage("prepare-process-crash-fixture");
  await consumer?.close(true);
  consumer = null;
  const interrupted = job();
  const interruptedId = await pluginEventLedger.admit(interrupted);
  await ageReceipt(interruptedId);
  const admittedClaim = await claim(interruptedId);
  await relayClaimedPluginEvent(admittedClaim, pluginEventLedger,
    (receipt) => publish(receipt.id, receipt.envelope));
  if (await receiptStatus(interrupted) !== "queued") {
    throw new Error("PLUGIN_M1A_CRASH_FIXTURE_NOT_QUEUED");
  }
  stage("kill-real-worker-in-admitted-handler");
  await crashDuringAdmittedDispatch(interruptedId);
  if (await receiptStatus(interrupted) !== "queued") {
    throw new Error("PLUGIN_M1A_WORKER_CRASH_LOST_DURABLE_RECEIPT");
  }
  stage("restart-worker-and-reclaim-stalled-bullmq-job");
  await startConsumer();
  await assertEventually("stalled job redelivered and receipt finalized", async () =>
    await receiptStatus(interrupted) === "executed" && successfulEffects === 3,
  105_000);
  if (successfulEffects !== 3 || handlerCalls !== 4) {
    throw new Error("PLUGIN_M1A_WORKER_CRASH_UNSAFE_REDELIVERY");
  }
  if ((await (await realQueue()).getJob(interruptedId))?.id !== interruptedId) {
    throw new Error("PLUGIN_M1A_WORKER_CRASH_REDIS_JOB_LOST");
  }
  console.info("PLUGIN_M1A_EVENT_STAGE: real SIGKILL of admitted Worker; BullMQ stalled-job recovery and PG finalization");

  // A second real-process SIGKILL occurs AFTER a committed simulated external
  // effect but BEFORE the original receipt can be finalized. BullMQ must
  // deliver the SAME job again; a non-idempotent handler runs its effect twice.
  stage("prepare-post-effect-crash-fixture");
  await consumer?.close(true);
  consumer = null;
  const postEffectEventId = randomUUID();
  const postEffectId = pluginEventJobId(job(postEffectEventId));
  const postEffect = job(postEffectEventId, {
    payload: { marker: "disposable-drill", m1aEffectKey: postEffectId },
  });
  if (await pluginEventLedger.admit(postEffect) !== postEffectId) {
    throw new Error("PLUGIN_M1A_POST_EFFECT_ADMISSION_FAILED");
  }
  await ageReceipt(postEffectId);
  const postEffectClaim = await claim(postEffectId);
  await relayClaimedPluginEvent(postEffectClaim, pluginEventLedger,
    (receipt) => publish(receipt.id, receipt.envelope));
  if (await receiptStatus(postEffect) !== "queued") {
    throw new Error("PLUGIN_M1A_POST_EFFECT_FIXTURE_NOT_QUEUED");
  }
  stage("kill-real-worker-after-committed-side-effect");
  await crashDuringAdmittedDispatch(postEffectId, true);
  if (await receiptStatus(postEffect) !== "queued" ||
      await simulatedSideEffectCount(postEffectId) !== 1) {
    throw new Error("PLUGIN_M1A_POST_EFFECT_CRASH_BOUNDARY_NOT_PROVEN");
  }
  stage("reclaim-post-effect-crash-and-observe-duplicate-effect");
  await startConsumer(postEffectId);
  await assertEventually("post-effect crash redelivered and finalized", async () =>
    await receiptStatus(postEffect) === "executed" &&
      await simulatedSideEffectCount(postEffectId) === 2, 105_000);
  if (handlerCalls !== 5 || successfulEffects !== 4 ||
      (await (await realQueue()).getJob(postEffectId))?.id !== postEffectId ||
      await simulatedSideEffectCount(postEffectId) !== 2) {
    throw new Error("PLUGIN_M1A_POST_EFFECT_REDELIVERY_NOT_PROVEN");
  }
  await publish(postEffectId, postEffect);
  await delay(500);
  if (await simulatedSideEffectCount(postEffectId) !== 2) {
    throw new Error("PLUGIN_M1A_POST_EFFECT_FINALIZED_JOB_REEXECUTED");
  }
  console.info("PLUGIN_M1A_EVENT_STAGE: SIGKILL after committed synthetic effect; same job redelivered, two side-effect attempts, one finalized receipt");

  console.info("PLUGIN_M1A_EVENT_DELIVERY_PASSED: PG/Redis faults, tenant/release fencing, pre-effect and post-effect SIGKILL, stalled-job recovery and proven at-least-once side effects");
}
async function executeAndClose(): Promise<void> {
try {
  await main();
} catch {
  // Only a predetermined stage label is printed. No DB error, event ID,
  // envelope, password or plugin-provided string is emitted.
  console.error("PLUGIN_M1A_EVENT_DELIVERY_FAILED_AT: " + diagnosticStage);
  process.exitCode = 1;
} finally {
  // Only bound RESOURCE CLEANUP, not the actual 180-second fault drill.
  const cleanupDeadline = setTimeout(() => {
    console.error("PLUGIN_M1A_EVENT_DELIVERY_CLEANUP_TIMEOUT");
    process.exit(1); // Only the disposable CI runner; shell trap drops volumes.
  }, 12000);
  // Keep this deadline referenced: DB pool shutdown must not stall the
  // disposable CI runner when a connection was severed during fault injection.
  try {
  if (consumer) {
    try { await consumer.close(true); } catch { process.exitCode = 1; }
  }
  if (queue) {
    try { await queue.close(); } catch { process.exitCode = 1; }
  }
  // BullMQ closes its Queue/Worker owners but not the shared Redis
  // connection supplied by @vibress/cache. Keeping it open leaves the
  // otherwise-successful CI drill alive until the external timeout.
  try { await closeRedisClient(); } catch { process.exitCode = 1; }
  // Only fixture owned by this disposable run, never a real tenant row.
  if (publicationId) {
    try {
      await getDbPool().query("DELETE FROM plugin_event_receipts WHERE plugin_id = $1", [pluginId]);
      await getDbPool().query("DELETE FROM plugin_publication_states WHERE plugin_id = $1", [pluginId]);
      await getDbPool().query("DELETE FROM plugins WHERE id = $1", [pluginId]);
    } catch { process.exitCode = 1; }
  }
  try {
    await getDbPool().query("DROP TABLE IF EXISTS public.m1a_drill_effect_attempts");
  } catch { process.exitCode = 1; }
  await closeDbPool();
  } finally {
    clearTimeout(cleanupDeadline);
  }
}
}
if (process.argv.includes("--crash-consumer") ||
    process.argv.includes("--crash-after-effect-consumer")) {
  void runCrashConsumer().catch(() => {
    console.error("PLUGIN_M1A_CHILD_FAILED"); // Static redacted error.
    process.exitCode = 1;
  });
} else {
  void executeAndClose().catch(() => {
    console.error("PLUGIN_M1A_EVENT_DELIVERY_FAILED: cleanup incomplete");
    process.exitCode = 1;
  });
}
