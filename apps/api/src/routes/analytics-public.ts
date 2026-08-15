import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  QUEUE_NAMES,
  enqueueTraced,
  getBullMqRedisConnection,
  Queue,
} from "@vibress/queue";
import { getConfig } from "@vibress/config";
import { metrics } from "@vibress/observability";
import {
  validateAnalyticsEvent,
  normalizePath,
  normalizeReferrerDomain,
  deriveVisitorHash,
  classifyBot,
  IngestEventData,
} from "@vibress/analytics";
import type { AnalyticsQueueJob } from "@vibress/queue";
import { appLogger } from "../observability";

const TRAFFIC_EVENTS = new Set(["post.view", "page.view"]);

/**
 * Public web traffic collector. Fire-and-forget: never blocks or breaks the
 * public page path. The server assigns occurredAt (no arbitrary client
 * timestamps), derives the stored visitor hash via keyed HMAC (raw browser
 * ids are never stored), normalizes path/referrer, and enqueues for the
 * existing Analytics worker. If the queue is unavailable the event is lost —
 * public availability is never affected.
 */

const EVENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CollectorBodySchema = z.object({
  // Client-generated idempotency key: the tracker generates it per logical
  // event and reuses it on retries, so a duplicate delivery is de-duplicated
  // by the existing eventId UNIQUE + ingest idempotency. The collector never
  // replaces it. It authorizes nothing — only format/length are validated.
  eventId: z.string().min(1).max(64).regex(EVENT_ID_RE),
  event: z.enum(["post.view", "page.view"]),
  path: z.string().min(1).max(512),
  contentId: z.string().max(64).optional(),
  visitorId: z.string().min(1).max(128),
  referrer: z.string().max(2048).optional(),
});

function getHmacSecret(): string {
  const configured = getConfig().secrets.encryptionKey;
  if (configured) return configured;
  return "vibress-analytics-dev-hmac-key";
}

let analyticsQueue: Queue<AnalyticsQueueJob> | null = null;
function getQueue(): Queue<AnalyticsQueueJob> {
  if (!analyticsQueue) {
    analyticsQueue = new Queue<AnalyticsQueueJob>(QUEUE_NAMES.ANALYTICS, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return analyticsQueue;
}

export async function analyticsCollectorRoutes(fastify: FastifyInstance) {
  const isProduction = getConfig().isProduction;

  fastify.post("/events", {
    config: {
      rateLimit: {
        max: isProduction ? 120 : 1000,
        timeWindow: "1 minute",
      },
    },
    bodyLimit: 4096,
    handler: async (req: FastifyRequest, reply) => {
      const parseResult = CollectorBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        metrics.counter("analytics.events.rejected", 1, {
          reason: "validation",
        });
        return reply.status(400).send({
          errors: [
            {
              code: "INVALID_ANALYTICS_EVENT",
              message: "Invalid analytics event payload",
              requestId: req.id,
            },
          ],
        });
      }
      const input = parseResult.data;
      if (!TRAFFIC_EVENTS.has(input.event)) {
        metrics.counter("analytics.events.rejected", 1, {
          reason: "unknown_event",
        });
        return reply.status(400).send({
          errors: [
            {
              code: "INVALID_ANALYTICS_EVENT",
              message: "Unknown analytics event",
              requestId: req.id,
            },
          ],
        });
      }

      const userAgent = req.headers["user-agent"] || null;
      const isBot = classifyBot(userAgent);
      if (isBot) metrics.counter("analytics.events.bot", 1);

      const event: IngestEventData = {
        // Client-supplied eventId is the idempotency key; the server must not
        // replace it, otherwise a retry would produce a different id and the
        // same logical event could be counted twice.
        eventId: input.eventId,
        eventName: input.event,
        occurredAt: new Date(), // server receive time — clients cannot inject history
        path: normalizePath(input.path),
        visitorHash: deriveVisitorHash(input.visitorId, getHmacSecret()),
        referrerDomain: normalizeReferrerDomain(
          input.referrer,
          getConfig().site.url,
        ),
        isBot,
        entityType: input.event === "post.view" ? "post" : "page",
        entityId: input.contentId || null,
      };

      try {
        validateAnalyticsEvent(event);
      } catch {
        metrics.counter("analytics.events.rejected", 1, {
          reason: "validation",
        });
        return reply.status(400).send({
          errors: [
            {
              code: "INVALID_ANALYTICS_EVENT",
              message: "Invalid analytics event payload",
              requestId: req.id,
            },
          ],
        });
      }

      metrics.counter("analytics.events.accepted", 1, {
        event: input.event,
        bot: isBot ? "true" : "false",
      });

      // Fire-and-forget enqueue: never await, never let queue failure reach
      // the public client.
      enqueueTraced(getQueue(), input.event, {
        event: event as AnalyticsQueueJob["event"],
      }).catch((err: unknown) => {
        metrics.counter("analytics.events.queue_failed", 1);
        appLogger.warn(
          "analytics queue enqueue failed (event dropped, public path unaffected)",
          { requestId: req.id },
          err as Error,
        );
      });

      return reply.status(204).send();
    },
  });
}
