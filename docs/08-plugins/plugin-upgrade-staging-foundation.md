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

Only the **staged** status is ever written by this implementation. The schema
reserves the later phase names for forward-compatible orchestration; their
presence does not confer runtime authority or implement phase transitions.

## Upgrade and rollback

Migration `0046_plugin_upgrade_plans.sql` is additive, empty on upgrade
and does not change existing publication/content/plugin state. It adds a
foreign-key-protected plan history, a unique index limiting concurrent active
plans per plugin and SHA-256/check constraints. The prior migrations must
remain immutable. Verify both fresh installation and an existing populated
upgrade using normal migration procedures and a bounded database lock timeout.

An unfinished plan must not trigger deletion, activation or data migration.
Schema expansions, backfills and successful external effects must not be
automatically reversed. Rollback or forward-fix requires a separate,
operator-approved compatibility and restore procedure.

## Explicitly open

- Authenticated and audited operator approval, CAS phase transitions,
  preflight/permission consent, fleet draining, signed image fencing,
  migration application with interrupted-upgrade tests, observe/rollback.
- Proven signed old-release identity on each running replica, not merely
  identical version strings in the database.
- Deactivation/uninstall/purge, independent SDK acceptance, Tier 2 isolation,
  marketplace validation and all M0–M6 release sign-offs.
