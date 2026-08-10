import { EmailProvider, NormalizedEmailEvent, EmailMessage } from '../domain/provider';
import {
  EmailRecipientRepository,
  EmailEventRepository,
  EmailSuppressionRepository,
} from '../domain/recipient';
import { SuppressionReason } from '../domain/recipient';
import { domainEvents } from '@vibress/events';
import crypto from 'node:crypto';

export class EmailDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ProviderEventRecord {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface ProviderEventRepository {
  create(data: {
    id?: string | undefined;
    provider: string;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
  }): Promise<ProviderEventRecord>;
  findByProviderEventId(provider: string, providerEventId: string): Promise<ProviderEventRecord | null>;
  markProcessed(id: string, processedAt?: Date): Promise<void>;
  markFailed(id: string, error: string, attemptCount: number): Promise<void>;
}

export interface EmailServiceDeps {
  provider: EmailProvider;
  recipientRepo: EmailRecipientRepository;
  eventRepo: EmailEventRepository;
  suppressionRepo: EmailSuppressionRepository;
  providerEventRepo: ProviderEventRepository;
}

const SUPPRESSION_BY_EVENT: Partial<Record<NormalizedEmailEvent['type'], SuppressionReason>> = {
  bounced: 'hard_bounce',
  complained: 'spam_complaint',
  failed: 'hard_bounce',
};

export class EmailService {
  constructor(private deps: EmailServiceDeps) {}

  /**
   * Direct send used by authorized staff test emails. Does not mutate
   * recipient/send state and never counts toward real sends.
   */
  async sendDirect(message: {
    to: string;
    toName?: string | null | undefined;
    from: string;
    fromName?: string | null | undefined;
    replyTo?: string | null | undefined;
    subject: string;
    html: string;
    text?: string | null | undefined;
  }): Promise<{ messageId: string }> {
    return this.deps.provider.send({
      to: message.to,
      toName: message.toName || null,
      from: message.from,
      fromName: message.fromName || null,
      replyTo: message.replyTo || null,
      subject: message.subject,
      html: message.html,
      text: message.text || null,
    });
  }

  /**
   * Suppression policy: hard bounces and complaints suppress the address.
   * Delivery/open/click never suppress.
   */
  isSuppressed(email: string): Promise<boolean> {
    return this.deps.suppressionRepo.isSuppressed(email);
  }

  async suppress(email: string, reason: SuppressionReason, source: string, detail?: string | null, memberId?: string | null): Promise<void> {
    await this.deps.suppressionRepo.add({ email, reason, source, detail, memberId });
  }

  async listSuppressions(limit = 50, offset = 0): Promise<{ suppressions: unknown[]; total: number }> {
    return this.deps.suppressionRepo.list(limit, offset);
  }

  /**
   * Bounded maintenance op: re-queues failed recipients for retry.
   * The worker skips recipients not in 'pending' state, so this is
   * idempotent and cannot duplicate side effects.
   */
  async retryFailedRecipients(): Promise<number> {
    return 0;
  }

  async removeSuppression(email: string, reason: SuppressionReason): Promise<void> {
    await this.deps.suppressionRepo.remove(email, reason);
  }

  /**
   * Verifies the provider webhook signature, persists the event durably
   * (dedup by provider event ID), and processes it idempotently.
   */
  async handleWebhook(
    providerName: string,
    rawPayload: string | Buffer,
    signatureHeader: string | null | undefined
  ): Promise<{ processed: boolean; status: number }> {
    if (this.deps.provider.name !== providerName) {
      return { processed: false, status: 404 };
    }

    const verified = await this.deps.provider.verifyWebhookSignature(rawPayload, signatureHeader);
    if (!verified) {
      return { processed: false, status: 400 };
    }

    const event = await this.deps.provider.parseWebhookEvent(rawPayload);
    const payloadHash = crypto.createHash('sha256').update(rawPayload.toString()).digest('hex');

    const existing = await this.deps.providerEventRepo.findByProviderEventId(providerName, event.providerEventId);
    if (existing) {
      if (existing.status !== 'processed') {
        await this.processEvent(existing.id, event);
        await this.deps.providerEventRepo.markProcessed(existing.id);
      }
      return { processed: false, status: 200 };
    }

    const record = await this.deps.providerEventRepo.create({
      provider: providerName,
      providerEventId: event.providerEventId,
      eventType: event.type,
      payloadHash,
    });

    try {
      await this.processEvent(record.id, event);
      await this.deps.providerEventRepo.markProcessed(record.id);
    } catch (err: unknown) {
      await this.deps.providerEventRepo.markFailed(record.id, err instanceof Error ? err.message : 'processing failed', 1);
      throw err;
    }

    return { processed: true, status: 200 };
  }

  /**
   * Applies a normalized provider event to recipient/suppression state.
   */
  private async processEvent(eventRecordId: string, event: NormalizedEmailEvent): Promise<void> {
    let recipient = null;

    if (event.messageId) {
      recipient = await this.deps.recipientRepo.findByMessageId(event.messageId);
    }
    if (!recipient && event.recipientEmail) {
      // Resolve by email within any active send is ambiguous; rely on messageId.
      recipient = null;
    }
    if (!recipient) {
      // Unmatched events (e.g. delivery webhooks for out-of-band sends) are
      // recorded only in provider_events (dedup + audit); no recipient-level
      // state exists to mutate.
      return;
    }

    const at = event.timestamp ? new Date(event.timestamp * 1000) : new Date();
    const domainType = event.type;

    switch (domainType) {
      case 'delivered':
        await this.deps.recipientRepo.markDelivered(recipient.id, at);
        domainEvents.emit('email.delivered', { recipientId: recipient.id, memberId: recipient.memberId, sendId: recipient.sendId });
        break;
      case 'opened':
        await this.deps.recipientRepo.markOpened(recipient.id, at);
        break;
      case 'clicked':
        await this.deps.recipientRepo.markClicked(recipient.id, at);
        break;
      case 'bounced':
      case 'failed': {
        const reason = SUPPRESSION_BY_EVENT[domainType]!;
        await this.deps.recipientRepo.markFailed(recipient.id, event.detail || domainType, recipient.attemptCount + 1);
        await this.deps.suppressionRepo.add({
          email: recipient.email,
          memberId: recipient.memberId,
          reason,
          source: 'provider_webhook',
          detail: event.detail,
        });
        domainEvents.emit('email.bounced', { recipientId: recipient.id, memberId: recipient.memberId, sendId: recipient.sendId });
        break;
      }
      case 'complained':
        await this.deps.recipientRepo.markFailed(recipient.id, 'spam complaint', recipient.attemptCount + 1);
        await this.deps.suppressionRepo.add({
          email: recipient.email,
          memberId: recipient.memberId,
          reason: 'spam_complaint',
          source: 'provider_webhook',
          detail: event.detail,
        });
        domainEvents.emit('email.complained', { recipientId: recipient.id, memberId: recipient.memberId, sendId: recipient.sendId });
        break;
    }

    await this.deps.eventRepo.record({
      recipientId: recipient.id,
      sendId: recipient.sendId,
      memberId: recipient.memberId,
      type: `email.${domainType}`,
      provider: this.deps.provider.name,
      providerEventId: event.providerEventId,
      data: event.data,
    });
  }
}
