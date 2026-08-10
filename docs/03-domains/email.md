# Email (Delivery Domain)

## Provider Boundary

`EmailProvider` (`packages/domains/email/src/domain/provider.ts`):

```ts
send(message): Promise<{ messageId }>
sendBatch(messages): Promise<EmailSendResult[]>
verifyWebhookSignature(payload, signatureHeader): Promise<boolean>
parseWebhookEvent(payload): Promise<NormalizedEmailEvent>
```

Provider SDK types never leak into domain contracts. Provider statuses map to
Vibress states: `delivered`, `bounced`, `complained`, `failed`, `opened`,
`clicked`.

## First Adapter: SMTP (Mailpit in development)

`infrastructure/smtp/smtp-provider.ts` wraps nodemailer. Webhook events use an
HMAC-SHA256-signed JSON envelope verified with the configured webhook secret —
the signature contract mirrors what an ESP adapter would implement with its
native signature scheme.

## Recipients

`email_recipients` is the per-send snapshot:

| Field | Notes |
|---|---|
| `send_id` FK | Belongs to the send |
| `member_id` FK null | Identity link (set null on member delete) |
| `email` / `name` | Delivery address |
| `status` | `pending` → `queued` → `sent` → `delivered` / `bounced` / `complained` / `failed` / `unsubscribed` / `suppressed` |
| `provider_message_id` | Stable provider message identity for webhook matching |
| `unsubscribe_token` | Per-recipient signed token |
| `attempt_count` / `last_error` | Retry visibility |
| `UNIQUE(member_id, send_id)` | No duplicate recipients per send |

## Suppression Policy (Email domain owns it)

`email_suppressions` with reasons: `hard_bounce`, `spam_complaint`, `manual`,
`provider_suppression`. `UNIQUE(email, reason)`.

- Hard bounces and complaints automatically suppress the address
  (source `provider_webhook`).
- Delivery/open/click never suppress.
- Suppressed addresses are excluded at audience resolution AND re-checked at
  delivery time by the worker.
- Policy lives in `EmailService`/`DrizzleEmailSuppressionRepository`, never in
  worker conditionals.
- Admin can view (`email.read`) and remove (`email.manage`) suppressions.

## Transactional vs Marketing Email

Member magic-link authentication mail uses the member auth mailer (SMTP
direct) and is **not** affected by newsletter suppressions. A newsletter
unsubscribe never disables critical authentication email.

## Events

`email_events` records immutable delivery history per recipient:
`email.sent`, `email.delivered`, `email.bounced`, `email.complained`,
`email.opened`, `email.clicked`, plus provider event IDs for dedup correlation.

## Retry Policy

- Transient provider failures → bounded BullMQ retries (5 attempts,
  exponential backoff from 5s).
- Permanent recipient failures (hard bounce) → suppressed, no infinite retry.
- Configuration failures → fail visibly (`failed` status with `last_error`).
- Recipient-level `attempt_count` caps re-sends at 3.
