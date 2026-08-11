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
{"timestamp":"...","level":"info","logger":"api","message":"request completed","requestId":"...","traceId":"...","method":"GET","path":"/api/content/v1/posts","statusCode":200,"durationMs":12}
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