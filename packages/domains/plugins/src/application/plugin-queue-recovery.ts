import { PluginWorkerEventJobSchema } from "@vibress/api-contracts";
import { pluginEventEnvelopeHash, pluginEventJobId } from "./plugin-event-ledger";

export interface QueueRecoveryReceipt {
  readonly id: string;
  readonly envelope: unknown;
  readonly envelopeHash: string;
}
export interface QueueRecoveryJob {
  readonly id: string | undefined;
  readonly data: unknown;
  readonly state: string;
}
export type QueueRecoveryState =
  | "admitted" | "failed" | "missing" | "terminal" | "invalid";

/** Offline, read-only DR comparison. PostgreSQL's approved immutable
 * receipt is authoritative; Redis data never creates admission. No event
 * payloads or publication/member IDs enter diagnostic output. */
export function assessQueueRecovery(
  receipt: QueueRecoveryReceipt,
  redis: QueueRecoveryJob | null,
): QueueRecoveryState {
  const stored = PluginWorkerEventJobSchema.safeParse(receipt.envelope);
  if (!stored.success || pluginEventJobId(stored.data) !== receipt.id ||
      pluginEventEnvelopeHash(stored.data) !== receipt.envelopeHash) {
    return "invalid";
  }
  if (!redis) return "missing";
  const job = PluginWorkerEventJobSchema.safeParse(redis.data);
  if (!job.success || redis.id !== receipt.id ||
      pluginEventJobId(job.data) !== receipt.id ||
      pluginEventEnvelopeHash(job.data) !== receipt.envelopeHash) {
    return "invalid";
  }
  if (redis.state === "failed") return "failed";
  if (redis.state === "completed") return "terminal";
  if (redis.state === "waiting" || redis.state === "active" ||
      redis.state === "delayed" || redis.state === "paused" ||
      redis.state === "prioritized" || redis.state === "waiting-children") {
    return "admitted";
  }
  return "missing"; // removed/unknown is not evidence of successful delivery
}
