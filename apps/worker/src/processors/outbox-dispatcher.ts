import { Queue, QUEUE_NAMES, getBullMqRedisConnection } from '@vibress/queue';
import { OutboxDispatcherWorker, OutboxRelay, parseEventEnvelope } from '@vibress/events';
import { getConfig } from '@vibress/config';

export { OutboxDispatcherWorker };

interface OutboxSearchJob {
  op: 'upsert' | 'remove';
  doc?: { entityType: string; entityId: string; title?: string; slug?: string };
  entityType?: string;
  entityId?: string;
}

/**
 * Default relay: maps outbox rows to vibress-search queue jobs, mirroring the
 * legacy in-process relay in apps/api/src/async-bridge.ts so the two delivery
 * modes emit identical queue payloads.
 */
const defaultSearchRelay: OutboxRelay = {
  async deliver(row) {
    const envelope = parseEventEnvelope(row.payload);
    const payload = envelope.payload as { postId: string; title?: string; slug?: string };
    const queue = getRelayQueue();
    switch (row.eventType) {
      case 'post.published':
        await queue.add('index', {
          op: 'upsert',
          doc: {
            entityType: 'post',
            entityId: payload.postId,
            title: payload.title || '',
            slug: payload.slug || '',
          },
        });
        return;
      case 'post.unpublished':
      case 'post.deleted':
        await queue.add('remove', { op: 'remove', entityType: 'post', entityId: payload.postId });
        return;
      default:
        // Unknown event types are delivered to no queue; consumers treat
        // these as no-ops and the row is marked published.
        return;
    }
  },
};

/** Dispatcher bound to the search-queue relay used in production. */
export function createDefaultOutboxDispatcher(): OutboxDispatcherWorker {
  const config = getConfig();
  return new OutboxDispatcherWorker(undefined, defaultSearchRelay, {
    publishedRetentionDays: config.outbox.publishedRetentionDays,
    failedRetentionDays: config.outbox.failedRetentionDays,
  });
}

let relayQueue: Queue<OutboxSearchJob> | null = null;

function getRelayQueue(): Queue<OutboxSearchJob> {
  if (!relayQueue) {
    relayQueue = new Queue<OutboxSearchJob>(QUEUE_NAMES.SEARCH, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: { attempts: 3, removeOnComplete: 500, removeOnFail: 1000 },
    });
  }
  return relayQueue;
}
