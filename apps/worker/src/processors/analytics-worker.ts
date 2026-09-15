import {
  Worker,
  Job,
  QUEUE_NAMES,
  getBullMqRedisConnection,
  assertJobScope,
} from "@vibress/queue";
import { tracedProcessor } from "./trace-helper";
import { metrics } from "@vibress/observability";
import {
  AnalyticsService,
  DrizzleAnalyticsRepository,
  IngestEventData,
  validateAnalyticsEvent,
} from "@vibress/analytics";

export interface AnalyticsJob {
  scope?: "publication" | "system";
  publicationId?: string;
  event: IngestEventData;
  traceparent?: string;
}

const ANALYTICS_QUEUE_NAME = QUEUE_NAMES.ANALYTICS;

/**
 * Consumes domain events asynchronously and ingests them into analytics.
 * Analytics is never a transactional dependency — failures are logged and
 * dropped, never propagated to core operations.
 */
export class AnalyticsWorker {
  private worker: Worker<AnalyticsJob> | null = null;
  private analyticsService = new AnalyticsService(
    new DrizzleAnalyticsRepository(),
  );

  async start(): Promise<void> {
    this.worker = new Worker<AnalyticsJob>(
      ANALYTICS_QUEUE_NAME,
      tracedProcessor("worker.job.analytics", (job) => this.process(job)),
      { connection: getBullMqRedisConnection(), concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      console.error(
        `[AnalyticsWorker] Job ${job?.id} failed (non-fatal):`,
        err.message,
      );
    });
  }

  private async process(job: Job<AnalyticsJob>): Promise<void> {
    try {
      const scope = assertJobScope(job.data);
      const pubId =
        scope.scope === "publication"
          ? scope.publicationId
          : job.data.event.publicationId;
      const eventToIngest = {
        ...job.data.event,
        ...(pubId ? { publicationId: pubId } : {}),
      };
      validateAnalyticsEvent(eventToIngest);
      await this.analyticsService.ingest(eventToIngest);
      metrics.counter("analytics.worker.processed", 1, {
        event: job.data.event.eventName,
      });
    } catch (err) {
      metrics.counter("analytics.worker.failed", 1);
      console.error(
        `[AnalyticsWorker] Dropped invalid event ${job.data.event?.eventName}:`,
        err instanceof Error ? err.message : err,
      );
      // Never retry invalid events; core correctness unaffected
    }
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
