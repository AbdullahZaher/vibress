# Plugin Platform Persisted Contracts, Workflow Formats, and Operational Dependencies (BASE-05)

**Status:** Authoritative inventory and versioned support matrix; PR #89 execution baseline.  
**Reviewed:** 2026-10-29  
**Repository:** `AbdullahZaher/vibress`  
**Milestone:** M0 (BASE-05)  

---

## 1. Persisted Plugin Database Formats

The Vibress Plugins Platform maintains durable state across eight core tables defined in `packages/database`. All schema changes follow strict additive migration invariants: released migrations are immutable, columns are nullable or have deterministic defaults, and no migration may alter existing customer data without a transactional backfill.

| Table Name | Drizzle Definition | Migration | Key Columns and Data Types | Invariants & Constraints |
| --- | --- | --- | --- | --- |
| `plugin_installations` | `packages/database/src/schema/installation.ts` | Baseline / `0040` | `id` (uuid, PK), `manifest_id` (varchar(128)), `name` (varchar(255)), `version` (varchar(64)), `status` (varchar(32)), `capabilities` (jsonb), `settings_schema` (jsonb), `vibress_api_version` (varchar(32)), `checksum` (varchar(128)), `created_at`, `updated_at` | Global operator catalogue; `manifest_id` is unique across releases; `status` in `['registered', 'active', 'inactive', 'activating', 'deactivating', 'error']`. |
| `plugin_publication_states` | `packages/database/src/schema/installation.ts` | `0040_plugin_publication_states.sql` | `plugin_id` (uuid, FK), `publication_id` (uuid, FK), `enabled` (boolean), `created_at`, `updated_at` | Composite PK `(plugin_id, publication_id)`. Publication-level delegation; effective enablement requires global `active` AND publication `enabled = true`. |
| `plugin_publication_settings` | `packages/database/src/schema/installation.ts` | `0041_plugin_publication_settings.sql` | `plugin_id` (uuid, FK), `publication_id` (uuid, FK), `key` (varchar(128)), `value` (text), `is_secret` (boolean), `key_id` (varchar(64), nullable), `created_at`, `updated_at` | Composite PK `(plugin_id, publication_id, key)`. Encrypted secrets use AES-256-GCM authenticated ciphertext; `key_id` indicates keyring version (`v1` implicit or `v2` explicit). |
| `plugin_event_receipts` | `packages/database/src/schema/plugin-events.ts` | `0044_plugin_event_receipts.sql` | `id` (uuid, PK), `plugin_id` (uuid, FK), `event_name` (varchar(128)), `status` (varchar(32)), `payload` (jsonb), `failure_reason` (text), `lease_expires_at` (timestamp), `retry_count` (integer), `admitted_at`, `processed_at` | At-least-once outbox receipt ledger; `status` in `['pending', 'dispatching', 'processed', 'failed', 'poison']`. Stable Redis job correspondence. |
| `plugin_scoped_storage` | `packages/database/src/schema/installation.ts` | `0043_plugin_storage_physical_models.sql` | `id` (uuid, PK), `plugin_id` (uuid, FK), `publication_id` (uuid, FK), `model_key` (varchar(64)), `fields` (jsonb), `version` (integer), `created_at`, `updated_at` | Publication-isolated, operator-approved physical storage; CAS concurrency via `version`; composite index on `(plugin_id, publication_id, model_key)`. |
| `plugin_member_records` | `packages/database/src/schema/plugin-member-records.ts` | `0045_plugin_member_records.sql` | `plugin_id`, `publication_id`, `member_id`, `model_key`, `record_id`, `fields` (jsonb), `version` (integer), `created_at`, `updated_at` | Member-scoped physical records; composite unique key on `(plugin_id, publication_id, member_id, model_key, record_id)`; cross-member and cross-publication access strictly denied. |
| `plugin_storage_migrations` | `packages/database/src/schema/installation.ts` | `0042_plugin_migration_storage_foundation.sql` | `plugin_id` (uuid, FK), `model_key` (varchar(64)), `applied_migration_id` (varchar(128)), `checksum` (varchar(64)), `applied_at` | Migration tracking for plugin-owned physical schemas; immutable ledger prevents re-application or downgrade drift. |
| `plugin_upgrade_plans` | `packages/database/src/schema/plugin-upgrades.ts` | `0047` / `0048` | `id` (uuid, PK), `plugin_id` (uuid, FK), `source_version`, `target_version`, `source_digest`, `target_digest`, `status` (varchar(32)), `preflight_fingerprint`, `operator_approved_at`, `revision` (integer), `created_at`, `updated_at` | Durable state machine for safe plugin upgrades; unique index on `(plugin_id)` where status is active; CAS transitions via `revision`. |

---

## 2. Native Admin UI and Workflow Formats

All Native Admin UI contributions are declarative, inert JSON/Zod data descriptors rendered exclusively by Host-owned React components in `apps/admin`. No untrusted JavaScript, React components, CSS, or raw HTML executes inside the Admin origin.

### 2.1 Declarative Pages (`ExtensionNativeAdminPageV1`)
- **Schema:** `ExtensionNativeAdminPageV1Schema` in `@vibress/api-contracts`.
- **Envelope Limits:** Max 8 pages per plugin, max 12 components per page, descriptor size ≤ 64 KiB.
- **Allowed Components:**
  - `stat`: Key performance metric with localized label, numeric/string value, change delta, and icon hint (`trending-up`, `users`, `activity`, etc.).
  - `field-list`: Key-value attribute list with localized labels and sanitized scalar values.
  - `notice`: Alert banner (`info`, `warning`, `error`, `success`) with localized message.
  - `link`: Bounded internal navigation link to Host-approved routes.

### 2.2 Storage Resources (`ExtensionNativeDataResourceV1`)
- **Schema:** `ExtensionNativeDataResourceV1Schema` in `@vibress/api-contracts`.
- **Query Bounds:** Page limit ≤ 20 rows, signed HMAC pagination cursors bound to `(actorId, publicationId, releaseDigest)`.
- **Field Descriptors:** Explicit field projection (`string`, `number`, `boolean`, `date`). Unprojected fields default-denied.

### 2.3 Typed Actions (`ExtensionNativeDataActionV1`)
- **Schema:** `ExtensionNativeDataActionV1Schema` in `@vibress/api-contracts`.
- **Concurrency & Idempotency:** Requires Staff session, Origin validation, publication-scoped permissions, record ownership, and optimistic CAS `expectedVersion`.
- **Destructive Gates:** Operator-confirmed dialogs for mutations; audit trail recorded atomically with state change.

### 2.4 Domain Workflows (`ExtensionNativeDomainWorkflowV1`)
- **Schema:** `ExtensionNativeDomainWorkflowV1Schema` in `@vibress/api-contracts`.
- **Size Limit:** Descriptor size ≤ 16 KiB.
- **Form Controls:** Text inputs, numbers, selects, toggles, textareas. Host renders form inputs; submission routes only to Host-authorized `/extensions/:pluginId/v1/:routeId` endpoints.

---

## 3. Public Contracts and ABI Separation

| Layer | Contract / Package | Identity & ABI Version | Stability Policy |
| --- | --- | --- | --- |
| Runtime ABI | `@vibress/plugin-sdk` | `SDK_VERSION = "1.0.0"` | Frozen Host runtime ABI; backward-compatible for all Tier 1 and Tier 2 plugins. |
| Package SemVer | `@vibress/plugin-sdk` | `1.2.0` (in monorepo, `private: true`) | Independent npm semver; incrementing package version does NOT break runtime ABI. |
| Wire Protocols | `@vibress/api-contracts` | `NATIVE_ADMIN_PAGE_SCHEMA_VERSION = 1`<br/>`NATIVE_DOMAIN_WORKFLOW_SCHEMA_VERSION = 1` | Additive schema evolution only; breaking wire changes require version negotiation (`v2`). |
| Release Digest | Operator Signed Lockfile | SHA-256 (64 hex characters) | Exact immutable artifact hash; must match across all running API and Worker replicas. |

---

## 4. Operator Environment Variables & Security Keys

| Environment Variable | Purpose | Expected Value / Format | Default / Fallback |
| --- | --- | --- | --- |
| `VIBRESS_PLUGIN_RECOVERY_MAINTENANCE` | Fails closed all plugin execution during disaster recovery or restore drills. | `1` or `true` | `undefined` (normal operation) |
| `VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY` | Enforces signed operator catalog vs legacy unsigned admission. | `"strict"` or `"permissive"` | `"permissive"` (legacy self-hosted) |
| `VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE` | Rejects releases lacking detached Ed25519 signature. | `1` or `true` | `0` (unsigned permitted in permissive mode) |
| `VIBRESS_TRUSTED_PLUGIN_LOCKFILE` | Path to operator release lockfile (`trusted-plugins.json`). | Absolute filesystem path | `""` |
| `VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE` | Path to operator Ed25519 public key in PEM format. | Absolute filesystem path | `""` |
| `VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE` | Path to detached signature of lockfile. | Absolute filesystem path | `""` |
| `VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256` | Pinned SHA-256 hex digest of lockfile. | 64 lowercase hex characters | `""` |
| `VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256`| Pinned SHA-256 hex digest of public key. | 64 lowercase hex characters | `""` |
| `VIBRESS_ENCRYPTION_KEY` | Master AES-256-GCM encryption key for secrets and keyring. | 32-byte hex or base64 key | Mandatory in production |
| `VIBRESS_PLUGIN_NATIVE_ADMIN_WRITES` | Operator opt-in gate for Native Admin write actions and domain workflows. | `1` or `true` | `0` (default-off read-only) |
| `VIBRESS_PLUGIN_UPGRADE_MAINTENANCE` | Maintenance gate for live plugin upgrades. | `1` or `true` | `undefined` |

---

## 5. Backup & Recovery Dependencies

A complete, restorable Vibress deployment consists of four coordinated components that must be backed up and restored together:

1. **PostgreSQL Database:**
   - Tools: `pg_dump --format=custom`, `pg_restore --clean`.
   - Invariants: Contains all core CMS entities, plugin registrations, publication states, publication settings (with encrypted ciphertexts), scoped physical storage, member records, and event receipts.
2. **Redis BullMQ State:**
   - Tools: Redis RDB snapshots (`BGSAVE`), AOF logs.
   - Invariants: Active, delayed, and waiting job queues. Receipts in PostgreSQL remain the authoritative admission log; BullMQ jobs are transient execution envelopes.
3. **Operator Release Directory:**
   - Immutable read-only mounts containing:
     - `trusted-plugins.json` (signed lockfile)
     - `operator-public.pem` (Ed25519 public key)
     - `operator.sig` (detached Ed25519 signature)
     - Operator-admitted plugin ESM artifacts (`*.mjs`)
     - SBOM, provenance, and vulnerability scan reports
4. **Encryption Keyring:**
   - Secure external custody of `VIBRESS_ENCRYPTION_KEY`.
   - Never committed to source control, logs, or unencrypted backup archives.

---

## 6. No-Loss Upgrade & Uninstall Rules

1. **Data-Preserving Disable & Uninstall:** Standard plugin deactivation or de-registration leaves `plugin_scoped_storage`, `plugin_member_records`, and `plugin_publication_settings` intact. Customer content is never silently purged.
2. **Audited Purge:** Physical data deletion is a separate, explicitly authorized operator operation requiring dedicated confirmation and writing an immutable audit record.
3. **Additive Schema Monotonicity:** Plugin migrations (`plugin_storage_migrations`) are strictly additive. Schema rollbacks must only be performed if backward-compatible or explicitly forward-fixed.
