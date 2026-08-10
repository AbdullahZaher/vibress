# Recommendations

## Model

`recommendations` are managed external-site/content recommendations.

| Field | Notes |
|---|---|
| `url` | http/https only (SSRF-validated) |
| `title` / `description` | Display metadata |
| `image_url` / `favicon_url` | Optional |
| `status` | `active` / `archived` |
| `sort_order` | Display ordering |

## SSRF Protection

- URL validation (`isSafeUrl` in `@vibress/security`) rejects non-http(s),
  localhost, and private/reserved IP literals at create time.
- The hardened outbound HTTP client (`safeFetch` in
  `packages/security/src/http/safe-fetch.ts`) provides DNS-resolution IP
  checks, socket-level rebinding guards, redirect re-validation, timeouts, and
  response-size limits for any metadata fetch. `fetch(userUrl)` is never used.

## Attribution

Lightweight `recommendation_events` records:
- `view` (session-scoped, no PII)
- `click` (optionally member-linked)
- per-recommendation counts visible to staff (`recommendations.read`)

No advertising-grade attribution; subscription attribution is not implemented.

## API

- Public: `GET /api/content/v1/recommendations` (active only),
  `POST /api/content/v1/recommendations/:id/click` (click tracking).
- Admin: full CRUD behind `recommendations.read` / `recommendations.manage`.

## Events

`recommendation.created`, `recommendation.clicked`.
