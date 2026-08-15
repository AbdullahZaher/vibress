# Notifications

## Model

`notifications` is durable, independent of email transport.

| Field                             | Notes                                         |
| --------------------------------- | --------------------------------------------- |
| `recipient_type` / `recipient_id` | v1 is `member` only                           |
| `type`                            | e.g. `comment.reply`, `comment.hidden`        |
| `actor_member_id` FK null         | Who triggered it (null = system)              |
| `entity_type` / `entity_id`       | What it refers to                             |
| `data`                            | Safe JSON payload (no PII beyond entity refs) |
| `read_at`                         | Null until read                               |

## Rules

- **Never notify about self-actions** — `notify()` no-ops when the actor is
  the recipient.
- Reply notifications are created by the Comments domain through a
  `NotificationSink` interface; Comments never touches email transport.
- Moderation notifications (`comment.hidden`) are sent to the comment author.

## API (member, cookie-authenticated)

- `GET /api/members/v1/notifications` — list with pagination
- `GET /api/members/v1/notifications/unread-count`
- `POST /api/members/v1/notifications/:id/read` — mark one read
- `POST /api/members/v1/notifications/read-all`

## Member Isolation

- Every read/mark operation is scoped server-side to the authenticated
  member's `recipientId`; a member can never see or mutate another member's
  notifications. Verified by integration tests.
