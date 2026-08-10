import { Queue } from 'bullmq';
import { getBullMqRedisConnection } from '@vibress/cache';

export interface EmailDeliveryJob {
  sendId: string;
  recipientIds: string[];
}

let emailQueue: Queue<EmailDeliveryJob> | null = null;

export const EMAIL_QUEUE_NAME = 'vibress-email-delivery';

export function getEmailQueue(): Queue<EmailDeliveryJob> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailDeliveryJob>(EMAIL_QUEUE_NAME, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return emailQueue;
}

export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
}
