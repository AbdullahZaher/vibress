# Products

Products represent the commercial membership offerings. A product contains one
or more plans and optionally references offers.

## Model

| Field                       | Type                  | Notes                                                      |
| --------------------------- | --------------------- | ---------------------------------------------------------- |
| `id`                        | text                  | UUID                                                       |
| `key`                       | text                  | Stable identifier, e.g. `premium`, `supporter`, `business` |
| `name`                      | text                  | Display name (not an identifier)                           |
| `description`               | text null             |                                                            |
| `status`                    | `active` / `archived` |                                                            |
| `visibility`                | `public` / `private`  |                                                            |
| `created_at` / `updated_at` | timestamptz           |                                                            |
| `archived_at`               | timestamptz null      |                                                            |

## Rules

- Keys are stable identifiers: lowercase alphanumeric with hyphens, unique,
  never reused after archival.
- Products are archived, never hard-deleted, because subscriptions reference
  them historically (`ON DELETE RESTRICT`).
- Existing subscriptions continue after a product is archived; new checkouts
  against archived products fail with `PRODUCT_NOT_FOUND`.
- Domain events: `product.created`, `product.updated`, `product.archived`.

## API

- Public: `GET /api/content/v1/products`, `GET /api/content/v1/products/:key`
  (active, public only — no provider internals).
- Staff: `GET/POST /api/admin/v1/products`, `PATCH /api/admin/v1/products/:id`,
  `POST /api/admin/v1/products/:id/archive` behind `products.read` /
  `products.manage`.
