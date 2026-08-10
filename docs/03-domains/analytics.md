# Analytics

## Principle

Analytics is never a transactional dependency. Core operations emit domain
events; the async bridge enqueues them; the worker ingests and aggregates. If
analytics is delayed or down, publishing/auth/billing correctness is
unaffected.

## Event Envelope

Versioned, bounded model (`analytics_events`):

| Field | Notes |
|---|---|
| `event_id` | Unique (dedup on ingestion) |
| `event_name` | **Allowlisted** — unknown names rejected |
| `occurred_at` | UTC |
| `actor_type` / `actor_id` | Opaque references, never emails/names |
| `entity_type` / `entity_id` | Opaque references |
| `context` / `properties` | Key/length-bounded JSON |
| `schema_version` | 1 |

`validateAnalyticsEvent` rejects arbitrary unbounded JSON, unknown event
names, oversized values, and oversize arrays.

## Metrics (v1)

`post.view`, `page.view`, `member.signup`, `subscription.started`,
`subscription.cancelled`, `newsletter.sent`, `newsletter.delivered`,
`comment.created`, `recommendation.clicked`.

Financial truth remains Billing-owned; analytics derives summaries from
billing domain events only.

## Aggregation

- `analytics_daily_metrics` with `UNIQUE(metric_date, metric_name,
  dimension_key, dimension_value)`.
- Idempotent upserts: duplicate event IDs are ignored, counts are atomic
  increments.
- Date buckets are **UTC days** (documented semantics).
- `rebuild(metricDate, events)` recomputes a day from raw events.

## Ingestion

```text
domain event → async bridge (API) → BullMQ queue → AnalyticsWorker
  → validate → ingest → aggregate
```

Invalid events are dropped with a log (never retried — they cannot be fixed
by retry). Admin queries hit the aggregate table, never raw scans.

## Privacy

- Properties are allowlisted scalar IDs only (memberId, postId, productId,
  ...); emails, tokens, and nested objects are stripped at the bridge.
- No persistent raw IPs or user-agents.
- Actor/entity IDs are opaque references.
