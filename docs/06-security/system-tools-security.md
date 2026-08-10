# System Tools Security

## Diagnostics

Safe operational information only: Vibress/Node versions, environment name,
migration version, PostgreSQL/Redis status, search index count, storage/
email/billing provider names, uptime. Never exposed: DSNs, credentials,
secret values, sensitive filesystem paths, raw environment dumps.

## Maintenance

Bounded safe operations only: `search.rebuild`, `webhooks.retry-failed`,
`email.retry-failed`, `cache.clear-safe`. No shell terminal, no raw SQL
console, no filesystem browser, no arbitrary command execution — such
endpoints do not exist (verified 404).

## Integrity Checks

Non-destructive checks: billing plan mappings, search index coverage,
media storage providers, recommendations, theme configuration, stuck
automation runs. Repairs are explicit and targeted; no broad destructive
auto-fix.

## Settings & Audit

- Settings changes are audited; secret values never logged or returned.
- Audit log is append-only with redaction of sensitive metadata keys.
- All operations require RBAC (401/403 verified).
