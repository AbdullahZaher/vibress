import { Queue, QUEUE_NAMES, getBullMqRedisConnection } from '@vibress/queue';
import { NewslettersService } from '@vibress/newsletters';
import { DrizzleEmailRecipientRepository } from '@vibress/email';

const EMAIL_QUEUE_NAME = QUEUE_NAMES.EMAIL_DELIVERY;
const BATCH_SIZE = 25;

/**
 * Newsletter send enqueuer: snapshots the audience, creates recipient rows,
 * and enqueues delivery batches into the shared BullMQ queue consumed by the
 * worker. Idempotent against double invocation because the worker only sends
 * recipients still in 'pending' state.
 */
export class NewsletterSendEnqueuer {
  private recipientRepo = new DrizzleEmailRecipientRepository();
  private queue: Queue | null = null;

  constructor(private newslettersService: NewslettersService) {}

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(EMAIL_QUEUE_NAME, {
        connection: getBullMqRedisConnection(),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      });
    }
    return this.queue;
  }

  async startSendAndEnqueue(sendId: string): Promise<{ recipientCount: number; batchCount: number }> {
    const { send, recipientCount } = await this.newslettersService.startSend(sendId, async (rows) => {
      return this.recipientRepo.createMany(rows.map((r) => ({ ...r, sendId })));
    });
    if (recipientCount === 0) {
      await this.newslettersService.completeSend(sendId);
      return { recipientCount: 0, batchCount: 0 };
    }

    const queue = this.getQueue();
    const pending = await this.recipientRepo.findPending(sendId, recipientCount);
    const batches: string[][] = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      batches.push(pending.slice(i, i + BATCH_SIZE).map((r) => r.id));
    }

    for (let i = 0; i < batches.length; i++) {
      await queue.add(
        'deliver',
        { sendId, recipientIds: batches[i] },
        { jobId: `send-${sendId}-batch-${i}`, removeOnComplete: true, removeOnFail: 1000 }
      );
    }
    return { recipientCount, batchCount: batches.length };
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}
