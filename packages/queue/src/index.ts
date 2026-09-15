import {
  Queue,
  Worker,
  Processor,
  QueueOptions,
  WorkerOptions,
  Job,
} from "bullmq";
import { getBullMqRedisConnection } from "@vibress/cache";
import { getActiveTraceContext, withSpan } from "@vibress/observability";

export { Queue, Worker, Job, getBullMqRedisConnection };

function buildTraceparent(traceCtx: {
  traceId: string;
  spanId: string;
}): string {
  return `00-${traceCtx.traceId}-${traceCtx.spanId}-01`;
}
export type { Processor, QueueOptions, WorkerOptions };

export const QUEUE_NAMES = {
  EMAIL_DELIVERY: "vibress-email-delivery",
  WEBHOOK_DELIVERY: "vibress-webhook-delivery",
  SEARCH: "vibress-search",
  ANALYTICS: "vibress-analytics",
  AUTOMATIONS_RUN: "vibress-automations",
  AUTOMATIONS_DELAYED: "vibress-automations-delayed",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type JobScope =
  | { scope: "publication"; publicationId: string }
  | { scope: "system"; publicationId?: undefined };

export function assertJobScope(data: unknown): JobScope {
  if (!data || typeof data !== "object") {
    throw new Error("Job data must be an object");
  }
  const obj = data as Record<string, unknown>;
  if (obj.scope === "publication") {
    const pubId =
      typeof obj.publicationId === "string" && obj.publicationId.trim()
        ? obj.publicationId.trim()
        : typeof (obj.doc as Record<string, unknown> | undefined)?.publicationId === "string"
          ? ((obj.doc as Record<string, unknown>).publicationId as string).trim()
          : typeof (obj.event as Record<string, unknown> | undefined)?.publicationId === "string"
            ? ((obj.event as Record<string, unknown>).publicationId as string).trim()
            : undefined;
    if (!pubId) {
      throw new Error("Publication-scoped job must include a non-empty publicationId");
    }
    return { scope: "publication", publicationId: pubId };
  }
  if (obj.scope === "system") {
    return { scope: "system" };
  }

  // Explicit publicationId provided directly or in nested doc/event
  const candidatePubId =
    typeof obj.publicationId === "string" && obj.publicationId.trim()
      ? obj.publicationId.trim()
      : typeof (obj.doc as Record<string, unknown> | undefined)?.publicationId === "string"
        ? ((obj.doc as Record<string, unknown>).publicationId as string).trim()
        : typeof (obj.event as Record<string, unknown> | undefined)?.publicationId === "string"
          ? ((obj.event as Record<string, unknown>).publicationId as string).trim()
          : undefined;

  if (candidatePubId) {
    return { scope: "publication", publicationId: candidatePubId };
  }

  throw new Error("Job payload must specify scope: 'publication' (with publicationId) or scope: 'system'");
}

export interface EmailDeliveryJob {
  scope?: "publication" | "system" | undefined;
  publicationId?: string | undefined;
  sendId: string;
  recipientIds: string[];
  traceparent?: string | undefined;
}

export interface WebhookDeliveryJob {
  scope?: "publication" | "system" | undefined;
  publicationId?: string | undefined;
  deliveryId: string;
  endpointId: string;
  traceparent?: string | undefined;
}

export interface SearchQueueJob {
  scope?: "publication" | "system" | undefined;
  publicationId?: string | undefined;
  op: "upsert" | "remove" | "rebuild";
  doc?: {
    entityType: string;
    entityId: string;
    title: string;
    bodyText?: string | undefined;
    slug?: string | undefined;
    url?: string | undefined;
    publicationId?: string | undefined;
  } | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  traceparent?: string | undefined;
}

export interface AnalyticsQueueJob {
  scope?: "publication" | "system" | undefined;
  publicationId?: string | undefined;
  event: {
    eventId: string;
    publicationId?: string | undefined;
    eventName: string;
    occurredAt?: Date | string | undefined;
    actorType?: string | null | undefined;
    actorId?: string | null | undefined;
    entityType?: string | null | undefined;
    entityId?: string | null | undefined;
    /** Public web traffic fields (privacy-safe). */
    path?: string | null | undefined;
    visitorHash?: string | null | undefined;
    referrerDomain?: string | null | undefined;
    isBot?: boolean | null | undefined;
    context?: Record<string, unknown> | null | undefined;
    properties?: Record<string, unknown> | null | undefined;
  };
  traceparent?: string | undefined;
}

export interface AutomationRunQueueJob {
  scope?: "publication" | "system" | undefined;
  publicationId?: string | undefined;
  runId: string;
  traceparent?: string | undefined;
}

export interface AutomationDelayedQueueJob {
  scope?: "publication" | "system" | undefined;
  publicationId?: string | undefined;
  runId: string;
  stepIndex: number;
  resumeAt: number;
  traceparent?: string | undefined;
}

export const QUEUE_DEFAULTS = {
  EMAIL: {
    attempts: 5,
    backoff: { type: "exponential" as const, delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
  STANDARD: {
    attempts: 3,
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
};

export function createQueue<T = unknown>(
  queueName: string,
  defaultJobOptions?: QueueOptions["defaultJobOptions"],
): Queue<T> {
  return new Queue<T>(queueName, {
    connection: getBullMqRedisConnection(),
    defaultJobOptions: defaultJobOptions ?? QUEUE_DEFAULTS.STANDARD,
  });
}

export function createWorker<T = unknown>(
  queueName: string,
  processor: Processor<T>,
  options?: Partial<WorkerOptions>,
): Worker<T> {
  return new Worker<T>(queueName, processor, {
    connection: getBullMqRedisConnection(),
    concurrency: 1,
    ...options,
  });
}

/**
 * Adds a job to a queue inside an OpenTelemetry span, attaching the active
 * traceId to the job payload so the worker can continue the trace across
 * process boundaries. When tracing is disabled this behaves exactly like
 * queue.add with no overhead.
 */
export async function enqueueTraced<T extends { traceparent?: string | undefined }>(
  queue: Queue<T>,
  jobName: string,
  payload: T,
  options?: QueueOptions["defaultJobOptions"] & { jobId?: string },
): Promise<unknown> {
  const traceCtx = getActiveTraceContext();
  const data = (
    traceCtx ? { ...payload, traceparent: buildTraceparent(traceCtx) } : payload
  ) as T;
  return withSpan(
    `queue.enqueue.${jobName}`,
    () =>
      queue.add(
        jobName as never,
        data as Parameters<Queue<T>["add"]>[1],
        options,
      ),
    {
      "messaging.system": "bullmq",
      "messaging.operation": "enqueue",
      "messaging.destination": queue.name,
      ...(traceCtx ? { "vibress.trace_id": traceCtx.traceId } : {}),
    },
  );
}
