# Email Webhooks

## Endpoint

`POST /api/webhooks/v1/email/:provider` (`apps/api/src/routes/email-webhooks.ts`)

- Scoped buffer content-type parser preserves the raw body for signature
  verification (no JSON parse/re-serialize first).
- `x-email-signature` header required; verification via provider
  `verifyWebhookSignature`.
- 256 KB payload cap; invalid signature → 400.
- Signature is the sole authentication (no cookie auth).

## Event Flow

```text
Provider
  → POST /api/webhooks/v1/email/smtp
  → verify HMAC signature (raw body)
  → persist provider_events (UNIQUE(provider, provider_event_id), payload hash)
  → ACK 200
  → normalize event type → Vibress state (delivered/bounced/complained/failed/opened/clicked)
  → match recipient by provider_message_id (angle-bracket tolerant)
  → update recipient state + record email_events
  → suppression policy applied for bounce/complaint/failed
  → mark processed (retryable on failure)
```

## Deduplication

`UNIQUE(provider, provider_event_id)` guarantees one durable record per event.
Replays return 200 without re-processing; previously failed events are retried
from the durable record.

## Supported Events

| Provider type                  | Vibress mapping | Recipient effect                         |
| ------------------------------ | --------------- | ---------------------------------------- |
| `delivered`                    | `delivered`     | `markDelivered`                          |
| `opened`                       | `opened`        | `markOpened`                             |
| `clicked`                      | `clicked`       | `markClicked`                            |
| `bounce`                       | `bounced`       | `markFailed` + suppress `hard_bounce`    |
| `complaint`                    | `complained`    | `markFailed` + suppress `spam_complaint` |
| `failed` / `permanent_failure` | `failed`        | `markFailed` + suppress `hard_bounce`    |

## Safe Logging

Logs contain provider, event ID, event type, and processing result. Never:
signature secrets, unsubscribe tokens, raw payloads, or full recipient data.

## Tracking Privacy

Open/click tracking is explicit and opt-in at the provider level (events are
only processed when the provider delivers them); no additional PII is
collected beyond the delivery event metadata.
