# Search API

## Public

| Method | Path                     | Notes                                                     |
| ------ | ------------------------ | --------------------------------------------------------- |
| GET    | `/api/content/v1/search` | `?q=` (≤100 chars), `limit` (≤50), `offset`; rate limited |

Response: `{ results: [{ id, entityType, entityId, title, excerpt, url }], total }`.

Only published, public posts/pages/tags are returned. Restricted content is
never indexed and never leaked.

Errors: `QUERY_TOO_LONG`, `EMPTY_QUERY`, `INVALID_QUERY` (wildcard-only),
`TOO_MANY_REQUESTS`.

## Admin

| Method | Path                               | Permission      |
| ------ | ---------------------------------- | --------------- |
| POST   | `/api/admin/v1/search/rebuild`     | `search.manage` |
| GET    | `/api/admin/v1/search/index-count` | `search.manage` |

## Analytics Admin

| Method | Path                              | Permission       |
| ------ | --------------------------------- | ---------------- |
| GET    | `/api/admin/v1/analytics/metrics` | `analytics.read` |

Query params: `from` (YYYY-MM-DD), `to`, `metricName`. Response:
`{ metrics: [{date, name, count}], from, to, timezone: 'UTC' }`.

