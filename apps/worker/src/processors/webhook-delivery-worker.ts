import { Queue, Worker, QUEUE_NAMES, WebhookDeliveryJob, enqueueTraced, getBullMqRedisConnection } from '@vibress/queue';
import { WebhooksService, DrizzleWebhookRepository } from '@vibress/webhooks';
import { tracedProcessor } from './trace-helper';

const WEBHOOK_QUEUE_NAME = QUEUE_NAMES.WEBHOOK_DELIVERY;

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
    await enqueueTraced(this.getQueue(), 'deliver', { deliveryId, endpointId }, {
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
      tracedProcessor('worker.job.webhook-delivery', async (job) => {
        await this.webhooksService.deliver(job.data.deliveryId);
      }),
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
