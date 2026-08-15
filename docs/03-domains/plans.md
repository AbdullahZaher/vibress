# Plans

Plans are purchasable billing options under a product (e.g. Premium → Monthly,
Premium → Yearly).

## Model

| Field                   | Type                  | Notes                                       |
| ----------------------- | --------------------- | ------------------------------------------- |
| `id`                    | text                  | UUID                                        |
| `product_id`            | text FK               |                                             |
| `key`                   | text                  | Unique per product                          |
| `name` / `description`  | text                  |                                             |
| `billing_type`          | `free` / `recurring`  |                                             |
| `billing_interval`      | `month` / `year` null | Null for free plans                         |
| `interval_count`        | int                   | e.g. `month × 1`                            |
| `currency`              | text                  | ISO 4217, uppercase                         |
| `amount_minor`          | int                   | Integer minor units, never floats           |
| `trial_days`            | int                   | 0 = no trial, max 365                       |
| `status` / `visibility` |                       | `active` / `archived`, `public` / `private` |
| `archived_at`           | timestamptz null      |                                             |

## Money

- `amount_minor` is the single money representation (e.g. `$10.00 → 1000`).
  No floating-point money anywhere.
- Currencies are stored uppercase ISO 4217 (`USD`, `SAR`, `EUR`, `GBP`).
- Zero-decimal currencies are not specially handled in v1; the minor-unit
  model is the documented contract and provider mapping converts as needed.

## Rules

- Validation: product exists, key syntax/scope, amount `0..100_000_000`,
  currency format, interval `month`/`year`, interval count `1..12`,
  trial days `0..365`.
- Archived plans reject new subscriptions (`PLAN_NOT_AVAILABLE`) while
  existing subscriptions continue.
- **Immutable billing history:** subscriptions snapshot `currency`,
  `amount_minor`, `billing_interval`, `interval_count` at creation time.
  Changing a plan's price never mutates historical subscription truth.
- Free plans have no provider records: activation is a server-side
  subscription creation, never a fake provider checkout.
- Domain events: `plan.created`, `plan.updated`, `plan.archived`.
