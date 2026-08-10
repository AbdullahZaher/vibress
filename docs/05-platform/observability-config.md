# Observability and Configuration

## Observability

Recommended stack:

- Pino for structured logs
- OpenTelemetry for tracing
- Sentry for exception capture
- Prometheus-compatible metrics if operational metrics are needed

## Request context

Each request should have:

- request ID
- actor/user ID when available
- member ID when available
- installation/tenant ID if multi-tenant
- IP metadata
- user agent
- trace ID

Never log secrets or raw authentication tokens.

## Health endpoints

Recommended endpoints:

```text
/health/live
/health/ready
```

Readiness may verify:

- PostgreSQL
- Redis where required
- plugin initialization
- required encryption key availability

## Configuration

`packages/config` owns typed configuration.

Suggested layout:

```text
config/
├── env.ts
├── schema.ts
├── app.ts
├── database.ts
├── redis.ts
├── storage.ts
├── email.ts
└── security.ts
```

All environment variables should be parsed once with validation at startup.

Application code must consume typed config, not access `process.env` directly.
