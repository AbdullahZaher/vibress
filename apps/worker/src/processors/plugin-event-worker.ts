import {
  Worker, QUEUE_NAMES, getBullMqRedisConnection,
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
  type Plugin,
} from "@vibress/plugins";
import { tracedProcessor } from "./trace-helper";

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
      "PLUGIN_CAPABILITY_DENIED",
    ].includes(error.code)) return "retired";
    // Provider outages, transient database failures, and handler errors are
    // retried by BullMQ. Handlers must tolerate at-least-once delivery.
    throw error;
  }
  return "executed";
}

export class PluginEventWorker {
  private worker: Worker<PluginWorkerEventJob> | null = null;
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
    this.worker = new Worker<PluginWorkerEventJob>(
      QUEUE_NAMES.PLUGIN_EVENTS,
      tracedProcessor("worker.job.plugin-event", async (job) => {
        await processTrustedPluginEvent(job.data, {
          getPlugin: (id) => this.repository.findById(id),
          approvedDigests: () => this.operatorHost.listTrustedFingerprints(),
          isPublicationEnabled: (id, pubId) => this.service.isPublicationEnabled(id, pubId),
          dispatchEvent: (id, eventName, payload, pubId) =>
            this.service.dispatchEvent(id, eventName, payload, pubId),
        });
      }),
      {
        connection: getBullMqRedisConnection(),
        concurrency: 2,
      },
    );
    this.worker.on("failed", (job, _error) => {
      // Do not log plugin-provided payload, secrets, or stack traces.
      console.error("[PluginEventWorker] Failed plugin event", { jobId: job?.id });
    });
    this.worker.on("error", () => {
      this.ready = false;
      console.error("[PluginEventWorker] Queue connection unavailable");
    });
    this.worker.on("ready", () => { this.ready = true; });
    await this.worker.waitUntilReady();
    this.ready = true;
  }

  async stop(): Promise<void> {
    this.ready = false;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.service.shutdown();
  }
}
