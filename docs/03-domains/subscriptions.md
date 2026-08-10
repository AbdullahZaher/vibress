# Subscriptions

Subscriptions are the canonical Vibress-owned membership state.

## Identity

- `subscriptions.member_id` is the stable commercial identity. Never staff
  user ID, email, or session ID. Email may appear in provider customer
  metadata but is never Vibress subscription identity.

## Model

| Field | Type | Notes |
|---|---|---|
| `id` | text | UUID |
| `member_id` | text FK | |
| `product_id` / `plan_id` | text FK | |
| `provider` | text null | Null for free plans |
| `provider_subscription_id` | text null | |
| `provider_customer_id` | text null | |
| `status` | see below | Canonical Vibress status |
| `currency` / `amount_minor` | | Snapshot from the plan at creation |
| `billing_interval` / `interval_count` | | Snapshot from the plan at creation |
| `current_period_start` / `current_period_end` | timestamptz | |
| `trial_start` / `trial_end` | timestamptz | |
| `cancel_at_period_end` | boolean | |
| `cancelled_at` / `ended_at` | timestamptz | |
| `offer_id` | FK null | |
| `provider_event_timestamp` | timestamptz | Out-of-order guard |

## Status Lifecycle

```
trialing ⇄ active ⇄ past_due ⇄ unpaid
    │          │        │
    └──┬───────┴───┬────┘
       ▼           ▼
   cancelled    expired
incomplete (one-off edge)
```

Provider statuses are mapped into these canonical values inside the billing
adapter; raw provider strings never propagate into domain state.

## Access Policy

Centralized in `SubscriptionsService.hasAccess()`:

- Access-granting: `trialing`, `active`.
- `past_due` / `unpaid` do **not** grant access (conservative default).

No route or component decides this independently.

## Rules

- **One active/trialing subscription per product per member.** Duplicate
  checkout is rejected with `SUBSCRIPTION_ALREADY_ACTIVE`.
- Cancel defaults to **cancel at period end** (`cancel_at_period_end`); the
  provider is the external authority for the period end.
- Cancellation never deletes, disables, or revokes the member account.
  Member lifecycle and subscription lifecycle are separate.
- Payment failure never disables the member identity; it records a billing
  event and transitions subscription state.
- Immediate cancellation exists only as an explicit admin action behind
  `subscriptions.manage`, recorded as `subscription.administratively_cancelled`.
- Plan changes (upgrade/downgrade/proration) are not implemented; unsupported
  operations are rejected cleanly. No implicit second subscription.
- Domain events: `subscription.created`, `subscription.activated`,
  `subscription.updated`, `subscription.payment_failed`,
  `subscription.cancel_scheduled`, `subscription.cancelled`,
  `subscription.resumed`, `subscription.ended`.

## Out-of-Order Webhook Protection

`provider_event_timestamp` stores the newest applied provider event time.
`applyProviderUpdate` ignores events older than the last applied timestamp.
Provider delivery order is never assumed to equal event order.

## Future Access Gating

`SubscriptionsService.memberHasActiveSubscription(memberId)` and
`hasAccess(subscription)` are the intended query surface for future
paid-content gating. Web rendering must never query the payment provider.
