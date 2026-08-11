import { Queue, Worker, Processor, QueueOptions, WorkerOptions, Job } from 'bullmq';
import { getBullMqRedisConnection } from '@vibress/cache';

export { Queue, Worker, Job, getBullMqRedisConnection };
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
}

export interface WebhookDeliveryJob {
  deliveryId: string;
  endpointId: string;
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
}

export interface AutomationRunQueueJob {
  runId: string;
}

export interface AutomationDelayedQueueJob {
  runId: string;
  stepIndex: number;
  resumeAt: number;
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
