import {
  DrizzleAnalyticsRepository,
  TRAFFIC_EVENT_NAMES,
} from "@vibress/analytics";
import { metrics } from "@vibress/observability";

/**
 * Raw public-traffic retention sweep. Deletes only traffic raw events
 * (post.view / page.view) older than the retention window. Business analytics
 * events and daily aggregates are never touched. Mirrors the scheduler
 * pattern used by the outbox dispatcher / content scheduler.
 */
export class AnalyticsRetentionSweeper {
  private timer: NodeJS.Timeout | null = null;
  private repository = new DrizzleAnalyticsRepository();

  /** Raw traffic retention window in days. */
  constructor(private retentionDays = 90) {}

  start(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.timer) return;
    // Run once shortly after boot, then on the interval.
    this.runSweep().catch(() => undefined);
    this.timer = setInterval(() => {
      this.runSweep().catch(() => undefined);
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runSweep(): Promise<void> {
    const before = new Date(Date.now() - this.retentionDays * 24 * 3600 * 1000);
    const deleted = await this.repository.deleteTrafficEventsBefore(before);
    if (deleted > 0) {
      metrics.counter("analytics.retention.deleted", deleted, {
        eventNames: TRAFFIC_EVENT_NAMES.join(","),
      });
    }
  }
}
