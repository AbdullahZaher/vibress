import { Queue, Worker, Job } from 'bullmq';
import { getBullMqRedisConnection } from '@vibress/cache';
import { WebhooksService, DrizzleWebhookRepository } from '@vibress/webhooks';

export interface WebhookDeliveryJob {
  deliveryId: string;
  endpointId: string;
}

const WEBHOOK_QUEUE_NAME = 'vibress-webhook-delivery';

class BullMqDispatcher {
  private queue: Queue<WebhookDeliveryJob> | null = null;

  private getQueue(): Queue<WebhookDeliveryJob> {
    if (!this.queue) {
      this.queue = new Queue<WebhookDeliveryJob>(WEBHOOK_QUEUE_NAME, {
        connection: getBullMqRedisConnection(),
        defaultJobOptions: {
          attempts: 1, // retries handled by the domain (bounded, backoff)
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      });
    }
    return this.queue;
  }

  async enqueue(deliveryId: string, endpointId: string): Promise<void> {
    await this.getQueue().add('deliver', { deliveryId, endpointId }, {
      jobId: `delivery-${deliveryId}`,
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

export class WebhookDeliveryWorker {
  private worker: Worker<WebhookDeliveryJob> | null = null;
  private webhooksService: WebhooksService;
  private dispatcher = new BullMqDispatcher();

  constructor() {
    const repo = new DrizzleWebhookRepository();
    this.webhooksService = new WebhooksService(repo, {
      enqueue: (deliveryId, endpointId) => this.dispatcher.enqueue(deliveryId, endpointId),
    });
  }

  async start(): Promise<void> {
    this.worker = new Worker<WebhookDeliveryJob>(
      WEBHOOK_QUEUE_NAME,
      async (job) => {
        await this.webhooksService.deliver(job.data.deliveryId);
      },
      {
        connection: getBullMqRedisConnection(),
        concurrency: 4,
      }
    );
    this.worker.on('failed', (job, err) => {
      console.error(`[WebhookWorker] Delivery job ${job?.id} failed:`, err.message);
    });
    this.worker.on('completed', (job) => {
      console.log(`[WebhookWorker] Delivery job ${job.id} completed`);
    });
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.dispatcher.close();
  }
}
