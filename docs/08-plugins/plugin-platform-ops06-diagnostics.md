# PLUG-OPS-06 — Trusted plugin delivery diagnostics

**Status:** Read-only bounded PostgreSQL sampling, Worker gauges, curated
publication-scoped audit activity and **optional** Prometheus alert rules
are committed on PR #89. Production alert routing/installation, live outage
drills and multi-replica acceptance are **not** completed. The activity feed
is intentionally **not** a complete plugin lifecycle audit or a retention
guarantee.

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
| `plugin_events_receipt_probe_timestamp_seconds` | Unix seconds when the latest probe **completed**, on both success and failure; detects stale-but-successful gauge values |
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
readiness gap. These thresholds are represented in **optional, operator-installed**
[Prometheus rules](../../ops/monitoring/prometheus/plugin-alerts.yml);
Vibress deliberately does not install or reload a Prometheus server. Distinguish primary DB/Redis outages from just a plugin
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

## Opt-in Prometheus rule deployment (no mandatory infrastructure dependency)

A tested production setup requires a **separately operated Prometheus**
(or a compatible evaluator) to scrape `GET /metrics` from **each**
Vibress Worker replica on its internal health port (default `7782`).
Set `METRICS_ENABLED=true` for those Worker processes. Keep the metrics
endpoint on a trusted network, not the public reverse proxy. Configure a
distinct `instance` label per replica and `job="vibress-worker"`, with
scrapes every 15–60 seconds and rules evaluated every 60 seconds. This
job label is the explicit contract of the example file; if changed,
operator-review every rule and fixture before deploying.

1. Review the rules file
   `ops/monitoring/prometheus/plugin-alerts.yml` and the
   [fixture](../../ops/monitoring/prometheus/plugin-alerts.test.yml).
   Stage both files under the **same directory** in a test Prometheus
   installation. With a version-compatible `promtool`, run
   `promtool check rules plugin-alerts.yml` and
   `promtool test rules plugin-alerts.test.yml` there.
2. Reference `plugin-alerts.yml` in the existing operator-controlled
   Prometheus `rule_files` (and reload Prometheus). No Docker/host
   privilege or new CMS API is needed. Configure routing/contact points
   in the **operator-owned** Alertmanager, not in source control.
3. Check each Worker `/metrics` contains
   `plugin_events_receipt_probe_timestamp_seconds` after the first
   successful **or failed** probe. On a fresh ready Worker this should
   appear after its first dispatch sweep. Validate ordinary metrics,
   healthy samples and the full stale/failure cases on a staging stack.
4. Run an approved fault drill with non-production events and verify
   the distinct alerts: Worker scrape down, ready consumer without a
   probe, DB probe failed, probe stalled despite a previous green
   reading, stale pending/dispatching receipts, and a saturated
   250-row sample. Confirm release identity remains pinned, core health
   semantics are unchanged and no event is automatically replayed.
5. Roll back by removing the Prometheus `rule_files` entry and
   reloading the evaluator; leave CMS releases and durable receipts
   intact. Record alert destinations, drill times, noise thresholds,
   replica labels and operator sign-off.

The rules require a healthy, **fresh** `probe_ok=1` and a successful
Worker scrape before interpreting a stale/saturated sample. Each replica
emits an independent view of the *same* PostgreSQL ledger: never `sum()`
these counts into a made-up fleet-wide event total. Separate alerts
detect `probe_ok=0`, missing, outdated or unreachable metrics.
`VibressPluginWorkerTargetMissing` assumes this dedicated scrape job
always exists once monitoring is opted in; disable this optional rule
for an intentionally unmonitored environment. Do not mistake unobserved
metrics for a zero backlog.

**Limitations:** These files ship as operator-approved, opt-in
configuration. They have not been loaded into a real external Prometheus
server/Alertmanager in this PR. PromQL evaluation fixture verification and
multi-replica operational testing are still required before production
alert acceptance. Never expose secrets or tenant metadata in alert labels.

## Audit retention and legal holds (policy, no destructive automation)

`audit_events` is currently append-only and **not** subject to
plugin-specific automatic deletion. The new global plugin audit rows
(`publication_id=NULL`) and publication-owned actions share existing
CMS audit storage, legal hold, backup/restore and access policies. This
PR adds **no TTL, purge job, retention SQL, data backfill or automatic
removal**. A user installing/upgrading Vibress must retain historical
events unless their operator explicitly approves a lawful retention
change.

For each self-hosted deployment the operator must document:

- The applicable legal/contractual minimum, privacy purpose and maximum
  retention for global and publication-scoped audit events, including
  staff/actor IDs, request IDs, event metadata and third-party plugin
  activity; do not invent one universal number of days.
- The published backup/PITR window, encrypted archives, access log and
  restoration proof. Archiving must preserve chronological integrity and
  relationship to durable event receipts, even if a plugin is uninstalled.
- Any legal hold, litigation, fraud/security investigation or tenant
  portability requirement that bars deletion.
- A separate, reviewed **export + retention + purge** change with
  permission checks, publication scope, preview/dry-run, bounded batches,
  idempotency and rollback/restore tests **before** removing anything.

No existing operator can delete audit history through these changes.
Retention sign-off and failure simulations remain separate M1A gates.
