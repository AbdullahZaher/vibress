import { AutomationAction } from '@vibress/automations';
import { DrizzleEmailRecipientRepository, DrizzleEmailEventRepository, SmtpEmailProvider, EmailMessage } from '@vibress/email';
import { WebhooksService, DrizzleWebhookRepository } from '@vibress/webhooks';
import { DrizzleNewsletterPreferenceRepository } from '@vibress/newsletters';
import { Queue, QUEUE_NAMES, enqueueTraced, getBullMqRedisConnection } from '@vibress/queue';
import { getConfig } from '@vibress/config';

const WEBHOOK_QUEUE = QUEUE_NAMES.WEBHOOK_DELIVERY;

/**
 * Automation action executor. Actions delegate to domain services — the
 * automation domain never writes another domain's DB tables directly.
 * Idempotency is enforced by the run/step state machine (completed steps
 * are never re-executed), so retries cannot duplicate side effects.
 */
export class AutomationActionExecutor {
  private config = getConfig();
  private emailProvider = new SmtpEmailProvider({
    host: this.config.smtp.host,
    port: this.config.smtp.port,
    secure: this.config.smtp.secure,
    user: this.config.smtp.user,
    pass: this.config.smtp.pass,
  });
  private webhooksService = new WebhooksService(new DrizzleWebhookRepository(), {
    enqueue: async (deliveryId: string, endpointId: string) => {
      const queue = new Queue(WEBHOOK_QUEUE, { connection: getBullMqRedisConnection() });
      await enqueueTraced(queue, 'deliver', { deliveryId, endpointId }, { jobId: `delivery-${deliveryId}` });
      await queue.close();
    },
  });
  private newsletterPrefRepo = new DrizzleNewsletterPreferenceRepository();

  async execute(
    action: AutomationAction,
    context: { runId: string; stepIndex: number; memberId?: string | null; eventPayload: Record<string, unknown> | null }
  ): Promise<{ result: Record<string, unknown> }> {
    switch (action.type) {
      case 'email': {
        const to = String(action.config.to || '');
        const subject = String(action.config.subject || '');
        const body = String(action.config.body || '');
        if (!to || !subject) throw new Error('email action requires to and subject');
        const message: EmailMessage = {
          to,
          toName: null,
          from: this.config.smtp.from,
          fromName: 'Vibress',
          replyTo: null,
          subject,
          html: `<div style="font-family:sans-serif">${escapeHtml(body)}</div>`,
          text: body,
        };
        const result = await this.emailProvider.send(message);
        return { result: { messageId: result.messageId } };
      }

      case 'webhook': {
        const url = String(action.config.url || '');
        const eventType = String(action.config.eventType || 'automation.action');
        if (!url) throw new Error('webhook action requires url');
        // Validate SSRF at execution time; delivery happens via the outbound webhook pipeline
        const { isSafeUrl } = await import('@vibress/security');
        if (!isSafeUrl(url)) throw new Error('webhook action URL is unsafe');
        const endpoint = await this.webhooksService.createEndpoint({
          name: `automation:${context.runId}`,
          url,
          secret: null,
          eventTypes: [eventType],
        }, null);
        await this.webhooksService.dispatchEvent(eventType, { ...context.eventPayload, originAutomationId: context.runId });
        // Clean up the transient endpoint after dispatch
        await this.webhooksService.deleteEndpoint(endpoint.id, null);
        return { result: { dispatched: true, eventType } };
      }

      case 'newsletter_subscribe':
      case 'newsletter_unsubscribe': {
        const newsletterId = String(action.config.newsletterId || '');
        const memberId = context.memberId || String(action.config.memberId || '');
        if (!newsletterId || !memberId) throw new Error(`${action.type} action requires newsletterId and memberId`);
        const subscribed = action.type === 'newsletter_subscribe';
        await this.newsletterPrefRepo.setSubscription(memberId, newsletterId, subscribed);
        return { result: { memberId, newsletterId, subscribed } };
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
