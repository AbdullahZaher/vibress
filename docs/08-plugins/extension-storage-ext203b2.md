# EXT-203B2 — Host-bound scoped relational storage (internal contract)

**Status:** Draft; not a callable or stable third-party plugin SDK. No HTTP or
worker routes are added. This ticket implements the internal typed repository
foundation only; the host integration and public SDK contract are held for a
separately reviewed phase.

## Contract and authority

`PluginScopedStorageService` is constructed **inside the trusted host** with
the installed plugin ID, publication ID derived from an authenticated Staff,
Member or public-site request, and an **operator-approved** model descriptor.
It is not constructed from a plugin's request body or manifest fields. Model
names are selected only from this closed set, which is checksum-verified against
the immutable 0042/0043 schema ownership metadata on every operation.

A plugin cannot supply SQL, physical table names, projection columns,
`publication_id` or `plugin_id` through these operations. The service
supports `get`, ordered cursor `list` (maximum 50), `create`, and
optimistically-versioned `update`. Writes reject unknown/reserved field
names, missing required columns, invalid values, unsupported types, unbounded
text and malformed record IDs. Reads validate the projected field types and
return only the declared fields, record ID and version.

Two new **additive** manifest capabilities are recognized:
`extension.storage.read` and `extension.storage.write`. They do not
automatically grant access. During each PostgreSQL transaction, the repository
acquires share locks on the plugin and publication-enablement rows, then
confirms:

- The installed plugin is active and has the specific read/write capability.
- The authoritative publication has an enabled state for that plugin.
- A matching immutable model ownership and physical table mapping exists.
- The approved descriptor SHA-256 and expected hashed physical table name match.

The repository injects `publication_id` into every SQL predicate/insert,
and no handler sees or accepts a raw database client. Write version conflicts
and duplicate keys return stable domain error codes. Disabling a plugin blocks
future operations without purging any stored rows.

**Security limit:** These checks are mediated host operations, not isolation
from malicious operator-installed JavaScript already running in the API
process. Plugins must continue to be operator-reviewed and pinned. The
constructor is an **internal authority boundary**, not a permission grant to
an arbitrary plugin caller; the caller binding in Admin/Member/Public must
still enforce the existing route authentication, permissions, Origin/privacy
checks, and Member-publication equality before constructing the service.

## Upgrade and compatibility

No database migration, metadata rewrite, historical data backfill, new
environment variable, public HTTP API or SDK method is introduced. The
existing 0042/0043 tables remain unchanged. Existing v1 plugins continue to
run without either new storage capability. Namespace owners and data remain
intact on activation changes and plugin upgrades.

## Remaining work before plugin-callable storage

The host still needs a strictly versioned storage binding into admitted plugin
handlers, a public SDK typed-model API, independently built plugin conformance
tests, authenticated principal binding and Member/content/entitlement rules.
Complex foreign keys between course/lesson/enrollment models, multi-model
transactions, outbox/idempotency, and full physical-schema drift detection
also require separate design/review. The generic scalar tables from 0043
must not be misrepresented as having those relational invariants.

Validation gate: two-plugin/two-publication PostgreSQL tests, invalid input,
disabled/lacking capability, lookup scoping, duplicate key and stale version,
plus TypeScript, lint, Vitest, build and PR E2E. Run a populated staging
backup/restore drill before enabling storage for production plugins.
