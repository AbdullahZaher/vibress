import {
  Queue,
  QUEUE_NAMES,
  QUEUE_DEFAULTS,
  EmailDeliveryJob,
  getBullMqRedisConnection,
} from '@vibress/queue';

export const EMAIL_QUEUE_NAME = QUEUE_NAMES.EMAIL_DELIVERY;
export type { EmailDeliveryJob };

let emailQueue: Queue<EmailDeliveryJob> | null = null;

export function getEmailQueue(): Queue<EmailDeliveryJob> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailDeliveryJob>(EMAIL_QUEUE_NAME, {
      connection: getBullMqRedisConnection(),
      defaultJobOptions: QUEUE_DEFAULTS.EMAIL,
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
