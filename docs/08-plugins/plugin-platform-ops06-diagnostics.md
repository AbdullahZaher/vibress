# PLUG-OPS-06 — Trusted plugin delivery diagnostics

**Status:** Read-only bounded PostgreSQL sampling, Worker gauges and curated
publication-scoped audit activity are implemented on PR #89. Production
alert-manager configuration, real outage drills and multi-replica acceptance
are **not** completed. The activity feed is intentionally **not** a complete
plugin lifecycle audit or a long-term retention guarantee.

## Existing architecture, no parallel event ledger

PostgreSQL `plugin_event_receipts` is the authoritative durable admission
record. BullMQ/Redis is the retry/transport queue. The Worker already emits
`plugin_events_processed_total{outcome=...}`,
`plugin_events_queue_jobs{state=...}`,
`plugin_events_relay_enqueued_total`, `plugin_events_relay_failed_total`,
`plugin_events_consumer_ready`, and handler/connection error counters.
These retain their established contracts.

The new probe reads **only** the last-transition timestamp of at most the
**251 oldest** `pending` and `dispatching` receipts **per status**, using the
existing `(status, created_at)` PostgreSQL index. No row envelope, tenant,
plugin, staff identity, credential or event payload is fetched. Only the
oldest 250 are counted; row 251 indicates **saturation**. The sample is
a **lower bound**, not a full ledger count.

- `pending`: stale when `updated_at` is at least **60 seconds** old.
  Admissions need a short backoff before eligible dispatch; this threshold
  is an operational signal, not an authorization decision.
- `dispatching`: stale when `updated_at` is at least **180 seconds** old.
  The relay's claim lease reclaims after two minutes; do not race or bypass it.
- A recent queue failure, DB disconnection, or mixed-release replica may cause
  backlog. Diagnose Redis and the signed operator release separately.
- A saturated sample does **not** prove every receipt is stale; the unobserved
  remainder is unknown. Never report exact fleet totals from these gauges.

## Worker metrics

In addition to its existing five-second dispatch sweep, a ready plugin
Worker performs a separate receipt probe at most **once per 60 seconds**.
It publishes:

| Metric | Meaning |
| --- | --- |
| `plugin_events_receipt_sampled{state}` | Bounded observed receipts, not total |
| `plugin_events_receipt_stale_sampled{state}` | Stale rows among those sampled |
| `plugin_events_receipt_sample_saturated{state}` | 1 if more than 250 rows exist in this state |
| `plugin_events_receipt_probe_ok` | 1 if the last PostgreSQL probe succeeded; 0 if unavailable |
| `plugin_events_receipt_probe_failures_total` | Aggregate probe failures, no identities |

Only the fixed status labels `pending` and `dispatching` are used. There
are no dynamic event names, publication IDs, plugin IDs, host paths, or errors
as metric labels. A database error publishes `probe_ok=0` and increments
the failure counter; it **does not** replace previous gauges with healthy zeros,
expose a stack trace, or mark core CMS health unavailable. Dashboards and
alerts must first check `probe_ok==1` (and the freshness of the scrape).
Worker metrics are local to each process; **do not sum per-replica samples**
as if they were different deliveries.

Operator-only diagnostic command, from a protected process with DB read
access (no HTTP endpoint, no new UI permissions):

```bash
VIBRESS_PLUGIN_RECEIPT_DIAGNOSTICS=1 pnpm exec tsx scripts/plugins/check-receipt-health.ts
```

Exit status **0** means no stale sampled rows or saturation. Status **2**
means the sample contains stale receipts or more than 250 items in a state:
investigate, **do not replay blindly**. Status **1** means the probe failed
and the status is unknown. The command emits aggregate counts only, including
explicit sample limits and saturation. It does not write to PostgreSQL or
Redis or create/replay/delete any event.

## Operator acceptance and alerting

Recommend a non-page alert after two consecutive successful samples of
`plugin_events_receipt_stale_sampled > 0` or
`plugin_events_receipt_sample_saturated == 1`, with escalation for sustained
`plugin_events_receipt_probe_ok == 0` and a separately monitored consumer
readiness gap. These are **recommended thresholds**, not automatically
deployed alert rules. Distinguish primary DB/Redis outages from just a plugin
handler failure. Investigate queue failed jobs and permission-scoped failed
deliveries via the existing Activity panel and replay service; **never**
automatically replay a terminal/unknown receipt. Avoid placing raw job IDs,
event payloads or plugin exception messages in Prometheus labels or logs.

Unit tests cover thresholds, bounded saturation, stale vs healthy and failed
probe telemetry. A PostgreSQL integration fixture checks that a durable
pending/dispatching receipt is sampled and its envelope/tenant identity is
absent. Completing acceptance still requires measured high-volume load,
rollback/drain drills, actual monitoring deployment, and audited per-publication
activity history with retention/privacy policy.

## Staff activity: curated publication-scoped historical audit

The Admin **Activity** section now shows the existing Failed deliveries UI for
active/enabled extension plugins, plus a separate **Plugin audit history**
panel for installed publication-scoped plugins (including ones now inactive).
It reads only explicitly whitelisted actions from the **existing**
`audit_events` ledger, without creating a second audit table:

- `plugin.publication_settings_updated`
- `plugin.publication_secret_revoked`
- `plugin.publication_enabled` and `plugin.publication_disabled` (only when
  a publication's stored decision actually changes)
- `plugin.event_replay_requested`

The API is additive:
`GET /plugins/:id/activity?offset=0&limit=25` — never accepts a tenant ID.
All requests require `requireStaffSession`, `plugins.manage`,
`requirePlatformPluginOperator`, and an **authoritative** selected
publication context with owner/admin role. Data selection binds both the
publication and plugin identity. The replay action requires an `EXISTS` join
to the **original durable event receipt** for the same publication and
plugin, rather than trusting audit metadata.

Server responses return **only** the whitelisted action code and creation
timestamp, with a bounded next offset (or null). No row metadata, plugin
secrets, actor IDs, IP addresses, event IDs, request IDs, Redis error text
or opaque host paths appear in results. API errors are sanitized and
`Cache-Control: private, no-store` is set. Page size is capped at 25,
offset at 10,000. UI discards stale responses after publication switches
and provides localized Arabic strings, semantic time labels and
keyboard-operable buttons.

**Limitations:** Existing `audit_events` retention policy and legacy
pre-feature gaps determine how much history is available. Global plugin registration, approved release metadata updates, activation
and deactivation now create **separate global** `audit_events` entries with
`publication_id = NULL`. Those must not appear in the selected publication's
Activity panel, because a global operator decision is not publication-owned.
Failed Worker delivery outcomes and other lifecycle events are not included
in this curated view. Do not claim the feed is a complete lifecycle
history. Appending those events safely requires transactionally consistent
ownership and upgrade-safe migrations only when justified.

Tests must demonstrate that a forged replay audit metadata object cannot
cause an event from a different plugin to appear, and that a foreign
publication is never enumerated. A live browser/accessibility exercise,
retention decisions, production alerts and fleet DR still remain.

## Plugin lifecycle audit write guarantees

Authenticated operator calls to register, update, activate or deactivate a
plugin append `plugin.registered`, `plugin.updated`, `plugin.activated` or
`plugin.deactivated` **within the same PostgreSQL transaction** as the final
matching persistence change. Global rows retain a null publication ID and
record only the authenticated actor ID and HTTP request ID; no plugin-provided
manifest field, credentials, errors, stack trace or metadata is copied. They
remain visible only through pre-existing operator/global audit permissions.

Publication enablement changes append `plugin.publication_enabled` or
`plugin.publication_disabled` in the **same database transaction** as the
state upsert, with the server-resolved publication ID. A repeated set to the
current value does not fabricate a new transition or modify the prior state
timestamp. Failed DB/audit writes roll back both modifications.

Activation/deactivation run Host callbacks outside the database; these
transactional audit guarantees only cover **successful persisted final state
transitions**, not exactly-once execution of plugin module side effects.
Failures and stranded intermediate states continue to require the existing
maintenance-only recovery process. Legacy service/test consumers can omit
the optional audit context without changing their previous API semantics.
No schema migration or UI exposure of global operator actions is introduced.
