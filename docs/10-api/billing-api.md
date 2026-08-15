# Billing & Subscriptions API

## Public Catalog (no auth)

| Method | Path                            | Description                                           |
| ------ | ------------------------------- | ----------------------------------------------------- |
| GET    | `/api/content/v1/products`      | Active public products with their public active plans |
| GET    | `/api/content/v1/products/:key` | Single product by stable key                          |

Only public active products/plans are exposed with safe pricing
(`amountMinor`, `currency`, `billingInterval`, `trialDays`). No provider
internals, no subscription data.

## Member Billing API (cookie-authenticated)

| Method | Path                                       | Description                   |
| ------ | ------------------------------------------ | ----------------------------- |
| GET    | `/api/members/v1/subscriptions`            | Own subscriptions (safe DTO)  |
| GET    | `/api/members/v1/subscriptions/:id`        | Own subscription detail       |
| POST   | `/api/members/v1/billing/checkout`         | Create checkout session       |
| POST   | `/api/members/v1/billing/portal`           | Open provider billing portal  |
| POST   | `/api/members/v1/subscriptions/:id/cancel` | Cancel at period end          |
| POST   | `/api/members/v1/subscriptions/:id/resume` | Resume scheduled cancellation |

Checkout body: `{ "planId": "...", "offerKey": "..." }` → `{ "checkoutUrl": "..." }`.
Server resolves all prices; client-supplied amounts are ignored.

Member DTO never includes `provider`, `providerSubscriptionId`,
`providerCustomerId`, or internal sequencing metadata.

## Admin Billing API (staff, RBAC)

| Method | Path                                            | Permission             |
| ------ | ----------------------------------------------- | ---------------------- |
| GET    | `/api/admin/v1/products`                        | `products.read`        |
| POST   | `/api/admin/v1/products`                        | `products.manage`      |
| PATCH  | `/api/admin/v1/products/:id`                    | `products.manage`      |
| POST   | `/api/admin/v1/products/:id/archive`            | `products.manage`      |
| GET    | `/api/admin/v1/plans?productId=`                | `plans.read`           |
| POST   | `/api/admin/v1/plans`                           | `plans.manage`         |
| PATCH  | `/api/admin/v1/plans/:id`                       | `plans.manage`         |
| POST   | `/api/admin/v1/plans/:id/archive`               | `plans.manage`         |
| GET    | `/api/admin/v1/offers`                          | `offers.read`          |
| POST   | `/api/admin/v1/offers`                          | `offers.manage`        |
| PATCH  | `/api/admin/v1/offers/:id`                      | `offers.manage`        |
| POST   | `/api/admin/v1/offers/:id/disable`              | `offers.manage`        |
| GET    | `/api/admin/v1/subscriptions`                   | `subscriptions.read`   |
| GET    | `/api/admin/v1/subscriptions/:id`               | `subscriptions.read`   |
| POST   | `/api/admin/v1/subscriptions/:id/cancel`        | `subscriptions.manage` |
| GET    | `/api/admin/v1/members/:memberId/subscriptions` | `subscriptions.read`   |

Admin subscription DTO includes provider references (operational) but never
secrets or internal sequencing metadata. Unauthenticated → 401;
authenticated without permission → 403.

## Webhooks

| Method | Path                                 | Auth               |
| ------ | ------------------------------------ | ------------------ |
| POST   | `/api/webhooks/v1/billing/:provider` | Provider signature |

## Error Codes

`PRODUCT_NOT_FOUND`, `PLAN_NOT_FOUND`, `PLAN_NOT_AVAILABLE`,
`OFFER_NOT_FOUND`, `OFFER_INVALID`, `OFFER_EXPIRED`,
`OFFER_REDEMPTION_LIMIT_REACHED`, `SUBSCRIPTION_NOT_FOUND`,
`SUBSCRIPTION_ALREADY_ACTIVE`, `SUBSCRIPTION_NOT_CANCELLABLE`,
`SUBSCRIPTION_NOT_RESUMABLE`, `CHECKOUT_CREATION_FAILED`,
`BILLING_PROVIDER_UNAVAILABLE`, `BILLING_CONFIGURATION_ERROR`,
`BILLING_AUTH_REQUIRED`, `VALIDATION_ERROR`.
