import { Worker, Job, QUEUE_NAMES, getBullMqRedisConnection } from '@vibress/queue';
import { AnalyticsService, DrizzleAnalyticsRepository, IngestEventData, validateAnalyticsEvent } from '@vibress/analytics';

export interface AnalyticsJob {
  event: IngestEventData;
}

const ANALYTICS_QUEUE_NAME = QUEUE_NAMES.ANALYTICS;

/**
 * Consumes domain events asynchronously and ingests them into analytics.
 * Analytics is never a transactional dependency — failures are logged and
 * dropped, never propagated to core operations.
 */
export class AnalyticsWorker {
  private worker: Worker<AnalyticsJob> | null = null;
  private analyticsService = new AnalyticsService(new DrizzleAnalyticsRepository());

  async start(): Promise<void> {
    this.worker = new Worker<AnalyticsJob>(
      ANALYTICS_QUEUE_NAME,
      async (job) => this.process(job),
      { connection: getBullMqRedisConnection(), concurrency: 2 }
    );
    this.worker.on('failed', (job, err) => {
      console.error(`[AnalyticsWorker] Job ${job?.id} failed (non-fatal):`, err.message);
    });
  }

  private async process(job: Job<AnalyticsJob>): Promise<void> {
    try {
      validateAnalyticsEvent(job.data.event);
      await this.analyticsService.ingest(job.data.event);
    } catch (err: any) {
      console.error(`[AnalyticsWorker] Dropped invalid event ${job.data.event?.eventName}:`, err.message);
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


