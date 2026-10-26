# PLUG-UPD-01 — Operator-only staged upgrade foundation

**Status:** Implementation authored; CI and live-operator acceptance are separate gates.
This introduces an inert `plugin_upgrade_plans` PostgreSQL record. It does
**not** upgrade an installed plugin, change lifecycle state, run SQL, authorize
Admin users, drain Workers, import ESM, or enable untrusted execution.

## Trust boundary

1. Freeze two read-only, immutable deployments (current and candidate).
2. Independently verify *both* manifests and signed release inventories with
   `verifyOperatorReleaseAdmission()`, using the configured trust root.
3. Obtain the target manifest only from its *verified* signed lockfile; never
   accept arbitrary manifest JSON, tenant IDs or receipts from HTTP, plugins,
   or marketplace metadata.
4. Compare the old signed receipt against the actually deployed source
   release on **every** active API/Worker image. Current database version
   alone does not prove the running binary digest.
5. Once operators have explicitly verified these prerequisites, an offline
   trusted orchestration process may call `DrizzlePluginUpgradePlanRepository.stage`
   with the two verified receipts and target manifest. The repository locks
   the actual plugin row, fails on stale version/identity and limits each
   plugin to one nonterminal plan.

The only permitted write transitions are **creating `staged`**,
**`staged → aborted`**, **`staged → preflighted`** and
**`preflighted → approved`** with exact plan hash + expected revision CAS. Aborting
requires operator-supplied authenticated audit identity and writes a global
`audit_events` row atomically with status/revision changes. Aborting an already
approved, executing or changed plan is rejected; the method never deletes
historical plans. Preflight requires an inactive/registered installed plugin, no enabled
publication and no pending/dispatching/queued receipts at the time of the
locked database observation. The resulting SHA-256 fingerprint binds that
observation to the persisted plan, revision and old/new signed-release pins.
Approval additionally requires the exact preflight fingerprint and explicit
review of the ordered capability diff; it rechecks readiness before recording
the authenticated operator's approval and audit in one transaction. The
preflight and approval are **operator-only intents**, not proof that replicas
are drained or signed images match; no transition to `quiesced` or later is
implemented. None of these operations authorizes execution or release
activation without separate verified fleet fencing and migration acceptance.
The schema reserves later phase names for forward-compatible orchestration;
their presence does not confer runtime authority or implement phase transitions.

## Upgrade and rollback

Migrations `0047_plugin_upgrade_plans.sql` and
`0048_plugin_upgrade_preflight_approval.sql` are additive and safe for
existing staged or aborted upgrade plans; the second adds nullable
preflight and operator approval metadata. The original staging table is empty on upgrade
and does not change existing publication/content/plugin state. It adds a
foreign-key-protected plan history, a unique index limiting concurrent active
plans per plugin and SHA-256/check constraints. The prior migrations must
remain immutable. Verify both fresh installation and an existing populated
upgrade using normal migration procedures and a bounded database lock timeout.
A focused isolated PostgreSQL test is authored for duplicate active plans,
malformed digests, restricted plugin deletion and preservation of installed
records; exact-HEAD CI evidence remains required.

An unfinished plan must not trigger deletion, activation or data migration.
Schema expansions, backfills and successful external effects must not be
automatically reversed. Rollback or forward-fix requires a separate,
operator-approved compatibility and restore procedure.

## Explicitly open

- Independent signed multi-replica evidence, migration/schema diff consent,
  all execution-phase transitions, fleet draining and signed image fencing,
  migration application with interrupted-upgrade tests, observe/rollback.
- Proven signed old-release identity on each running replica, not merely
  identical version strings in the database.
- Deactivation/uninstall/purge, independent SDK acceptance, Tier 2 isolation,
  marketplace validation and all M0–M6 release sign-offs.
