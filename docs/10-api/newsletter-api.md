# Newsletter API

## Staff (Admin) — RBAC

| Method | Path                                          | Permission           |
| ------ | --------------------------------------------- | -------------------- |
| GET    | `/api/admin/v1/newsletters`                   | `newsletters.read`   |
| POST   | `/api/admin/v1/newsletters`                   | `newsletters.manage` |
| PATCH  | `/api/admin/v1/newsletters/:id`               | `newsletters.manage` |
| POST   | `/api/admin/v1/newsletters/:id/archive`       | `newsletters.manage` |
| GET    | `/api/admin/v1/newsletter-sends`              | `newsletters.read`   |
| GET    | `/api/admin/v1/newsletter-sends/:id`          | `newsletters.read`   |
| POST   | `/api/admin/v1/newsletter-sends`              | `newsletters.send`   |
| POST   | `/api/admin/v1/newsletter-sends/:id/send-now` | `newsletters.send`   |
| POST   | `/api/admin/v1/newsletter-sends/:id/cancel`   | `newsletters.send`   |
| POST   | `/api/admin/v1/newsletter-test-email`         | `newsletters.send`   |
| POST   | `/api/admin/v1/newsletter-audience-summary`   | `newsletters.send`   |
| GET    | `/api/admin/v1/email-suppressions`            | `email.read`         |
| DELETE | `/api/admin/v1/email-suppressions/:id`        | `email.manage`       |

Send payload:

```json
{
  "newsletterId": "...",
  "subject": "...",
  "content": { "schema": "vibress-studio", ... },
  "audience": { "filter": "all|paid|free", "productId": null },
  "scheduledAt": "2026-08-08T12:00:00Z" | null,
  "sendNow": false
}
```

- `scheduledAt` → durable `scheduled` state (worker scheduler fires it).
- `sendNow` → snapshots the audience and enqueues delivery batches
  immediately; the worker sends asynchronously.
- Server resolves the audience; the response includes `audienceCount`.

Unauthenticated → 401; authenticated without permission → 403.

## Member — cookie-authenticated

| Method | Path                                     | Notes                                                |
| ------ | ---------------------------------------- | ---------------------------------------------------- |
| GET    | `/api/members/v1/newsletter-preferences` | Own preferences                                      |
| PUT    | `/api/members/v1/newsletter-preferences` | `{ newsletterId, subscribed }`; CSRF origin required |

Preferences are always scoped to the authenticated member (no IDOR surface:
there is no parameterized member id).

## Public

| Method | Path                         | Notes                                       |
| ------ | ---------------------------- | ------------------------------------------- |
| POST   | `/api/public/v1/unsubscribe` | `{ token }` — token-authenticated, no login |

## Webhooks

| Method | Path                               | Auth                                     |
| ------ | ---------------------------------- | ---------------------------------------- |
| POST   | `/api/webhooks/v1/email/:provider` | Provider signature (`x-email-signature`) |

## Error Codes

`NEWSLETTER_NOT_FOUND`, `SEND_NOT_FOUND`, `SEND_NOT_CANCELLABLE`,
`VALIDATION_ERROR`, `INVALID_UNSUBSCRIBE_TOKEN`, `PERMISSION_DENIED`.
