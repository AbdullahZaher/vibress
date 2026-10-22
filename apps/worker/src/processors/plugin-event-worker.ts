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
  TrustedExternalPluginHost, verifyTrustedPluginRelease,
  pluginEventLedger, pluginEventJobId,
  type Plugin,
} from "@vibress/plugins";
import { tracedProcessor } from "./trace-helper";
import { metrics } from "@vibress/observability";

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
  // lockfile, never the queued message. Mismatched/revoked versions retire.
  const digests = await execution.approvedDigests();
  if (digests.get(plugin.manifestId) !== job.artifactSha256) return "retired";
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
      "PLUGIN_RESTART_REQUIRED",
      "PLUGIN_RELEASE_NOT_APPROVED",
      "PLUGIN_CAPABILITY_DENIED",
    ].includes(error.code)) return "retired";
    // Provider outages, transient database failures, and handler errors are
    // retried by BullMQ. Handlers must tolerate at-least-once delivery.
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

export class PluginEventWorker {
  private worker: Worker<PluginWorkerEventJob> | null = null;
  private producer: Queue<PluginWorkerEventJob> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweep: Promise<void> | null = null;
  private ready = false;

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
    {
      loadModule: (plugin) => this.operatorHost.loadModule(plugin),
      requiresPublicationEnablement: () => true,
      getOperatorAdminFingerprints: () => this.operatorHost.listTrustedFingerprints(),
    },
    new DrizzlePluginPublicationStateRepository(),
    new DrizzlePluginPublicationSettingRepository(),
  );

  async start(): Promise<void> {
    // Only replicas with an explicit operator-approved release mount may
    // execute external plugin code. The default worker remains bundled-only.
    if (!process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE) {
      if (process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE === "1") {
        throw new Error("Trusted plugin release mount required");
      }
      return;
    }
    await verifyTrustedPluginRelease(process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE);
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
    if (!this.producer || !this.ready) return;
    // A bounded Redis status snapshot is useful for operator alerting but
    // must never block durable PG admission/dispatch if metrics fail.
    try {
      const counts = await this.producer.getJobCounts(
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
        await enqueueTraced(this.producer, "event", receipt.envelope, {
          jobId: receipt.id, attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { age: 7 * 24 * 3600, count: 100000 },
          removeOnFail: { age: 30 * 24 * 3600, count: 100000 },
        });
        // A consumer may already have finalized this receipt. Conditional
        // updates must never change an executed/retired receipt back to queued.
        await pluginEventLedger.markQueued(receipt.id);
        metrics.counter("plugin_events_relay_enqueued");
      } catch {
        await pluginEventLedger.returnPending(receipt.id);
        metrics.counter("plugin_events_relay_failed");
        // No plugin payloads/errors are logged; retry through the next sweep.
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
