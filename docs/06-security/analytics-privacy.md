# Analytics Privacy

## PII Minimization

- The analytics event envelope is allowlisted: only scalar IDs (memberId,
  postId, productId, planId, sendId, newsletterId, commentId,
  recommendationId, status) pass the bridge sanitizer.
- Emails, names, tokens, nested objects, and raw IPs/user-agents are never
  stored.
- Actor/entity IDs are opaque references, not identities.
- String values are length-bounded (500 chars); keys ≤100 chars; arrays ≤50.

## Retention

Analytics retention is not configured in v1; the raw `analytics_events` table
is the bounded source for rebuilds, and aggregates live in
`analytics_daily_metrics`. Operators can purge raw events by date without
affecting aggregates (aggregates are the query surface).

## Aggregation Semantics

- Date buckets are UTC days (documented; the admin UI shows the timezone).
- Aggregation is idempotent: duplicate event IDs are dropped.
- Admin metrics show `data freshness` implicitly through the UTC bucket —
  no real-time claims; aggregation lags live events by design.
