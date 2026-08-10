# Redirects

## Model

`source` (unique relative path), `destination`, `statusCode` (301/302/307/308
only), `enabled`, `sortOrder`.

## Rules

- Sources must be relative paths; protected route prefixes (`/api`, `/admin`,
  `/portal`, `/health`, `/content`, `/assets`) can never be hijacked.
- External destinations: http/https only; javascript/data schemes rejected;
  open-redirect abuse prevented.
- Loop prevention: `resolve()` follows a bounded chain (max 10 hops) and
  detects cycles.
- Public Web remains route owner; themes are presentation-only.
