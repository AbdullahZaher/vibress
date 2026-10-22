# EXT-506: Real Vibress LMS Installation & Production Integration

**Status:** Verified end-to-end against real Fastify HTTP host and real PostgreSQL.

## Overview

EXT-506 integrates the actual compiled `vibress-lms` ESM artifact (`dist/pilot-release/vibress-lms-pilot.mjs`) into the Vibress core host platform, replacing synthetic test fixtures with real release artifacts.

The integration verifies the end-to-end security and operational contract:
- Cryptographic verification via Ed25519 detached signature and SHA-256 digests.
- Transactional operator migration ledger (`plugin_schema_migrations` and `plugin_storage_models`).
- Activation lifecycle and per-publication enablement (`plugin_publication_states`).
- End-to-end HTTP acceptance across two distinct publications and three Member sessions.
- Member-scoped storage isolation (`plugin_member_records`).
- Idempotency, CSRF rejection, and Arabic/RTL presentation.
- Publication deactivation, data retention, reactivation, and backup/restore readiness.

---

## Architecture & Trust Model

```
                    +------------------------------------+
                    |        Operator Signing Key        |
                    |       (Ed25519, Offline Only)      |
                    +-----------------+------------------+
                                      | Signs exact bytes
                                      v
+--------------------+      +--------------------+      +--------------------+
| vibress-lms-pilot  | ---> | trusted-plugins    | <--- | operator-migration |
| .mjs (SHA-256)     |      | .json              |      | -plan.json         |
+--------------------+      +--------------------+      +--------------------+
                                      |
                           Preflight Offline Check
                                      v
                       +-----------------------------+
                       |  Vibress Host Platform      |
                       |  - Signature Verification   |
                       |  - Checksum Matching        |
                       |  - Model Descriptor Audit   |
                       +--------------+--------------+
                                      |
                     Applies Schema Migration (0001_lms_pilot)
                                      v
                       +-----------------------------+
                       | PostgreSQL Schema / Ledger  |
                       | - plugin_schema_migrations  |
                       | - plugin_storage_models     |
                       | - plugin_physical_models    |
                       +--------------+--------------+
                                      |
                     Per-Publication Enablement & Routes
                                      v
                 +--------------------+--------------------+
                 |                                         |
                 v                                         v
       +-------------------+                     +-------------------+
       |   Publication A   |                     |   Publication B   |
       |  (Site A Origin)  |                     |  (Site B Origin)  |
       +---------+---------+                     +---------+---------+
                 |                                         |
     +-----------+-----------+                             |
     |                       |                             |
     v                       v                             v
+---------+             +---------+                   +---------+
| Member  |             | Member  |                   | Member  |
|   A1    |             |   A2    |                   |   B1    |
+---------+             +---------+                   +---------+
```

---

## Verified Integration Workflow

### 1. Offline Verification & Preflight
- The operator lockfile (`trusted-plugins.json`) is cryptographically signed using Ed25519.
- `readVerifiedOperatorMigrationPlan` verifies:
  1. The lockfile signature matches the operator public key.
  2. The artifact SHA-256 matches the lockfile.
  3. Every physical storage model matches approved descriptors.
  4. Any tampered plan or lockfile immediately fails closed (`PLUGIN_MIGRATION_RELEASE_MISMATCH`).

### 2. Registration & Schema Migration
- The plugin is registered with its manifest metadata (`vibress-lms-pilot`, version `0.1.0-dev.0`).
- `PluginPhysicalSchemaMigrationService` applies the approved physical migration plan.
- Two physical models are recorded:
  - `enrollments`: Member course enrollment state.
  - `completions`: Member lesson completion records.
- Replaying the migration returns `already_applied` (idempotent, append-only ledger).
- The plugin is activated via `pluginsService.activatePlugin()`.

### 3. Tenant Enablement & Member Sessions
- Two distinct publications (`Site A` and `Site B`) are provisioned with English (`en`) and Arabic (`ar`) locales.
- The plugin is explicitly enabled on both publications using `setPublicationEnabled()`.
- Three authenticated Members are provisioned:
  - `mem-a1`: Publication A.
  - `mem-a2`: Publication A.
  - `mem-b1`: Publication B.
- Bearer session tokens are hashed and stored in `member_sessions`.

### 4. HTTP Live-Host Acceptance (`verifyLiveHost`)
Ran the official `vibress-lms` live-host acceptance suite against a live Fastify server:
1. **Public Catalog Projections:**
   - Both sites serve `/api/content/v1/extensions/vibress-lms-pilot/views/catalog/page?locale=en` and `?locale=ar` returning `200 OK`.
   - Host-bound publication IDs, course IDs, and locale variants are verified.
   - Private lesson bodies and member IDs are never leaked in public catalog views.
2. **Access Guards:**
   - Anonymous requests to `/api/members/v1/extensions/...` are denied (`401/403/404`).
   - Member A1 session used on Site B is denied (`401/403/404`).
   - Member B1 session used on Site A is denied (`401/403/404`).
3. **Enrollment & Progress:**
   - Fresh member baseline: Initially unenrolled.
   - Free enrollment POST: Returns `enrolled`. Repeated enrollment returns `already-enrolled` (idempotent).
   - Protected lesson GET: Returns `welcome` lesson data in the requested locale.
   - Lesson completion POST: Completes lesson; repeated completion returns `already-completed` (idempotent).
   - Course progress GET: Returns 50% completed (1 of 2 required lessons completed).
4. **CSRF & Origin Enforcement:**
   - Cross-origin mutation requests (e.g. Origin `site-b` targeting `site-a`) are rejected with `403 Forbidden`.
5. **Arabic / RTL:**
   - Arabic locale queries (`?locale=ar`) return canonical Arabic translations for catalog and lessons.

### 5. Publication Deactivation & Data Retention
- Publication B plugin is disabled via `setPublicationEnabled(pluginId, pubBId, false)`.
- HTTP requests to Site B catalog immediately return `404` (`PLUGIN_PUBLICATION_INACTIVE`).
- Data in `plugin_member_records` for Publication B remains completely intact (no silent data deletion).
- Re-enabling the plugin for Publication B immediately restores `200 OK` responses and member data access.

### 6. Genuine Disposable Database Backup & Restore Verification
- Disposable database isolation ensures tests run in dedicated PostgreSQL environments (`vibress_ext506_<runId>`).
- Physical database cloning creates an exact replica database (`vibress_ext506_restore_<runId>`) from the test template.
- Backup manifest with SHA-256 checksum is written to disk.
- Data integrity verification confirms all model rows, member records, and physical tables (`ext_<hash>`) are restored identically.
- `assertPluginRestoreReadiness()` confirms that the active plugin, its migrations, and its physical models match the disk artifact and lockfile on the restored database.
- Disposable databases are dropped cleanly with `DROP DATABASE ... WITH (FORCE);`.

### 7. Negative Security & Injection Resilience
- Unauthenticated member mutations fail closed (`401/403/404`).
- Path traversal requests (e.g. `..%2f..%2fetc%2fpasswd`) fail closed (`400/404`).
- Payload spoofing attempts (e.g. attempting to pass unauthorized `memberId` or `publicationId` in JSON bodies) are bound strictly to host-authenticated sessions and fail to affect other members or publications.
- Cross-origin state-changing mutations with invalid origins fail closed (`403 Forbidden`).

---

## Test Verification

Run the complete integration suite:

```bash
pnpm exec vitest run tests/integration/real-lms-pilot-host.test.ts
```

All 7 test steps pass:
- `Step 1: rejects tampered artifact and migration plan during offline preflight`
- `Step 2: registers plugin, applies approved migrations, and activates plugin`
- `Step 3: provisions publications, locales, enablement, and member sessions`
- `Step 4: passes real HTTP live-host acceptance across two sites and three members`
- `Step 5: verifies publication deactivation, data retention, and reactivation`
- `Step 6: performs genuine disposable database backup, restore, and integrity verification`
- `Step 7: verifies negative security scenarios: unauthenticated access, CSRF tampering, and payload injection`

---

## Production Checklist & Release Gates

1. **Custody of Signing Key:** The operator Ed25519 private key must remain offline in secure custody (never mounted in Docker or server filesystems).
2. **Deterministic Build:** Build `vibress-lms` using `npm run release:pilot` in a controlled build container.
3. **Lockfile Generation:** Generate and sign `trusted-plugins.json` containing the exact SHA-256 of `vibress-lms-pilot.mjs`.
4. **Offline Preflight:** Run `pnpm exec tsx scripts/plugins/check-migration-plan.ts` before database operations.
5. **Database Maintenance Window:** Take a verified database backup. Apply migration plan via `pnpm exec tsx scripts/plugins/apply-migration-plan.ts`.
6. **Host Publication Enablement:** Enable the plugin selectively per publication via staff admin credentials.
7. **Acceptance Verification:** Execute `verifyLiveHost` against staging loopback endpoints before routing customer traffic.
