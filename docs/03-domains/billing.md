# Billing

The billing domain coordinates providers, checkout, webhooks, and event
history. See the ADR
[`docs/14-decisions/billing-provider-boundary.md`](../14-decisions/billing-provider-boundary.md)
for the durable architecture decision.

## Provider Abstraction

`BillingProvider` (`packages/domains/billing/src/domain/provider.ts`):

```ts
createCustomer(input): Promise<string>
createCheckoutSession(input): Promise<{ url, checkoutSessionId }>
createBillingPortalSession(input): Promise<{ url }>
getSubscription(id): Promise<BillingSubscriptionInfo | null>
cancelSubscription(id): Promise<void>
verifyWebhookSignature(payload, signatureHeader): Promise<boolean>
parseWebhookEvent(payload): Promise<{ id, type, created, data }>
```

- Provider SDK types never leave the adapter.
- Provider errors map to stable codes: `BILLING_PROVIDER_UNAVAILABLE`
  (network/API failures) and `BILLING_CONFIGURATION_ERROR` (invalid
  price/product mapping).
- The Stripe adapter (`infrastructure/stripe/`) is the first implementation.

## Mappings

- `billing_customers`: `UNIQUE(member_id, provider)` — provider customer IDs
  are mapped, never identity.
- `billing_plan_mappings`: `UNIQUE(plan_id, provider)` — Vibress plans stay
  provider-neutral; provider product/price IDs are explicit mappings.

## Configuration

| Variable                 | Purpose                                |
| ------------------------ | -------------------------------------- |
| `BILLING_PROVIDER`       | provider name (reserved)               |
| `STRIPE_SECRET_KEY`      | server secret — never sent to browsers |
| `STRIPE_PUBLISHABLE_KEY` | optional client credential for Portal  |
| `STRIPE_WEBHOOK_SECRET`  | webhook signature verification         |

Secrets are environment configuration. They are never logged, never returned
by APIs, never stored in audit payloads, and never shown in error messages.
No plaintext provider-secret database storage.

## Checkout

1. Authenticated member chooses a plan (`planId`, optional `offerKey`).
2. Server validates member, product, plan (active), offer, and the
   one-active-subscription-per-product rule.
3. Provider-hosted checkout session is created with server-resolved price.
   The browser can never supply an amount.
4. Success/cancel URLs derive from `PORTAL_URL` plus fixed internal paths
   (`/account`, `/plans`) — never from `Host`/`Origin`/`Referer`.

Free plans bypass the provider entirely (no fake provider records).

## Webhooks

- Endpoint: `POST /api/webhooks/v1/billing/:provider`.
- Security: provider signature verification on the **raw body** (scoped
  buffer content-type parser; no JSON re-serialization before verification).
  No cookie auth. Payload size capped at 256 KB.
- Persistence model: verify → persist `billing_webhook_events`
  (`UNIQUE(provider, provider_event_id)`, payload hash) → process →
  mark processed. ACK only after durable persistence.
- Deduplication: replays and duplicates are idempotent by event ID.
- Retry: failed processing is retryable from the durable event record.
- Out-of-order: `provider_event_timestamp` guard (see subscriptions doc).
- Logs include provider, event ID, type, result, duration — never the
  signature secret, raw payment data, or full checkout objects.

## Event History

`billing_events` is an immutable operational history:
subscription id / member id / provider / provider event id / type / occurred
at / safe normalized data. Raw provider payloads are not retained; a payload
hash is kept in `billing_webhook_events`.

## Health

Provider outages map to `BILLING_PROVIDER_UNAVAILABLE` at the domain level.
API `/health/live` and `/health/ready` remain independent of provider
availability (no external provider in readiness checks).
