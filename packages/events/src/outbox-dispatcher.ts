import {
  OutboxEventRow,
  OutboxRepository,
  defaultOutboxRepository,
} from "./outbox-repository";

/**
 * Polls the transactional outbox and delivers claimed rows to a relay.
 * Claims use FOR UPDATE SKIP LOCKED so multiple dispatcher instances (or
 * multiple processes) stay safe. Delivery is at-least-once by design:
 * consumers must be idempotent. Failed deliveries return to 'pending' with
 * exponential backoff (availableAfter); rows past maxAttempts become
 * 'failed'. Claims left 'delivering' by a crashed dispatcher are reclaimed
 * after staleClaimMs.
 */

export interface OutboxRelay {
  deliver(row: OutboxEventRow): Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_STALE_CLAIM_MS = 60_000;
const CLAIM_BATCH_SIZE = 50;

export class OutboxDispatcherWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private failures: Array<{ eventType: string; error: string }> = [];

  constructor(
    private repository: OutboxRepository = defaultOutboxRepository,
    private relay: OutboxRelay,
    private options: {
      maxAttempts?: number;
      staleClaimMs?: number;
      publishedRetentionDays?: number;
      failedRetentionDays?: number;
    } = {},
  ) {}

  get failureCount(): number {
    return this.failures.length;
  }

  get isRunningFlag(): boolean {
    return this.isRunning;
  }

  start(intervalMs = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runDispatchCycle().catch((err) =>
      console.error("[OutboxDispatcher] Initial sweep failed:", err),
    );
    this.timer = setInterval(() => {
      this.runDispatchCycle().catch((err) =>
        console.error("[OutboxDispatcher] Sweep error:", err),
      );
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  async runDispatchCycle(): Promise<void> {
    await this.purgeExpired();
    await this.repository.reclaimStaleClaims({
      staleAfterMs: this.options.staleClaimMs ?? DEFAULT_STALE_CLAIM_MS,
    });

    const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    // Loop until no more immediately dispatchable rows remain.
    for (;;) {
      const claimed = await this.repository.claimReady({
        limit: CLAIM_BATCH_SIZE,
      });
      if (claimed.length === 0) break;
      for (const row of claimed) {
        try {
          await this.relay.deliver(row);
          await this.repository.markPublished([row.id]);
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "dispatch failed";
          await this.repository.markFailed(row.id, message, { maxAttempts });
          this.failures.push({ eventType: row.eventType, error: message });
          if (this.failures.length > 100) this.failures.shift();
          console.error(
            `[OutboxDispatcher] Failed to dispatch ${row.eventType} (${row.id}):`,
            message,
          );
        }
      }
    }
  }

  private async purgeExpired(): Promise<void> {
    const publishedBefore = new Date();
    publishedBefore.setDate(
      publishedBefore.getDate() - (this.options.publishedRetentionDays ?? 7),
    );
    const failedBefore = new Date();
    failedBefore.setDate(
      failedBefore.getDate() - (this.options.failedRetentionDays ?? 30),
    );
    await this.repository.purge({ publishedBefore, failedBefore });
  }
}
