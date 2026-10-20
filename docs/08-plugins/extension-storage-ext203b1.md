# EXT-203B1 — Operator-only physical relational model admission

**Status:** Draft; requires PostgreSQL and CI review. This is the first
EXT-203B slice, **not** a plugin-callable storage API or SDK release.

## Scope and trust boundary

`PluginPhysicalSchemaMigrationService.applyApprovedPhysical()` is an internal
operator-maintenance operation. Its caller **must independently verify** the
installed artifact's external SHA-256 pin and approved descriptor before
admission. It is intentionally not wired into Admin, Member, public routes,
workers, hooks, or the plugin SDK.

The accepted declarative plan contains 1–16 models, each with 1–24 scalar
fields (`text`, `integer`, `boolean`, or `timestamptz`). Model and migration
SHA-256 digests must match the exact ordered descriptors. Field names exclude
core owner/version columns. Only a fixed type allowlist can reach SQL
generation; the service accepts no raw SQL, user callback, or arbitrary JSON.

An exclusive per-plugin advisory transaction lock and plugin row lock serialize
admission across maintenance processes. A new migration requires an installed
matching version and inactive/registered plugin. In one PostgreSQL transaction,
the service writes the 0042 immutable ledger/model reservations, creates
individual per-model tables, and records the immutable 0043 physical mapping.
A failure reverts **all** tables and metadata, including any earlier table
created by the same plan. Existing metadata-only migrations cannot be
silently reinterpreted as physical migrations.

Physical identifiers are deterministic `ext_`-prefixed SHA-256-derived opaque
names, separate for each installed plugin manifest and model. No caller
supplies a table identifier. A table has `(publication_id, id)` composite
primary key, `publication_id` foreign key to the platform's publications
table with `ON DELETE CASCADE`, version and timestamps, plus reviewed scalar
fields. A physical table is **not** itself authorization: plugin-callable
access requires a separate host-controlled scoped repository contract.

## Safe upgrade and recovery

1. Verify signed PostgreSQL and storage/config backup and rehearse recovery
   before deploying to populated production installations.
2. Apply additive `0043_plugin_storage_physical_models.sql` after `0042` via
   normal `db:migrate`. It does not copy old data or activate any plugin.
3. Stop/drain normal plugin-capable API and worker replicas; admit reviewed
   plans using an isolated operator maintenance deployment. No request-time
   DDL or automatic discovery is implemented.
4. If the process dies before COMMIT, PostgreSQL reverts DDL and ledger. An
   identical committed plan returns `already_applied`; missing tables and
   altered mappings fail closed. A table whose columns were externally
   altered without removing it requires operator schema-drift inspection.
5. On a name collision, checksum discrepancy, or failed DDL, stop and
   investigate; never rewrite released migrations, clear the ledger, or
   automatically drop orphaned tables to force admission.
6. Disabling or upgrading a plugin never purges its physical table or
   historical metadata. Uninstall remains blocked by immutable ledger FKs.

## Explicit remaining EXT-203B2 scope

Implement named, typed, capability-checked, publication-authoritative CRUD
repositories with bounded queries, versioned optimistic updates and runtime
schema checks. The host must verify publication enablement and derive scope
from Staff/Member/public site context; it must not trust caller publication
IDs. Course/lesson/enrollment composite references, Member ownership,
transactional multi-model operations and outbox/idempotency require separate
review. No public API, member-entitlement bridge or raw SQL access ships here.

Tests target fresh/populated PostgreSQL upgrades, ledger preservation, FK
enforcement, cross-plugin table separation, duplicate IDs scoped per
publication, forbidden field types, deterministic checksums, idempotent
replay and multi-table rollback. TypeScript, lint, CI and relevant E2E are
mandatory before moving this PR out of Draft.

Operator-vetted in-process JavaScript is **not sandboxed** by this change.
