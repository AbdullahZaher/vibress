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
An isolated PostgreSQL regression also covers conservative readiness denials
(inactive global lifecycle, disabled publications, no pending receipts),
stale preflight/approval digests and capability review, transaction rollback
when audit persistence fails, and unchanged installed plugin metadata.
These remain fixture evidence only: approved plans do not activate modules.
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

## PLUG-UPD-03 — read-only source-fleet readiness snapshot (partial)

The optional offline `scripts/plugins/check-upgrade-source-fleet.ts`
correlates an **already approved** durable plan with the **installed**
plugin's source identity and four separately collected release-admission
receipts from at least **two API and two Worker replicas**. It reuses the
existing offline fleet receipt consistency comparator and additionally
requires the source plugin version and exact artifact SHA-256 to match
the immutable plan. Any stale Worker, changed signer/lockfile, unsigned
or missing replica fails closed.

It checks PostgreSQL for enabled publications and unsettled
`pending/dispatching/queued` receipts and requires the entire Redis
plugin queue to have no waiting, active, delayed, paused, prioritized or
waiting-children jobs. This is **more conservative** than checking only
the upgraded plugin, to avoid masking work owned by other plugins.
All checks use bounded queries. The output is aggregate only.

From a **trusted operator terminal** with appropriate read-only access to
the established production data sources and independently collected
admission receipts, while the deployment is **already halted/drained**:

```bash
export VIBRESS_PLUGIN_UPGRADE_MAINTENANCE=1
export VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY=strict
export VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE=1
# Set the expected source release lockfile and signer SHA-256 pins,
# database and Redis connection configuration through protected operator
# credentials; never paste credentials into CLI history or logs.
pnpm exec tsx scripts/plugins/check-upgrade-source-fleet.ts \
  <approved-plan-uuid> \
  api:api-a=/protected/api-a.json api:api-b=/protected/api-b.json \
  worker:worker-a=/protected/worker-a.json worker:worker-b=/protected/worker-b.json
```

**This is an observation, not an authorization or distributed lock.** The
command **does not** verify cryptographic signatures of files passed to
it; the receipt producer must first execute
`verifyOperatorReleaseAdmission()` separately on each **real,
independently identified and immutable** running replica and keep their
evidence under operator custody. `signatureVerified: true` inside a
JSON file is not proof by itself. The database/Redis observations are
not atomic with other replicas. In particular, stopping producers and
preventing new event admissions is a **separate mandatory operator
prerequisite**, and race-free fleet draining, leases and fencing are not
implemented by this command.

No `approved → quiesced` plan transition is authorized or implemented
by this new helper. No migration, ESM import, runtime activation or
schema alteration occurs. Unit tests cover wrong source digest/version,
stale signer, incomplete replicas, disabled-state gates and queue/ledger
backlog. Production multi-replica fencing and admission revocation tests
are still mandatory before moving PLUG-UPD-03 to accepted status.
