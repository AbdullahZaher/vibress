# Audit

## Model

`audit_events` is append-only. There is no admin delete endpoint.

| Field                     | Notes                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `actorUserId`             | Staff identity (null = system)                                                                       |
| `action`                  | e.g. `setting.updated`, `post.published`                                                             |
| `targetType` / `targetId` | Entity reference                                                                                     |
| `requestId`               | Correlation ID (from the request header)                                                             |
| `metadata`                | Sanitized — sensitive keys (password, token, secret, cookie) are redacted by `sanitizeAuditMetadata` |
| `createdAt`               |                                                                                                      |

## Exploration

Staff with `audit.read` can filter by actor, action, target type/id,
request ID, and date range with pagination. No deletion, no mutation.
