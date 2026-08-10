# API Design

## API groups

```text
/api/admin/v1/
/api/content/v1/
/api/member/v1/
/api/webhooks/v1/
```

## Admin API

Authenticated staff operations.

Examples:

```text
GET    /api/admin/v1/posts
POST   /api/admin/v1/posts
GET    /api/admin/v1/posts/:id
PUT    /api/admin/v1/posts/:id
DELETE /api/admin/v1/posts/:id
POST   /api/admin/v1/posts/:id/publish
```

## Content API

Public or key-authenticated read APIs.

Examples:

```text
GET /api/content/v1/posts
GET /api/content/v1/posts/:slug
GET /api/content/v1/pages/:slug
GET /api/content/v1/tags/:slug
```

## Member API

Member authentication and self-service.

## Webhook API

Inbound provider callbacks.

Webhook handlers must:

- validate signature
- preserve raw body where required
- be idempotent
- reject stale/replayed events where supported
- acknowledge only after safe persistence or queueing

## Contracts

Shared DTOs and validation live in `packages/api-contracts`.

Recommended validation: Zod.

## Error format

Use a stable envelope.

Example:

```json
{
  "errors": [
    {
      "code": "POST_NOT_FOUND",
      "message": "Post not found",
      "field": null,
      "requestId": "..."
    }
  ]
}
```

## Pagination

Choose one canonical model.

For high-volume datasets, prefer cursor pagination.

For normal admin tables, offset pagination may be acceptable where performance is bounded.
