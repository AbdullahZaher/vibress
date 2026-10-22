# EXT-205 — Host-bound Member-owned records (first implementation increment)

This is an **opt-in, provisional SDK contract** for trusted, operator-installed
extensions. It does not make arbitrary ZIP installation or untrusted JS safe.

## Admission and authority

- The verified Member session and Host publication resolution supply
  `pluginId`, `publicationId` and `memberId`. No SDK method accepts any of them.
- A plugin must declare `extension.routes.member` plus
  `extension.member_storage.read` and/or `extension.member_storage.write`.
- An operator must approve its storage model in the signed trusted lockfile and
  apply the catalog/physical model migration **before** using Member storage.
  A model approved for Staff storage can be referenced, but Member-owned rows
  are always in a separate `plugin_member_records` table. Admin Staff storage
  never sees Member rows through its existing storage API.
- The DB independently rechecks live plugin status, capability, publication
  enablement, active Member ownership and the approved model digest under
  transaction locks on every operation. An optional Member SDK method is
  absent if binding fails. HTTP route authentication and Origin checks remain
  required; no generic plugin SQL or arbitrary Member selector is exposed.

## Contract

`scope.memberStorage` is optional on Member routes and supports:

- `get(modelKey, id)` returns the current Member's row or null.
- `list(modelKey, limit?, cursor?)` pages only the current Member's rows with
  bounded keyset pagination (1–50 per page), no cross-member enumeration.
- `create(modelKey, id, fields)` atomically creates the current Member's row,
  or raises a conflict if it already exists.
- `update(modelKey, id, expectedVersion, fields)` uses an atomic version check;
  stale versions conflict and another Member's row is not revealed.

Fields are bounded, validated against the operator-pinned typed scalar model,
and do not permit member IDs, tenant IDs or SQL selectors. No public or Staff
route receives this authority. POST-only writes are enforced in both the
request-lifetime session and DB adapter, with transactionally audited mutations.
Every session closes before responding, draining any outstanding operation.

This simple record store is **not** a full relational entitlement system:
course/lesson relationships and paid entitlements must still be checked by
trusted LMS domain logic. A plan membership check is not course enrollment.
Do not store session tokens, payment data or plaintext secrets in model fields.

## Upgrades and operations

Migration `0045_plugin_member_records.sql` is additive and empty on existing
installations, with no legacy content migration. Apply it before deploying API
code granting the two new capabilities. Existing `plugin_storage_*` tables and
bundled SDK v1 behavior remain unchanged. Deactivation disables admission; it
never purges Member records. The plugin enablement row cannot be deleted while Member records exist;
operators must perform a reviewed export/retention workflow before an explicit
purge. Disabling does not remove it. Deleting an actual Member cascades their
records through a composite `(publication_id,member_id)` FK; publication deletion
may require an operator-reviewed cleanup order and the site's privacy policy.
This migration also adds a unique `(publication_id,id)` index on existing
`members` to enforce that composite foreign key, and needs an upgrade lock
assessment on large tables. Uninstall is restricted by existing catalog
ownership/migration foreign keys. Neither this increment nor database locks
is an untrusted-JS process sandbox.

## Release gates not satisfied by this increment

Before enabling this in production, run migration validation with real existing
and fresh PostgreSQL data, cross-Member/cross-publication API and DB integration
cases, concurrent create/CAS, disabled/deleted Member, signature and capability
revocation, Docker/multi-replica, upgrade/restore, retry, Arabic/RTL and real
`vibress-lms` Host-adapter acceptance. Do not publish a stable SDK release
solely from this additive foundation.
