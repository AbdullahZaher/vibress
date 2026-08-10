# Billing Provider & Webhooks (Infrastructure)

## Stripe Adapter

Location: `packages/domains/billing/src/infrastructure/stripe/stripe-provider.ts`

- Wraps the Stripe SDK; implements `BillingProvider` (see
  `docs/03-domains/billing.md`).
- Raw Stripe objects (`Stripe.Customer`, `Stripe.Checkout.Session`,
  `Stripe.Event`, …) never leave the adapter.
- Webhook verification uses `stripe.webhooks.constructEvent` over the raw
  body with `STRIPE_WEBHOOK_SECRET`.
- Errors are mapped: connection/API failures →
  `BILLING_PROVIDER_UNAVAILABLE`; invalid requests → `BILLING_CONFIGURATION_ERROR`.

## Provider Contract Tests

`packages/domains/billing/tests/stripe-provider.test.ts` is the reusable
provider contract suite (webhook verification with generated signed events,
event normalization, error mapping). Future providers implement the same
`BillingProvider` surface and pass equivalent tests.

## Webhook Endpoint

`POST /api/webhooks/v1/billing/:provider` (`apps/api/src/routes/billing-webhooks.ts`)

- Scoped content-type parser reads JSON as a raw `Buffer` — signature
  verification runs on the exact received bytes; no JSON parse/re-serialize
  beforehand.
- 256 KB payload cap; `stripe-signature` header required.
- Processing: verify signature → persist `billing_webhook_events` with payload
  hash → process → mark processed. Duplicates are idempotent.
- Processing failures are persisted as retryable (`status='failed'`,
  `attempt_count`, `last_error`); the endpoint ACKs after durable persistence.

## Local Development

- Mailpit at `127.0.0.1:1025` (SMTP) / `8025` (API+UI) for transactional mail;
  billing mail uses the same mailer path as member auth.
- No real Stripe keys are required for development; the adapter degrades to
  `BILLING_PROVIDER_UNAVAILABLE`/`BILLING_CONFIGURATION_ERROR` semantics when
  `STRIPE_SECRET_KEY` is missing or invalid.
- Webhook runtime verification is performed with locally generated signed
  events (`Stripe.webhooks.generateTestHeaderString`) in integration and E2E
  suites. Live-provider E2E was **not** executed — test-mode compatibility is
  structural, not claimed as a live-provider PASS.
