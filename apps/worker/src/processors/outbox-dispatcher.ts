import {
  Queue,
  QUEUE_NAMES,
  enqueueTraced,
  getBullMqRedisConnection,
} from "@vibress/queue";
import {
  OutboxDispatcherWorker,
  OutboxRelay,
  parseEventEnvelope,
} from "@vibress/events";
import { getConfig } from "@vibress/config";
import { withSpan, withRemoteTraceContext } from "@vibress/observability";

export { OutboxDispatcherWorker };

interface OutboxSearchJob {
  op: "upsert" | "remove";
  doc?: { entityType: string; entityId: string; title?: string; slug?: string };
  entityType?: string;
  entityId?: string;
  traceparent?: string;
}

/**
 * Default relay: maps outbox rows to vibress-search queue jobs, mirroring the
 * legacy in-process relay in apps/api/src/async-bridge.ts so the two delivery
 * modes emit identical queue payloads. The relay span continues the trace of
 * the process that wrote the outbox row (traceId is propagated via the
 * envelope) and forwards it into the queue job metadata.
 */
const defaultSearchRelay: OutboxRelay = {
  async deliver(row) {
    const envelope = parseEventEnvelope(row.payload);
    const traceCtx =
      envelope.trace &&
      typeof envelope.trace.traceId === "string" &&
      typeof envelope.trace.spanId === "string"
        ? { traceId: envelope.trace.traceId, spanId: envelope.trace.spanId }
        : undefined;
    return withRemoteTraceContext(traceCtx, () =>
      withSpan(
        "outbox.relay.deliver",
        async () => {
          const payload = envelope.payload as {
            postId: string;
            title?: string;
            slug?: string;
          };
          const queue = getRelayQueue();
          switch (row.eventType) {
            case "post.published":
              await enqueueTraced(queue, "index", {
                op: "upsert",
                doc: {
                  entityType: "post",
                  entityId: payload.postId,
                  title: payload.title || "",
                  slug: payload.slug || "",
                },
              });
              return;
            case "post.unpublished":
            case "post.deleted":
              await enqueueTraced(queue, "remove", {
                op: "remove",
                entityType: "post",
                entityId: payload.postId,
              });
              return;
            default:
              // Unknown event types are delivered to no queue; consumers treat
              // these as no-ops and the row is marked published.
              return;
          }
        },
        {
          eventType: row.eventType,
          outboxId: row.id,
          ...(envelope.trace
            ? { "vibress.trace_id": envelope.trace.traceId }
            : {}),
        },
      ),
    );
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
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return relayQueue;
}
