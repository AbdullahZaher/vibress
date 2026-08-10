# Billing Webhooks

## Flow

```
Payment Provider
      ↓
POST /api/webhooks/v1/billing/:provider
      ↓ verify signature (raw body, 256 KB cap)
      ↓ persist billing_webhook_events (UNIQUE(provider, provider_event_id), payload hash)
      ↓ ACK 200
      ↓ process event (synchronous, durable)
      ↓ map provider status → canonical Vibress status
      ↓ update subscription via SubscriptionsService (out-of-order guarded)
      ↓ record billing_events history
      ↓ mark processed / mark failed (retryable)
```

## Event Handling

| Provider event | Vibress mapping |
|---|---|
| `checkout.session.completed` | `checkout.completed` |
| `customer.subscription.created` | `subscription.created` |
| `customer.subscription.updated` | `subscription.updated` |
| `customer.subscription.deleted` | `subscription.cancelled` |
| `invoice.payment_succeeded` | `subscription.payment_succeeded` |
| `invoice.payment_failed` | `subscription.payment_failed` |

Invoice-type events resolve the subscription from `object.subscription`;
subscription events use `object.id`.

## Deduplication

`UNIQUE(provider, provider_event_id)` guarantees one durable record per event.
Replays return 200 without re-processing; previously failed events are retried
from the record.

## Out-of-Order Protection

`subscriptions.provider_event_timestamp` stores the newest applied provider
event timestamp. `SubscriptionsService.applyProviderUpdate` ignores events
older than the last applied timestamp, so late deliveries cannot overwrite
newer subscription state.

## Retry

Failed processing leaves the event `status='failed'` with `attempt_count` and
`last_error`. Retries re-run `processEvent` from the durable record.

## Logging

Logs contain provider, event ID, event type, processing result, and request
ID. Never: signature secrets, raw payment data, full checkout objects, or
authorization credentials.
