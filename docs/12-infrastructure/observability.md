# Observability Runbook

Covers the central logger, metrics endpoint, and optional request tracing
implemented under H12. Applies to `@vibress/api` and `@vibress/worker`.

## Central logger

All application logs flow through `@vibress/observability`:

- API: `apps/api/src/observability.ts` exports the singleton `appLogger`
  (logger name `api`); Fastify is started with `logger: false` and the
  trace/response hooks emit every request completion and error through the
  same logger.
- Worker: `apps/worker/src/main.ts` builds `createLogger('worker', ...)` and
  all startup, failure, and shutdown events log through it.

Output is one JSON object per line to stdout (info) / stderr (error/warn):

```json
{
  "timestamp": "...",
  "level": "info",
  "logger": "api",
  "message": "request completed",
  "requestId": "...",
  "traceId": "...",
  "method": "GET",
  "path": "/api/content/v1/posts",
  "statusCode": 200,
  "durationMs": 12
}
```

Sensitive fields (`password`, `token`, `secret`, `authorization`, `cookie`,
...) are redacted to `[REDACTED]` inside the `meta` object. Error entries
carry a nested `error` object with name/message/stack (server-side only —
client responses never include stacks).

The log level is taken from `LOG_LEVEL` (default `info`).

## Metrics endpoint

- API: `GET /metrics` (Prometheus text format, `text/plain; version=0.0.4`).
- Worker: `GET /metrics` on the worker health port (default 7782)
  (only when `METRICS_ENABLED=true`).

Gated by `METRICS_ENABLED` (default `true`). When disabled the route is not
registered (404).

Exposed series:

- `http_requests_total{method,path,status}` — `status` is bucketed as
  `2xx`/`4xx`/`5xx`; `path` uses the route template (e.g. `/content/media/*`),
  not raw URLs, to keep cardinality bounded.
- `http_errors_total{code}` — errors logged by the central error handler.
- `nodejs_process_uptime_seconds`, `nodejs_process_memory_{rss,heap_used,heap_total}_bytes`
- `nodejs_event_loop_lag_seconds` — sampled every 1 s via `setImmediate`.

Collect every 15–60 s with Prometheus (or any scraper) against the internal
API/worker network; do not expose `/metrics` publicly.

## Optional tracing

`TRACING_ENABLED` (default `true`) controls per-request trace context:

- The API sets an `AsyncLocalStorage` context per request carrying
  `requestId`, `traceId`, `method`, `path`, `ipAddress`; every log line
  emitted during the request (including route code calling `appLogger`)
  inherits `requestId`/`traceId`.
- `traceId` is extracted from the W3C `traceparent` header when a caller
  supplies one (32-hex trace id, 16-hex parent span id, flags) — ingest
  traces from an upstream gateway/otel collector by propagating
  `traceparent`.
- When `TRACING_ENABLED=false` the context is not attached and logs carry
  no trace fields; the `x-request-id` response/request correlation header
  still works because Fastify generates `requestId` independently.

## Using the logs

- Correlate by `requestId` (API generates a UUID unless the caller passes
  `x-request-id`).
- Alert on `level=error` with `logger=api|worker`; rate-limit alerts on
  `http_errors_total` code `5xx:*`.
- When debugging async jobs (queue/outbox), the worker logs identify the
  job type via `logger=worker`; the API side of the same work carries the
  originating `requestId` in events persisted to the outbox.

## Optional OpenTelemetry exporter

OpenTelemetry export is optional and fail-open: the app never depends on a
collector being reachable.

### Configuration (`@vibress/config` → `observability.tracing`)

| Env var                       | Default                 | Purpose                                                                             |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `TRACING_ENABLED`             | `true`                  | Master switch; `false` → no exporter is initialized (zero OTel overhead)            |
| `OTEL_SERVICE_NAME`           | `vibress`               | Service name attribute (API overrides to `vibress-api`, worker to `vibress-worker`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://127.0.0.1:4318` | OTLP/HTTP endpoint (traces are exported to `<endpoint>/v1/traces`)                  |
| `OTEL_EXPORTER_OTLP_HEADERS`  | –                       | Optional comma-separated `Key=Value` list (e.g. auth headers)                       |
| `OTEL_SAMPLING_RATIO`         | `1`                     | 0..1 head-sampling ratio                                                            |
| `OTEL_RESOURCE_ATTRIBUTES`    | –                       | Optional `Key=Value` resource attributes                                            |

### Behavior

- `OTEL_ENABLED=false` (i.e. `TRACING_ENABLED=false`) → `initTracing` returns a
  noop handle; no provider, no exporter, no instrumentation.
- Collector unavailable → exporter timeouts after 2 s, spans are dropped,
  the app continues (fail-open). Verified by tests
  (`platform-packages` suite).
- The exporter is a `BatchSpanProcessor` (queue 1024 / batch 512 / 5 s flush)
  and never blocks request handling.

### Instrumentation surface

- **HTTP request spans** — `@opentelemetry/auto-instrumentations-node`
  (`instrumentation-http`) covers Fastify request lifecycle.
- **Outbound `safeFetch` spans** — `packages/security` wraps `safeFetch` in
  `safeFetch` span (`http.method`, `url.full` with query string stripped so
  secrets never reach attributes).
- **Queue enqueue spans** — `@vibress/queue`'s `enqueueTraced` wraps
  `queue.add` and attaches a W3C `traceparent` to the job payload.
- **Worker job spans** — each processor wraps jobs in
  `worker.job.<name>` via `tracedProcessor`, continuing the producing
  process's trace when the job carries a `traceparent`.
- **Outbox dispatch spans** — the worker relay wraps delivery in
  `outbox.relay.deliver` with `outboxId`/`eventType` attributes.
- **Transaction spans** — `runInTransaction` wraps the DB transaction in a
  `db.transaction` span.

### Context propagation

- HTTP `traceparent` → request ALS context → outbox envelope (`trace` field:
  `{traceId, spanId}` written by `OutboxEventWriter`) → worker dispatcher
  continues the remote trace → queue job `traceparent` → worker job span.
- Correlation fields (`traceId`, `requestId`, `outboxEventId`, `jobId`) are
  recorded as span attributes (`vibress.trace_id`) and log fields; secrets are
  never added to span attributes.
