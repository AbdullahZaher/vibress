import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PluginWorkerEventJobSchema, type PluginWorkerEventJob } from "@vibress/api-contracts";
import {
  Queue, QUEUE_NAMES, enqueueTraced, getBullMqRedisConnection,
} from "@vibress/queue";

/**
 * EXT-401: Redis-persisted, at-least-once operator event admission.
 * An eventId is publication+plugin scoped. Retaining completed/failed jobs
 * bounds idempotency to the retention horizon; handlers MUST be idempotent.
 * No untrusted plugin gets the queue or arbitrary job admission API.
 */
const COMPLETED_RETENTION = { age: 7 * 24 * 60 * 60, count: 100000 };
const FAILED_RETENTION = { age: 30 * 24 * 60 * 60, count: 100000 };

let queue: Queue<PluginWorkerEventJob> | null = null;

function getQueue(): Queue<PluginWorkerEventJob> {
  if (!queue) {
    queue = new Queue<PluginWorkerEventJob>(QUEUE_NAMES.PLUGIN_EVENTS, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: COMPLETED_RETENTION,
        removeOnFail: FAILED_RETENTION,
      },
    });
  }
  return queue;
}

export class PluginEventConflictError extends Error {
  constructor() {
    super("The eventId is already associated with another event");
  }
}

export function pluginEventJobId(job: PluginWorkerEventJob): string {
  // Avoid delimiters forbidden by BullMQ and keep tenant/owner in the key.
  return "plugin-" + createHash("sha256")
    .update(JSON.stringify([job.publicationId, job.pluginId, job.eventId]))
    .digest("hex");
}

function sameEvent(a: PluginWorkerEventJob, b: PluginWorkerEventJob): boolean {
  // An OpenTelemetry traceparent is not part of the event's identity.
  const { traceparent: _a, ...eventA } = a;
  const { traceparent: _b, ...eventB } = b;
  return isDeepStrictEqual(eventA, eventB);
}

/** Only call after Staff+operator permissions and authoritative publication
 * admission. Revalidates all fields before any Redis operation. */
export async function enqueueTrustedPluginEvent(input: PluginWorkerEventJob): Promise<string> {
  const job = PluginWorkerEventJobSchema.parse(input);
  const id = pluginEventJobId(job);
  const target = getQueue();
  const prior = await target.getJob(id);
  if (prior) {
    const parsed = PluginWorkerEventJobSchema.safeParse(prior.data);
    if (!parsed.success || !sameEvent(parsed.data, job)) throw new PluginEventConflictError();
    return id;
  }
  await enqueueTraced(target, "event", job, {
    jobId: id,
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: COMPLETED_RETENTION,
    removeOnFail: FAILED_RETENTION,
  });
  // Also verify an admission race: simultaneous requests with the same
  // eventId but divergent payloads cannot both report accepted.
  const admitted = await target.getJob(id);
  const parsed = PluginWorkerEventJobSchema.safeParse(admitted?.data);
  if (!parsed.success || !sameEvent(parsed.data, job)) throw new PluginEventConflictError();
  return id;
}

export async function closePluginEventQueue(): Promise<void> {
  const current = queue;
  queue = null;
  if (current) await current.close();
}
