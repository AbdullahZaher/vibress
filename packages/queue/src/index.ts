import { Queue, Worker, Processor, QueueOptions, WorkerOptions, Job } from 'bullmq';
import { getBullMqRedisConnection } from '@vibress/cache';
import { getActiveTraceContext, withSpan } from '@vibress/observability';

export { Queue, Worker, Job, getBullMqRedisConnection };

function buildTraceparent(traceCtx: { traceId: string; spanId: string }): string {
  return `00-${traceCtx.traceId}-${traceCtx.spanId}-01`;
}
export type { Processor, QueueOptions, WorkerOptions };

export const QUEUE_NAMES = {
  EMAIL_DELIVERY: 'vibress-email-delivery',
  WEBHOOK_DELIVERY: 'vibress-webhook-delivery',
  SEARCH: 'vibress-search',
  ANALYTICS: 'vibress-analytics',
  AUTOMATIONS_RUN: 'vibress-automations',
  AUTOMATIONS_DELAYED: 'vibress-automations-delayed',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export interface EmailDeliveryJob {
  sendId: string;
  recipientIds: string[];
  traceparent?: string;
}

export interface WebhookDeliveryJob {
  deliveryId: string;
  endpointId: string;
  traceparent?: string;
}

export interface SearchQueueJob {
  op: 'upsert' | 'remove' | 'rebuild';
  doc?: {
    entityType: string;
    entityId: string;
    title: string;
    bodyText?: string;
    slug?: string;
    url?: string;
  };
  entityType?: string;
  entityId?: string;
  traceparent?: string;
}

export interface AnalyticsQueueJob {
  event: {
    eventId: string;
    eventName: string;
    occurredAt: Date | string;
    actorType?: string | null;
    actorId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    properties?: Record<string, unknown>;
  };
  traceparent?: string;
}

export interface AutomationRunQueueJob {
  runId: string;
  traceparent?: string;
}

export interface AutomationDelayedQueueJob {
  runId: string;
  stepIndex: number;
  resumeAt: number;
  traceparent?: string;
}

export const QUEUE_DEFAULTS = {
  EMAIL: {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 5000 },
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
  defaultJobOptions?: QueueOptions['defaultJobOptions']
): Queue<T> {
  return new Queue<T>(queueName, {
    connection: getBullMqRedisConnection(),
    defaultJobOptions: defaultJobOptions ?? QUEUE_DEFAULTS.STANDARD,
  });
}

export function createWorker<T = unknown>(
  queueName: string,
  processor: Processor<T>,
  options?: Partial<WorkerOptions>
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
export async function enqueueTraced<T extends { traceparent?: string }>(
  queue: Queue<T>,
  jobName: string,
  payload: T,
  options?: QueueOptions['defaultJobOptions'] & { jobId?: string }
): Promise<unknown> {
  const traceCtx = getActiveTraceContext();
  const data = (traceCtx ? { ...payload, traceparent: buildTraceparent(traceCtx) } : payload) as T;
  return withSpan(
    `queue.enqueue.${jobName}`,
    () => queue.add(jobName as never, data as Parameters<Queue<T>['add']>[1], options),
    {
      'messaging.system': 'bullmq',
      'messaging.operation': 'enqueue',
      'messaging.destination': queue.name,
      ...(traceCtx ? { 'vibress.trace_id': traceCtx.traceId } : {}),
    }
  );
}
