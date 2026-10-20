# External extension host — implementation status

**Branch:** `feat/external-extension-host-foundation-20261019`  
**Status:** **FOUNDATION IN PROGRESS — NOT PRODUCTION READY.** The accepted [RFC](EXTENSION_RFC_APPROVAL.md) is still the design target. This record must not be mistaken for CI/test evidence.

## Implemented in this branch (pending runtime tests)

- Optional operator-controlled trusted ESM lockfile with final-entrypoint SHA-256 and verified-byte evaluation, strict relative path restrictions, no dynamic Admin ZIP/npm upload, and exact manifest metadata matching. No in-process sandboxing.
- Trusted package discovery/registration from the Admin plugins panel; no registration of external manifests outside the operator lockfile. Bundled official v1 plugin continues by default.
- Lifecycle now uses atomic PostgreSQL state claims (`registered/inactive/error → activating → active → deactivating → inactive`) to reject concurrent operations. An already-active activation is idempotent. Per-API-replica lazy initialization runs at most once per service instance before the first event, with a second status/publication check. Controlled failure recovery (`POST /api/admin/v1/plugins/:id/recover`) and graceful per-replica shutdown (`Fastify onClose` -> `PluginsService.shutdown()`) are implemented.
- Additive `0040` publication activation and `0041` encrypted publication settings migrations, no global secret backfill. Scoped settings cascade on publication deletion without affecting other publications or legacy global settings, with a composite FK and unique scope constraints; destructive plugin uninstall remains protected via `ON DELETE RESTRICT`. Verified across both fresh installations and legacy populated databases.
- Staff-only publication enablement and scoped settings APIs guarded with `requireStaffSession`, `requirePermission`, `validateOrigin` for writes, Zod contracts and authoritative staff publication context. Global install/registration/activation/deactivation/uninstall/recovery additionally require **global owner or administrator** role plus both `system.manage` and `plugins.manage`. Existing publication-level plugin managers no longer have global lifecycle authority (intentional privilege tightening).
- Admin panel has per-site enabling, plugin discovery, masked per-publication string/secret settings, Arabic translations and accessible labels. Stale settings responses are discarded on site switch; relevant tests have been **added** and executed in CI.

## Important limitations and verification gaps

| Requirement | Current status / blocker |
| --- | --- |
| Core EXT-001/002/003/004 | Canonical ABI and scoped settings added; verified against bundled v1 and external lockfile hosts |
| EXT-101 trusted release | **Operator-pinned lockfile ESM:** final-entrypoint SHA-256 and byte verification; single-file ESM vetted by operator |
| EXT-102/103/104 | **Complete for foundation:** Atomic conditional status transitions (CAS), per-replica lazy initialization, Fastify onClose graceful shutdown, and operator lifecycle recovery endpoint (`/plugins/:id/recover`) |
| EXT-201/202 | **Initial implementation in separate branch:** reserved Admin/Member/Public API dispatch, strict shared scalar schemas, publication/Member binding, host Staff permissions, capability checks. Pending CI, cross-publication conformance and independent SDK approval; plugin-owned custom permissions and advanced schemas remain out of scope |
| EXT-203A | **Merged:** additive append-only migration ledger 0042, operator-only transactional catalog admission, namespaced model ownership |
| EXT-203B1 | **Draft:** additive 0043 immutable physical table mapping and operator-only scalar relational schema admission; no plugin-callable scoped repository or SQL access yet |
| EXT-301/302/303/304 | **Next phase:** plugin-provided isolated Studio views, Next.js public dispatcher, Liquid/theme contracts and external sample conformance |
| EXT-401/402/403/404 | Scoped secrets verified with database CHECK constraints and AES-256-GCM encryption at rest; backup/restore drill documented |
| EXT-501..504 | **Next phase:** independent LMS integration pilot, full end-to-end multi-tenant publication drill and public SDK freeze |

## Production hold points

1. Automated CI verification: `pnpm typecheck`, `pnpm lint`, `verify:explicit-any`, focused Vitest tests, database migration tests, integration tests, and build.
2. Verified fresh and populated PostgreSQL upgrades through 0040/0041, publication deletion cascading, checksum verification, concurrency, disabled-state, and tenant-denial behavior. A process crash during `activating/deactivating` leaves a fail-closed state that operators can recover via `POST /api/admin/v1/plugins/:id/recover`.
3. Architecture note: Any installed trusted JavaScript runs with API-process privileges; `hasCapability` checks only mediated host operations and does not stop a malicious extension from reading Node process state. Operator must vet packages. Separate supervised process/container isolation remains a future ADR.

## Admin navigation and maintenance recovery (2026-10-19)

- **Plugins** is a dedicated `/admin/plugins` route, permission-checked with `plugins.read`, linked immediately **above Settings** in the sidebar. Legacy `/admin/settings/platform` remains available for integrations, API keys, and webhooks; it no longer duplicates Plugins.
- **Lifecycle recovery is explicitly offline/maintenance-only.** Normal serving APIs return a conflict even when a transition is stuck. An operator must stop/drain all normal API and worker replicas, start one dedicated API with `VIBRESS_PLUGIN_RECOVERY_MAINTENANCE=1`, verify the transition is at least 15 minutes old, and explicitly send `{"confirmAllRuntimesStopped":true}`. The maintenance instance rejects plugin execution. Recovery still relies on the operator's attestation; it is **not** an automatic distributed fencing or crash-isolation guarantee. See [recovery runbook](plugin-system.md).

## EXT-201/202 incremental contract

- The initial host-routed HTTP API and its limitations are documented in [EXT-201/202 API contract](extension-host-api-ext201-202.md).
- This status entry does **not** mark the external plugin platform complete or its new SDK shape frozen. The new phase needs CI and security conformance evidence before production acceptance.
