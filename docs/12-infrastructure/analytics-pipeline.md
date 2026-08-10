# Analytics Pipeline (Infrastructure)

## Flow

```text
domain events (EventBus, in-process)
  → startAsyncBridge (API process): maps to analytics event names,
    sanitizes payloads, enqueues to BullMQ `vibress-analytics`
  → AnalyticsWorker (worker process): validates the bounded envelope,
    ingests into analytics_events (dedup by event_id), upserts
    analytics_daily_metrics (UTC date bucket, atomic increment)
```

## Failure Isolation

- Bridge enqueue failures are caught and dropped (never propagated to core).
- Worker drops invalid events with a log — they are not retried.
- Analytics delay/down never blocks publishing, auth, billing, or comments.

## Rebuild

`AnalyticsService.rebuild(metricDate, events)` clears the day's aggregates
and re-aggregates from raw events — used for recompute/recovery.
