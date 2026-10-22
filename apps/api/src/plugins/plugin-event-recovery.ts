import {
  Queue, QUEUE_NAMES, getBullMqRedisConnection,
} from "@vibress/queue";
import {
  pluginEventLedger, pluginEventJobId, pluginEventEnvelopeHash,
  type Plugin,
} from "@vibress/plugins";
import {
  PluginWorkerEventJobSchema, type PluginWorkerEventJob,
} from "@vibress/api-contracts";
import { pluginsService } from "../services";

type Receipt = NonNullable<Awaited<ReturnType<typeof pluginEventLedger.getReceipt>>>;

export interface FailedEventJob {
  readonly id?: string | undefined;
  readonly data: unknown;
  readonly attemptsMade: number;
  getState(): Promise<string>;
  retry(state?: "failed" | "completed"): Promise<void>;
}
export interface FailedEventQueue {
  getJob(id: string): Promise<FailedEventJob | undefined | null>;
  close(): Promise<void>;
}
export interface FailedEventLedger {
  listQueuedEventIds(
    publicationId: string, pluginId: string, offset: number, limit: number,
  ): Promise<readonly string[]>;
  getReceipt(
    publicationId: string, pluginId: string, eventId: string,
  ): Promise<Receipt | null>;
  recordReplayRequest(
    publicationId: string, pluginId: string, eventId: string,
    envelopeHash: string, audit: { readonly actorUserId: string; readonly requestId: string },
  ): Promise<boolean>;
}
export interface FailedEventAuthority {
  getPlugin(id: string): Promise<Plugin | null>;
  isPublicationEnabled(pluginId: string, publicationId: string): Promise<boolean>;
  listOperatorAdminFingerprints(): Promise<ReadonlyMap<string, string>>;
}

export type FailedPluginEventDto = {
  eventId: string;
  jobId: string;
  attemptsMade: number;
  status: "failed";
};

export class PluginEventRecoveryError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE") {
    super("Plugin event replay unavailable");
  }
}

/** Operator-only orchestration: Redis holds failed jobs, PostgreSQL is the
 * immutable authority. Never reveal failedReason, stacktrace or payload. */
export class PluginEventRecoveryService {
  constructor(
    private readonly ledger: FailedEventLedger,
    private readonly authority: FailedEventAuthority,
    private readonly queue: FailedEventQueue,
  ) {}

  private async inspect(
    publicationId: string, pluginId: string, eventId: string,
    existing?: FailedEventJob,
  ): Promise<{ receipt: Receipt; job: FailedEventJob; dto: FailedPluginEventDto }> {
    const receipt = await this.ledger.getReceipt(publicationId, pluginId, eventId);
    if (!receipt) throw new PluginEventRecoveryError("NOT_FOUND");
    if (receipt.status !== "queued") throw new PluginEventRecoveryError("CONFLICT");
    const job = existing ?? await this.queue.getJob(receipt.id);
    if (!job || job.id !== receipt.id) throw new PluginEventRecoveryError("NOT_FOUND");
    // Redis payloads are untrusted even when returned by the named queue.
    const parsed = PluginWorkerEventJobSchema.safeParse(job.data);
    if (!parsed.success || pluginEventJobId(parsed.data) !== receipt.id ||
        pluginEventEnvelopeHash(parsed.data) !== pluginEventEnvelopeHash(receipt.job)) {
      throw new PluginEventRecoveryError("CONFLICT");
    }
    if (await job.getState() !== "failed") throw new PluginEventRecoveryError("CONFLICT");
    return {
      receipt, job,
      dto: {
        eventId: receipt.job.eventId, jobId: receipt.id,
        attemptsMade: Math.max(0, job.attemptsMade), status: "failed",
      },
    };
  }

  async getFailed(
    publicationId: string, pluginId: string, eventId: string,
  ): Promise<FailedPluginEventDto> {
    return (await this.inspect(publicationId, pluginId, eventId)).dto;
  }

  /** Query authorized tenant receipts first; probe only matching Redis
   * job IDs. Never enumerate the shared Redis queue across tenants. */
  async listFailed(
    publicationId: string, pluginId: string, offset: number, limit: number,
  ): Promise<{ items: FailedPluginEventDto[]; nextOffset: number }> {
    const eventIds = await this.ledger.listQueuedEventIds(
      publicationId, pluginId, offset, limit,
    );
    const items: FailedPluginEventDto[] = [];
    for (const eventId of eventIds) {
      try {
        const result = await this.inspect(publicationId, pluginId, eventId);
        items.push(result.dto);
      } catch (error) {
        if (error instanceof PluginEventRecoveryError &&
            (error.code === "NOT_FOUND" || error.code === "CONFLICT")) continue;
        throw error;
      }
    }
    return { items, nextOffset: offset + eventIds.length };
  }

  async replay(
    publicationId: string, pluginId: string, eventId: string,
    audit: { readonly actorUserId: string; readonly requestId: string },
  ): Promise<FailedPluginEventDto> {
    const { receipt, job, dto } = await this.inspect(publicationId, pluginId, eventId);
    const plugin = await this.authority.getPlugin(pluginId);
    const approved = plugin
      ? await this.authority.listOperatorAdminFingerprints()
      : null;
    if (!plugin || plugin.status !== "active" ||
        plugin.manifestId !== receipt.job.manifestId ||
        plugin.version !== receipt.job.pluginVersion ||
        !plugin.capabilities.includes("events.subscribe") ||
        (!plugin.hooks.includes(receipt.job.eventName) && !plugin.hooks.includes("onEvent")) ||
        approved?.get(plugin.manifestId) !== receipt.job.artifactSha256 ||
        !(await this.authority.isPublicationEnabled(pluginId, publicationId))) {
      throw new PluginEventRecoveryError("CONFLICT");
    }
    const logged = await this.ledger.recordReplayRequest(
      publicationId, pluginId, eventId,
      pluginEventEnvelopeHash(receipt.job), audit,
    );
    if (!logged) throw new PluginEventRecoveryError("CONFLICT");
    try {
      await job.retry("failed");
    } catch {
      // Audit records the request, never claims that the retry succeeded.
      throw new PluginEventRecoveryError("UNAVAILABLE");
    }
    return dto;
  }
}

let failedEventQueue: Queue<PluginWorkerEventJob> | null = null;
function getFailedEventQueue(): Queue<PluginWorkerEventJob> {
  if (!failedEventQueue) {
    failedEventQueue = new Queue<PluginWorkerEventJob>(QUEUE_NAMES.PLUGIN_EVENTS, {
      connection: getBullMqRedisConnection(),
    });
  }
  return failedEventQueue;
}
export function getPluginEventRecoveryService(): PluginEventRecoveryService {
  return new PluginEventRecoveryService(pluginEventLedger, pluginsService, getFailedEventQueue());
}
export async function closePluginEventRecoveryQueue(): Promise<void> {
  const queue = failedEventQueue;
  failedEventQueue = null;
  if (queue) await queue.close();
}
