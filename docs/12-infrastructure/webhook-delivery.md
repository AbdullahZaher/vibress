# Webhook Delivery (Infrastructure)

## Queue

- BullMQ queue `vibress-webhook-delivery` (Redis via
  `getBullMqRedisConnection`).
- Jobs: `{ deliveryId, endpointId }` with stable IDs `delivery-<id>`.
- The API process enqueues; the worker (`WebhookDeliveryWorker`) consumes
  with concurrency 4.

## Worker

`apps/worker/src/processors/webhook-delivery-worker.ts`

- Calls `WebhooksService.deliver(deliveryId)` per job.
- `deliver` increments attempt count, recomputes the signature, sends via the
  hardened `safeFetch` client, and transitions state:
  - 2xx → `delivered`
  - other/error → bounded retry (re-enqueue), exhaustion → `dead_letter`
- Domain-level retries (max 5) are the source of truth; BullMQ job attempts
  are 1 (no double handling).

## Event Bridge

`apps/api/src/webhook-event-bridge.ts` subscribes to subscribed domain events
(`post.published`, `comment.created`, `comment.replied`,
`subscription.activated`, `subscription.cancelled`, `newsletter.sent`,
`member.newsletter_subscribed`, `member.newsletter_unsubscribed`) and calls
`WebhooksService.dispatchEvent`, which persists deliveries and enqueues them.

## Observability

- Delivery latency/result observed through `webhook_deliveries` status,
  `attempt_count`, `response_status`, `last_error`.
- No secrets in logs: signing secrets, event payloads, and delivery bodies
  are never logged.
