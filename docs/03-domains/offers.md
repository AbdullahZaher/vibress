# Offers

Offers are temporary or conditional commercial adjustments (discounts) applied
at checkout.

## Model

| Field                   | Type                             | Notes                                      |
| ----------------------- | -------------------------------- | ------------------------------------------ |
| `id`                    | text                             | UUID                                       |
| `product_id`            | text FK                          |                                            |
| `plan_id`               | text FK null                     | Null = applies to all plans in the product |
| `key`                   | text                             | Unique; used as the redeem code            |
| `name` / `description`  | text                             |                                            |
| `discount_type`         | `percentage` / `fixed_amount`    |                                            |
| `discount_value`        | int                              | Percentage `1..100`; fixed in minor units  |
| `duration_type`         | `once` / `repeating` / `forever` |                                            |
| `duration_cycles`       | int null                         | Required for `repeating`                   |
| `starts_at` / `ends_at` | timestamptz null                 | Validity window                            |
| `max_redemptions`       | int null                         | Null = unlimited                           |
| `redemption_count`      | int                              |                                            |
| `status`                | `active` / `disabled`            |                                            |

## Validation (at checkout)

- Status `active`, within `[starts_at, ends_at]`, plan compatibility,
  redemption capacity, fixed discount cannot exceed the plan amount
  (final price never below zero).
- Errors: `OFFER_NOT_FOUND`, `OFFER_INVALID`, `OFFER_EXPIRED`,
  `OFFER_REDEMPTION_LIMIT_REACHED`.

## Concurrency

Redemption is an atomic guarded increment in SQL:

```sql
UPDATE offers
SET redemption_count = redemption_count + 1
WHERE id = $1
  AND (max_redemptions IS NULL OR redemption_count < max_redemptions);
```

A failed guard means the limit was reached; no application-side
read-then-write race is possible.

No coupon stacking, rules DSL, segment targeting, or affiliate payout in v1.
