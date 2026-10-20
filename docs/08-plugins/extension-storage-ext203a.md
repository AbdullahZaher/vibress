# EXT-203A — Plugin migration and storage ownership foundation

**Status:** Implemented on a feature branch; requires CI and production review.
Not a complete EXT-203 storage runtime and not a stable callable plugin SDK.

## Scope and guarantees

Migration `0042_plugin_migration_storage_foundation.sql` additively creates:

- `plugin_schema_migrations`: append-only, platform-global migration ledger,
  unique per (installed plugin ID, migration ID). Each record contains the
  operator-approved package version, exact package artifact SHA-256, migration
  SHA-256, and applied timestamp. The plugin foreign key uses `ON DELETE
  RESTRICT` so uninstall does not silently destroy migration history.
- `plugin_storage_models`: append-only reservation of (installed plugin ID,
  model key), bound by a compound foreign key to an already recorded migration.
  A second plugin may independently reserve an identical model key, but the
  same plugin cannot reuse a model name or change its descriptor digest.
- Regex/CHECK constraints on IDs and 64-character SHA-256 hashes, unique
  indexes, and PostgreSQL triggers rejecting UPDATE/DELETE to either catalog
  table. These are operator-reviewed metadata tables, **not** a generic JSON
  content store or a claim of logical data isolation from arbitrary JS.

Existing `plugins`, `plugin_settings`, `plugin_publication_states`, and
`plugin_publication_settings` rows are untouched. No state/secrets are
copied to other publications or newly enabled. Old plugin SDK v1 contracts,
published content, and worker/web APIs remain unchanged.

## Operator-side catalog admission

`PluginStorageMigrationService.registerApprovedCatalog()` validates
the operator-reviewed declaration, then delegates to
`DrizzlePluginStorageMigrationRepository`. It is **not exposed over HTTP,
machine APIs, plugin SDK, hooks, or the admin UI**. The caller in a future
deployment command must verify the operator-pinned artifact and migration
checksum *before invoking this internal service*.

The repository opens a PostgreSQL transaction, acquires a per-manifest
transaction-scoped advisory lock, and locks the installed plugin row. A **new** migration can be recorded
only while the plugin is `registered` or `inactive` and its declared
package version matches the installed plugin's recorded version. Operators
must register/update the approved installed release before its new catalog
migrations; the operator deployment orchestration still needs to verify the
pinned artifact and declaration checksums. Exact historical replays remain
idempotent even after a subsequent approved package-version upgrade. Replays
of identical applied metadata succeed without writing;
checksum or descriptor drift, duplicate model claims, backward IDs, unknown
plugins, or active plugin status fail closed. Model reservations and the ledger
commit together or roll back together. App-level uninstall refuses plugins
with applied schema migrations, and database foreign keys independently
enforce this invariant.

**Important:** The current service records reviewed **catalog metadata only**.
It does **not** run SQL provided by a plugin, and a catalog entry does not
mean that a physical plugin-owned data table exists. Operator DDL application,
durable per-model relational repositories, typed transactions, composite
publication/course keys and migration/backfill execution are separate
**EXT-203B** deliverables. Therefore a plugin must not treat catalog
registration as proof it can yet read/write persisted course data.

## Deployment and recovery policy

1. Take a signed, verified PostgreSQL + storage/config backup before
   deploying the schema migration on an existing installation.
2. Run normal core database migration `0042` using the existing
   `pnpm db:migrate` deployment procedure. It is designed to be additive,
   safe to retry, and does not execute third-party code.
3. Operators verify reviewed package/checksum information out of band.
   Plugin remains inactive while catalog admission is performed. Never run
   deployment migrations in parallel with active plugin handlers.
4. Postgres transactions prevent half-written catalog entries. If a process
   terminates before COMMIT, retry the same approved declaration. If already
   committed, the same declaration returns `already_applied`.
5. On a digest conflict, stop and investigate. Never rewrite an applied
   migration or edit historical migrations. Use a **new, forward-only** reviewed
   migration and a coherent backup/restore plan.
6. Existing installs with v1 plugin rows do not receive any implicit catalog
   entries. Deactivation does not purge anything; ordinary uninstall is
   blocked if migration history exists. Explicit retiring/archiving requires
   a separate audited operator workflow.

## Operational and security limits

The catalog is **per installed plugin**, not per publication. Actual
content tables in EXT-203B must carry the authoritative `publication_id`,
enforce publication/course composite foreign keys and access policies,
and respect Member ownership. Schema model names alone grant no access.

The host still loads trusted JavaScript in the API process; neither
capability declarations nor migration metadata are a JavaScript sandbox.
This foundation has no dynamic install, plugin-provided SQL, arbitrary
transaction callback, hidden cloud dependency, new environment variable,
or public API change.

## Validation and acceptance

New tests cover: empty and populated schema upgrades, unchanged legacy
secrets, disabled-by-default publication state, foreign keys, immutable
rows, bad digests/IDs, namespace collisions, replay/idempotency, checksum
conflicts, transaction rollback on duplicate model, migration ordering,
blocked active-plugin admission, multi-connection contention and
blocked uninstall. Typecheck, lint, package and CI E2E/build are mandatory
before marking this phase ready for review.

See [storage RFC](external-extensions-storage-contract.md) and
[roadmap](external-extensions-roadmap.md). This ticket closes **EXT-203A
catalog/ledger**, not EXT-203 as a whole.
