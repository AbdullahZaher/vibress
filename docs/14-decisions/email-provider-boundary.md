# ADR-015: Email Provider Boundary

**Status:** Accepted
**Date:** Batch 10

## Context

Vibress needs newsletter/marketing email delivery. Without a boundary,
provider SDK types and webhook payload formats would leak into the
Newsletters domain, making future ESP providers expensive and delivery truth
unreliable. Newsletters (content/audience/send semantics) and Email
(delivery/recipients/suppression/webhooks) are distinct concerns.

## Decision

1. **Two domains, one boundary.** `@vibress/newsletters` owns newsletter
   definitions, member preferences, audience resolution, send/campaign
   records, rendering, and unsubscribe tokens. `@vibress/email` owns
   recipients, delivery state, event history, suppression policy, and the
   provider abstraction. Newsletters depends on Email's interfaces; Email
   never imports Newsletters.

2. **Provider-neutral `EmailProvider` interface.** `send`, `sendBatch`,
   `verifyWebhookSignature`, `parseWebhookEvent`. Provider SDK types never
   leave the adapter. Provider statuses map to canonical Vibress states.

3. **SMTP is the first adapter.** Mailpit in development via nodemailer.
   Webhook events use an HMAC-SHA256 signed JSON envelope verified with a
   configured webhook secret — the signature contract mirrors what an ESP
   adapter would implement with its native signature scheme. Future ESP
   adapters implement the same interface and pass equivalent contract tests.

4. **Vibress owns delivery truth.** The worker persists provider message IDs
   and recipient state; webhooks update it. Provider event IDs are deduplicated
   durably (`provider_events`, `UNIQUE(provider, provider_event_id)`).
   Recipient-level status guards make queue retries idempotent.

5. **Suppression policy lives in the Email domain.** Hard bounces and spam
   complaints automatically suppress addresses; delivery/open/click never
   suppress. Policy is applied at audience resolution and re-checked at
   delivery time — never scattered in worker conditionals.

6. **Transactional email is unaffected.** Member magic-link mail uses its own
   mailer path and is never blocked by newsletter suppression.

7. **Studio JSON is the canonical content source.** Email HTML and plain text
   are rendered from Studio documents (`@vibress/studio-renderer`,
   `target: 'email'`) with unsubscribe links injected server-side. Arbitrary
   Web HTML is never the email source.

## Consequences

- Future ESPs (Postmark/SendGrid/etc.) implement `EmailProvider` and pass the
  contract tests.
- A provider outage surfaces as provider-level errors; sends stay retryable.
- Unsubscribe tokens are cryptographic, scoped, and idempotent — no login
  required, no member enumeration.
- Secrets (`EMAIL_WEBHOOK_SECRET`, `NEWSLETTER_UNSUBSCRIBE_SECRET`, SMTP
  credentials) are environment configuration only.
