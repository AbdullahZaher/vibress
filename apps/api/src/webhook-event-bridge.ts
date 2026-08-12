import { domainEvents, DomainEvent } from '@vibress/events';
import { webhooksService } from './services';

/**
 * Bridges domain events to outbound webhook deliveries.
 * Subscribes to emitted domain events and dispatches matching events
 * through the webhook service (which persists deliveries durably and
 * enqueues them for the worker).
 */
const SUBSCRIBED_EVENTS = [
  'post.published',
  'comment.created',
  'comment.replied',
  'subscription.activated',
  'subscription.cancelled',
  'newsletter.sent',
  'member.newsletter_subscribed',
  'member.newsletter_unsubscribed',
];

export function startWebhookEventBridge(): void {
  for (const eventName of SUBSCRIBED_EVENTS) {
    domainEvents.on(eventName, (event: DomainEvent) => {
      webhooksService
        .dispatchEvent(event.name, event.payload)
        .catch((err: unknown) => {
          console.error(`[WebhookBridge] dispatch of ${event.name} failed:`, err instanceof Error ? err.message : String(err));
        });
    });
  }
}
