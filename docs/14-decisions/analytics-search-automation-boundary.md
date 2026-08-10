# ADR-018: Analytics, Search & Automation Boundary

**Status:** Accepted
**Date:** Batch 13

## Context

Vibress needs measurement, discovery, and workflow capabilities. Without
boundaries, analytics could become a transactional dependency, search could
leak restricted content, and automations could execute arbitrary code or
duplicate side effects.

## Decision

1. **Analytics is always async and never a transactional dependency.** Core
   operations emit domain events; the async bridge enqueues them; the worker
   ingests into a bounded, allowlisted envelope (`analytics_events`) and
   idempotently aggregates into daily UTC buckets
   (`analytics_daily_metrics`). Invalid events are dropped, never retried;
   analytics delay/down never blocks core operations. Aggregates are the
   admin query surface; a `rebuild` recomputes a day from raw events.

2. **PostgreSQL is the initial search backend.** `search_documents` with
   pg_trgm indexes, behind a clean `SearchService` boundary so the backend
   can be swapped. Indexing is event-driven and queued (publish → upsert,
   unpublish/delete → remove, full rebuild). Defense in depth: the worker
   re-verifies each entity is published AND public before indexing —
   restricted content is never searchable, and public queries are bounded,
   rate-limited, and protected against pathological queries.

3. **Automations are durable, versioned, and bounded.** Definitions are
   immutable-versioned (runs reference a version snapshot). Triggers are an
   explicit allowlist; conditions are declarative data-only (no eval);
   actions are a fixed set delegated to domain services (Email, Webhooks,
   Newsletters) — the automation domain never writes another domain's tables.
   Run keys are idempotent, completed steps never re-execute, and depth caps
   plus self-generated-event policies prevent loops. Waits are durable
   (persisted run state + delayed queue jobs), not in-memory timers.

## Consequences

- Restricted-content search leakage is structurally prevented (never
  indexed + verified at write time + filtered at query time).
- Automation retries cannot duplicate side effects; failures are
  inspectable.
- Analytics PII is minimized via allowlisted scalar properties and opaque
  identifiers.
