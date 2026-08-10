# ADR-014: Billing Provider Boundary

**Status:** Accepted
**Date:** Batch 9

## Context

Vibress needs a commercial membership and subscription foundation. Payment
processing requires an external provider. Without a boundary, Stripe SDK types
and webhook payloads would leak into every domain, making future providers
expensive and subscription truth unreliable.

## Decision

1. **Member ID is the subscription identity.** `subscriptions.member_id` is the
   stable commercial identity. Email addresses, session IDs, and staff user IDs
   are never subscription identity. A member may change email; the subscription
   follows `member.id`.

2. **A provider-neutral Billing domain.** `packages/domains/billing` defines a
   `BillingProvider` interface (`createCustomer`, `createCheckoutSession`,
   `createBillingPortalSession`, `getSubscription`, `cancelSubscription`,
   `verifyWebhookSignature`, `parseWebhookEvent`). Domain code never imports
   provider SDK types.

3. **Stripe is the first adapter.** Stripe-specific code lives only in
   `packages/domains/billing/src/infrastructure/stripe/`. Raw Stripe objects
   never leave the adapter; the adapter maps to provider-neutral DTOs and maps
   provider errors to stable Vibress error codes.

4. **Provider-hosted checkout.** Vibress never handles raw card data (PAN). The
   member is redirected to the provider's hosted checkout. Success and cancel
   URLs are built exclusively from trusted configuration (`PORTAL_URL`), never
   from `Host`/`Origin`/`Referer` headers or user input, preventing open
   redirects.

5. **Webhooks are the authority for external payment facts.** The provider's
   signed webhooks synchronize payment truth into Vibress. Vibress owns its
   subscription domain state. Raw provider status strings are mapped to the
   canonical Vibress status set (`trialing`, `active`, `past_due`, `unpaid`,
   `cancelled`, `expired`, `incomplete`).

6. **Durable idempotency model.** Every webhook event is persisted
   (`billing_webhook_events`, `UNIQUE(provider, provider_event_id)`) with a
   payload hash before acknowledgement. Replays and duplicates cannot create
   duplicate subscription changes. Failed processing is retryable from the
   durable record.

7. **Out-of-order protection.** `subscriptions.provider_event_timestamp` tracks
   the newest applied provider event. Older events are ignored rather than
   overwriting newer subscription state.

8. **Explicit mappings, not identity assumptions.** `billing_customers`
   (`UNIQUE(member_id, provider)`) and `billing_plan_mappings`
   (`UNIQUE(plan_id, provider)`) keep provider identifiers explicitly mapped
   without making them Vibress identity.

## Consequences

- Future providers implement `BillingProvider` and pass the same contract tests.
- Stripe outages map to `BILLING_PROVIDER_UNAVAILABLE`; the API health
  endpoints remain independent of provider availability.
- Provider secrets are environment configuration only and never reach
  browsers, logs, audit payloads, or API responses.
