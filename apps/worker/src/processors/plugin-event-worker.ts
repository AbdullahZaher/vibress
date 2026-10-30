import {
  Worker, Queue, QUEUE_NAMES, getBullMqRedisConnection, enqueueTraced,
} from "@vibress/queue";
import {
  PluginWorkerEventJobSchema, type PluginWorkerEventJob,
} from "@vibress/api-contracts";
import {
  PluginsService,
  PluginDomainError,
  DrizzlePluginRepository,
  DrizzlePluginSettingRepository,
  DrizzlePluginPublicationStateRepository,
  DrizzlePluginPublicationSettingRepository,
  TrustedExternalPluginHost, verifyTrustedPluginRelease, verifyOperatorReleaseAdmission,
  pluginEventLedger, pluginEventJobId, readPluginReceiptDiagnostics,
  type Plugin, type PluginHost, type ClaimedPluginEvent,
} from "@vibress/plugins";
import { tracedProcessor } from "./trace-helper";
import { metrics } from "@vibress/observability";
import { observePluginReceiptBacklog } from "./plugin-receipt-metrics";

export interface PluginEventExecution {
  getPlugin(id: string): Promise<Plugin | null>;
  approvedDigests(): Promise<ReadonlyMap<string, string>>;
  isPublicationEnabled(pluginId: string, publicationId: string): Promise<boolean>;
  dispatchEvent(
    pluginId: string, eventName: string, payload: unknown, publicationId?: string,
  ): Promise<void>;
}

/**
 * Fail closed before loading external code if this job has been superseded,
 * disabled, or moved to another publication. Corrupt jobs throw for bounded
 * retry/dead-letter handling, not arbitrary dispatch.
 */
export async function processTrustedPluginEvent(
  input: unknown, execution: PluginEventExecution,
): Promise<"executed" | "retired"> {
  const job = PluginWorkerEventJobSchema.parse(input);
  const plugin = await execution.getPlugin(job.pluginId);
  if (!plugin || plugin.status !== "active" ||
      plugin.manifestId !== job.manifestId ||
      plugin.version !== job.pluginVersion ||
      !plugin.capabilities.includes("events.subscribe") ||
      (!plugin.hooks.includes(job.eventName) && !plugin.hooks.includes("onEvent"))) {
    return "retired";
  }
  // Fingerprints come only from the currently authenticated operator release
  // lockfile, never the queued message. A mismatch is retryable rather than
  // irreversible: a stale replica must not finalize a new release's event.
  const digests = await execution.approvedDigests();
  if (digests.get(plugin.manifestId) !== job.artifactSha256) {
    // This worker may be running an older approved snapshot while the DB
    // already describes the new active release. Do not permanently retire
    // the durable admission: another replica may legitimately deliver it.
    // Retrying is fail-closed; exhausted attempts remain visible for replay.
    throw new Error("PLUGIN_WORKER_RELEASE_MISMATCH");
  }
  if (!(await execution.isPublicationEnabled(plugin.id, job.publicationId))) {
    return "retired";
  }
  try {
    await execution.dispatchEvent(
      plugin.id, job.eventName, { ...job.payload, publicationId: job.publicationId },
      job.publicationId,
    );
  } catch (error) {
    if (error instanceof PluginDomainError && [
      "PLUGIN_NOT_FOUND",
      "PLUGIN_INACTIVE",
      "PLUGIN_PUBLICATION_INACTIVE",
      "PLUGIN_RELEASE_CHANGED",
      "PLUGIN_CAPABILITY_DENIED",
    ].includes(error.code)) return "retired";
    // A missing local approval or mixed-release module state must retry on a
    // compatible replica rather than permanently retire a durable receipt.
    // Provider outages, transient DB failures and handler errors also retry.
    // Handlers must tolerate at-least-once delivery.
    throw error;
  }
  return "executed";
}

export interface PluginEventReceiptGate {
  isAdmitted(job: PluginWorkerEventJob): Promise<boolean>;
  finalize(id: string, outcome: "executed" | "retired"): Promise<void>;
}

/** Redis jobs may be forged, stale, or restored without their PG admission.
 * The trusted worker never executes one lacking the matching receipt. */
export async function processAdmittedPluginEvent(
  input: unknown,
  jobId: string | undefined,
  receipts: PluginEventReceiptGate,
  execution: PluginEventExecution,
): Promise<"executed" | "retired" | "unadmitted"> {
  const parsed = PluginWorkerEventJobSchema.parse(input);
  if (!jobId || jobId !== pluginEventJobId(parsed) ||
      !(await receipts.isAdmitted(parsed))) {
    return "unadmitted";
  }
  const outcome = await processTrustedPluginEvent(parsed, execution);
  await receipts.finalize(jobId, outcome);
  return outcome;
}

/**
 * The worker's Host adapter must propagate the admitted release identity
 * through the final trusted import boundary. Silently omitting the second
 * argument would let a changed lockfile import replacement ESM before the
 * service detects it. Keep this adapter explicitly unit-testable.
 */
export function createTrustedWorkerPluginHost(
  operatorHost: Pick<TrustedExternalPluginHost, "loadModule" | "listTrustedFingerprints">,
): PluginHost {
  return {
    loadModule: (plugin, expectedReleaseKey) =>
      operatorHost.loadModule(plugin, expectedReleaseKey),
    requiresPublicationEnablement: () => true,
    getOperatorAdminFingerprints: () => operatorHost.listTrustedFingerprints(),
  };
}

/**
 * PostgreSQL is the durable outbox. A Redis admission can succeed while
 * the subsequent DB markQueued fails. That failure must NOT reset the
 * dispatch claim to pending; wait for the existing bounded lease reclaim,
 * when BullMQ's stable job ID can de-duplicate the retry.
 *
 * Only an actual Redis publication error warrants returning the claim to
 * pending immediately. The caller owns safe metrics/logging.
 */
export async function relayClaimedPluginEvent(
  receipt: Pick<ClaimedPluginEvent, "id" | "envelope">,
  ledger: Pick<typeof pluginEventLedger, "markQueued" | "returnPending">,
  publish: (job: Pick<ClaimedPluginEvent, "id" | "envelope">) => Promise<unknown>,
): Promise<"enqueued" | "retry"> {
  try {
    await publish(receipt);
  } catch {
    await ledger.returnPending(receipt.id);
    return "retry";
  }
  // Do not treat a failure here as Redis failure: the job may be running
  // already. Retain the dispatching lease; retrying it is crash-safe.
  await ledger.markQueued(receipt.id);
  return "enqueued";
}

export class PluginEventWorker {
  private worker: Worker<PluginWorkerEventJob> | null = null;
  private producer: Queue<PluginWorkerEventJob> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweep: Promise<void> | null = null;
  private ready = false;
  private nextReceiptProbeAt = 0;

  /** The base DB/Redis health probe alone does not prove event consumption. */
  isReady(): boolean {
    return process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE
      ? this.ready
      : process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE !== "1";
  }
  private readonly operatorHost = new TrustedExternalPluginHost();
  private readonly repository = new DrizzlePluginRepository();
  private readonly service = new PluginsService(
    this.repository,
    new DrizzlePluginSettingRepository(),
    createTrustedWorkerPluginHost(this.operatorHost),
    new DrizzlePluginPublicationStateRepository(),
    new DrizzlePluginPublicationSettingRepository(),
  );

  async start(): Promise<void> {
    // Only replicas with an explicit operator-approved release mount may
    // execute external plugin code. The default worker remains bundled-only.
    const policy = process.env.VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY;
    if (policy !== undefined && policy !== "strict") {
      throw new Error("Unsupported trusted plugin admission policy");
    }
    if (!process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE) {
      if (process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE === "1" ||
          policy === "strict") {
        throw new Error("Trusted plugin release mount required");
      }
      return;
    }
    if (policy === "strict") {
      const expected = process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256;
      if (!expected) throw new Error("Strict operator admission requires pinned release");
      await verifyOperatorReleaseAdmission(process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE, expected);
    } else {
      await verifyTrustedPluginRelease(process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE);
    }
    // Reject an unmigrated database before opening the BullMQ consumer:
    // otherwise unadmitted pre-migration jobs could be silently consumed.
    await pluginEventLedger.assertReady();
    this.producer = new Queue<PluginWorkerEventJob>(QUEUE_NAMES.PLUGIN_EVENTS, {
      connection: getBullMqRedisConnection(),
    });
    this.worker = new Worker<PluginWorkerEventJob>(
      QUEUE_NAMES.PLUGIN_EVENTS,
      tracedProcessor("worker.job.plugin-event", async (job) => {
        const outcome = await processAdmittedPluginEvent(job.data, job.id, pluginEventLedger, {
          getPlugin: (id) => this.repository.findById(id),
          approvedDigests: () => this.operatorHost.listTrustedFingerprints(),
          isPublicationEnabled: (id, pubId) => this.service.isPublicationEnabled(id, pubId),
          dispatchEvent: (id, eventName, payload, pubId) =>
            this.service.dispatchEvent(id, eventName, payload, pubId),
        });
        // Fixed enumerated outcome labels only: no tenant IDs, event names,
        // user-supplied payloads or secrets in Prometheus cardinality.
        metrics.counter("plugin_events_processed", 1, { outcome });
      }),
      {
        connection: getBullMqRedisConnection(),
        concurrency: 2,
      },
    );
    this.worker.on("failed", (job, _error) => {
      // Do not log plugin-provided payload, secrets, or stack traces.
      metrics.counter("plugin_events_handler_failed");
      console.error("[PluginEventWorker] Failed plugin event", { jobId: job?.id });
    });
    this.worker.on("error", () => {
      this.ready = false;
      metrics.gauge("plugin_events_consumer_ready", 0);
      metrics.counter("plugin_events_consumer_connection_errors");
      console.error("[PluginEventWorker] Queue connection unavailable");
    });
    this.worker.on("ready", () => {
      this.ready = true;
      metrics.gauge("plugin_events_consumer_ready", 1);
    });
    await this.worker.waitUntilReady();
    await this.producer.waitUntilReady();
    this.ready = true;
    metrics.gauge("plugin_events_consumer_ready", 1);
    // Periodically reconcile PostgreSQL admissions not yet published to
    // Redis. A crash can leave a claimed receipt: a 2-minute lease reclaims it.
    this.sweepTimer = setInterval(() => {
      void this.flushPending().catch(() => {
        console.error("[PluginEventWorker] Pending event sweep unavailable");
      });
    }, 5000);
    void this.flushPending().catch(() => {
      console.error("[PluginEventWorker] Initial event sweep unavailable");
    });
  }

  private flushPending(): Promise<void> {
    if (this.sweep) return this.sweep;
    const pending = this.dispatchPending();
    this.sweep = pending.finally(() => { this.sweep = null; });
    return this.sweep;
  }

  private async dispatchPending(): Promise<void> {
    const producer = this.producer;
    if (!producer || !this.ready) return;
    // Sample durable PostgreSQL receipt ages no more than once per minute,
    // independent of the five-second dispatch loop. Probe failures never
    // block admissions, delivery, or the core CMS readiness checks.
    if (Date.now() >= this.nextReceiptProbeAt) {
      this.nextReceiptProbeAt = Date.now() + 60_000;
      const observed = await observePluginReceiptBacklog(
        readPluginReceiptDiagnostics, metrics,
      );
      if (!observed) {
        console.error("[PluginEventWorker] Receipt diagnostic probe unavailable");
      }
    }
    // A bounded Redis status snapshot is useful for operator alerting but
    // must never block durable PG admission/dispatch if metrics fail.
    try {
      const counts = await producer.getJobCounts(
        "waiting", "active", "delayed", "failed",
      );
      for (const state of ["waiting", "active", "delayed", "failed"] as const) {
        metrics.gauge("plugin_events_queue_jobs", counts[state] ?? 0, { state });
      }
    } catch {
      metrics.counter("plugin_events_metrics_collection_failed");
    }
    const claims = await pluginEventLedger.claimReady(25);
    metrics.gauge("plugin_events_claimed_per_sweep", claims.length);
    for (const receipt of claims) {
      try {
        const outcome = await relayClaimedPluginEvent(
          receipt, pluginEventLedger,
          (claimed) => enqueueTraced(producer, "event", claimed.envelope, {
            jobId: claimed.id, attempts: 5,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: { age: 7 * 24 * 3600, count: 100000 },
            removeOnFail: { age: 30 * 24 * 3600, count: 100000 },
          }),
        );
        metrics.counter(outcome === "enqueued"
          ? "plugin_events_relay_enqueued" : "plugin_events_relay_failed");
        if (outcome === "retry") {
          console.error("[PluginEventWorker] Event admission relay unavailable", {
            jobId: receipt.id,
          });
        }
      } catch {
        // Redis may already have accepted the job. Do not return a claimed
        // receipt to pending when only the DB acknowledgement failed.
        // The existing lease reclaims it safely; job IDs de-duplicate Redis.
        metrics.counter("plugin_events_relay_failed");
        console.error("[PluginEventWorker] Event admission relay unavailable", {
          jobId: receipt.id,
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.ready = false;
    metrics.gauge("plugin_events_consumer_ready", 0);
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.sweep) await this.sweep;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.producer) {
      await this.producer.close();
      this.producer = null;
    }
    await this.service.shutdown();
  }
}
