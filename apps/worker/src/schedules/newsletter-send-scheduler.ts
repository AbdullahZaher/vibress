import {
  DrizzleSendRepository,
  NewslettersService,
  DrizzleNewsletterPreferenceRepository,
  BillingAwareMemberAudienceRepository,
} from '@vibress/newsletters';
import {
  DrizzleMemberRepository,
} from '@vibress/members';
import {
  DrizzleSubscriptionRepository,
} from '@vibress/subscriptions';
import {
  DrizzleEmailRecipientRepository,
  DrizzleEmailSuppressionRepository,
} from '@vibress/email';
import { getEmailQueue } from '../queues/email-queue';
import { getConfig } from '@vibress/config';

const BATCH_SIZE = 25;
const appConfig = getConfig();

/**
 * Durable scheduled-send scheduler: polls the database for due sends and
 * enqueues their delivery batches. Restart-safe — scheduled sends survive
 * worker restarts because the schedule lives in the database.
 */
export class NewsletterSendSchedulerWorker {
  private sendRepo = new DrizzleSendRepository();
  private recipientRepo = new DrizzleEmailRecipientRepository();
  private suppressionRepo = new DrizzleEmailSuppressionRepository();
  private newslettersService = new NewslettersService({
    newsletterRepo: undefined as never,
    preferenceRepo: new DrizzleNewsletterPreferenceRepository(),
    sendRepo: this.sendRepo,
    audienceRepo: new BillingAwareMemberAudienceRepository(new DrizzleMemberRepository(), new DrizzleSubscriptionRepository()),
    isMemberSuppressed: (email) => this.suppressionRepo.isSuppressed(email),
    unsubscribeSecret: appConfig.newsletters.unsubscribeSecret || 'dev-unsub-secret',
    portalUrl: appConfig.site.portalUrl,
  });
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  async startSendAndEnqueue(sendId: string): Promise<{ recipientCount: number; batchCount: number }> {
    const { send, recipientCount } = await this.newslettersService.startSend(sendId, async (rows) => {
      return this.recipientRepo.createMany(rows.map((r) => ({ ...r, sendId })));
    });
    if (recipientCount === 0) {
      await this.newslettersService.completeSend(sendId);
      return { recipientCount: 0, batchCount: 0 };
    }

    const queue = getEmailQueue();
    const pending = await this.recipientRepo.findPending(sendId, recipientCount);
    const batches: string[][] = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      batches.push(pending.slice(i, i + BATCH_SIZE).map((r) => r.id));
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      await queue.add(
        'deliver',
        { sendId, recipientIds: batch },
        { jobId: `send-${sendId}-batch-${i}`, removeOnComplete: true, removeOnFail: 1000 }
      );
    }
    return { recipientCount, batchCount: batches.length };
  }

  async runReconciliationSweep(): Promise<{ started: number }> {
    const now = new Date();
    const due = await this.sendRepo.findDueScheduled(now, 20);
    let started = 0;
    for (const send of due) {
      try {
        // Guard against races: only start sends still in 'scheduled' state.
        const current = await this.sendRepo.findById(send.id);
        if (!current || current.status !== 'scheduled') continue;
        await this.startSendAndEnqueue(send.id);
        started++;
        console.log(`[SendScheduler] Started scheduled send ${send.id} ("${send.subject}")`);
      } catch (err: any) {
        console.error(`[SendScheduler] Failed to start send ${send.id}:`, err.message || err);
        await this.newslettersService.failSend(send.id, err.message || 'scheduler failure');
      }
    }
    return { started };
  }

  start(intervalMs = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runReconciliationSweep().catch((err) => console.error('[SendScheduler] Initial sweep failed:', err));
    this.intervalTimer = setInterval(() => {
      this.runReconciliationSweep().catch((err) => console.error('[SendScheduler] Sweep error:', err));
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isRunning = false;
  }
}
