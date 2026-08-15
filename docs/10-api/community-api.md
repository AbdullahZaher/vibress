# Community API

## Public (no auth)

| Method | Path                                           | Description                   |
| ------ | ---------------------------------------------- | ----------------------------- |
| GET    | `/api/content/v1/posts/:postId/comments`       | Published comments for a post |
| GET    | `/api/content/v1/posts/:postId/comments/count` | Published comment count       |
| GET    | `/api/content/v1/recommendations`              | Active recommendations        |
| POST   | `/api/content/v1/recommendations/:id/click`    | Click tracking                |

## Member (cookie-authenticated + CSRF for writes)

| Method | Path                                         | Description               |
| ------ | -------------------------------------------- | ------------------------- |
| POST   | `/api/members/v1/comments`                   | Create comment/reply      |
| PATCH  | `/api/members/v1/comments/:id`               | Edit own comment          |
| DELETE | `/api/members/v1/comments/:id`               | Tombstone own comment     |
| POST   | `/api/members/v1/comments/:id/like`          | Toggle like               |
| POST   | `/api/members/v1/comments/:id/report`        | Report comment            |
| GET    | `/api/members/v1/notifications`              | Own notifications (paged) |
| GET    | `/api/members/v1/notifications/unread-count` | Unread count              |
| POST   | `/api/members/v1/notifications/:id/read`     | Mark one read             |
| POST   | `/api/members/v1/notifications/read-all`     | Mark all read             |

## Admin (staff, RBAC)

| Method | Path                                        | Permission               |
| ------ | ------------------------------------------- | ------------------------ |
| GET    | `/api/admin/v1/comments`                    | `comments.read`          |
| POST   | `/api/admin/v1/comments/:id/hide`           | `comments.moderate`      |
| POST   | `/api/admin/v1/comments/:id/restore`        | `comments.moderate`      |
| POST   | `/api/admin/v1/comments/:id/delete`         | `comments.moderate`      |
| GET    | `/api/admin/v1/comment-reports`             | `comments.read`          |
| POST   | `/api/admin/v1/comment-reports/:id/resolve` | `comments.moderate`      |
| GET    | `/api/admin/v1/recommendations`             | `recommendations.read`   |
| POST   | `/api/admin/v1/recommendations`             | `recommendations.manage` |
| PATCH  | `/api/admin/v1/recommendations/:id`         | `recommendations.manage` |
| POST   | `/api/admin/v1/recommendations/:id/archive` | `recommendations.manage` |
| GET    | `/api/admin/v1/recommendations/:id/stats`   | `recommendations.read`   |

## Error Codes

`COMMENT_NOT_FOUND`, `COMMENT_NOT_AVAILABLE`, `MAX_THREAD_DEPTH`,
`FORBIDDEN`, `ALREADY_REPORTED`, `VALIDATION_ERROR`,
`RECOMMENDATION_NOT_FOUND`, `UNSAFE_URL`.
