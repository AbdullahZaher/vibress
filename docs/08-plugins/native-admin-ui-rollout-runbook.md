# Native Admin UI — Operator Rollout and Acceptance Runbook

**Status:** Implementation complete & automated CI certified green; **DEFAULT-OFF IN PRODUCTION PENDING FORMAL HUMAN/OPERATOR APPROVAL**.
**Branch:** `docs/native-admin-ui-plan-20261025`
**Verified Head SHA:** `50ad19bdef92560ede7704e6ec2a25e8fa3e7c43`
**Verified CI Run:** [GitHub Actions Run 40745534648](https://github.com/AbdullahZaher/vibress/actions/runs/40745534648)
**Date:** 2026-10-28.
**References:** [Implementation Plan](native-admin-ui-plan.md), [Security & Compatibility Matrix](native-admin-ui-security-compatibility.md), [Production Acceptance](native-admin-ui-production-acceptance.md), [Developer Guide](native-admin-ui-developer-guide.md).

---

## 1. Operator-Controlled Opt-In Contract

Native Admin UI and its action gateway are disabled by default. Activation is controlled strictly by operator-configured environment variables on API replicas:

| Environment Variable | Required Format / Value | Default | Purpose |
| --- | --- | --- | --- |
| `VIBRESS_NATIVE_ADMIN_UI_RELEASES` | Comma-separated `pluginId@64-hex-sha256` | *unset* | Read-only Native view admission for exact pinned entrypoint artifact digest. |
| `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` | Comma-separated `pluginId@64-hex-sha256` | *unset* | Write action admission for exact pinned entrypoint artifact digest. Mandatory prerequisite: must also be in `VIBRESS_NATIVE_ADMIN_UI_RELEASES`. |
| `VIBRESS_ENCRYPTION_KEY` | 64-hex string (`openssl rand -hex 32`) | *required* | Cryptographic key for HMAC-SHA256 cursor signing and secret decryption. Must be identical across all replicas. |

```dotenv
# Production Default (both UNSET on all API replicas):
# VIBRESS_NATIVE_ADMIN_UI_RELEASES=
# VIBRESS_NATIVE_ADMIN_ACTION_RELEASES=

# Example Stage Activation (exact 64-character lowercase hex digest, NEVER a semver):
VIBRESS_NATIVE_ADMIN_UI_RELEASES=vibress-lms-authoring@4ae44d903b723e4411ab2a090e19e99ff87a0923e3e2e1a4b5c6d7e8f9a0b1c2
VIBRESS_NATIVE_ADMIN_ACTION_RELEASES=vibress-lms-authoring@4ae44d903b723e4411ab2a090e19e99ff87a0923e3e2e1a4b5c6d7e8f9a0b1c2
```

> [!IMPORTANT]
> **Digest Constraint:** Release allowlists require the 64-character lowercase hex SHA-256 entrypoint digest from `trusted-plugins.json`, **NOT** a semantic version or package name. Supplying a version string (e.g. `plugin@1.2.0`) fails configuration parsing and causes all native requests to fail closed.

---

## 2. Verified Automated Gates (CI Run 40745534648)

The following automated verification checks ran and passed on GitHub Actions runner infrastructure against commit `50ad19bdef92560ede7704e6ec2a25e8fa3e7c43`:

```sh
# 1. Monorepo Typecheck & Lint
pnpm typecheck                    # 71/71 projects passed clean
pnpm lint                         # 72/72 projects passed clean (0 errors)
pnpm verify:explicit-any          # 182 occurrences (budget: max 220)
pnpm audit --prod --audit-level moderate # 0 vulnerabilities

# 2. Additive Contract & Unit Suites
pnpm exec vitest run packages/api-contracts/src/__tests__/extension-native-admin.test.ts
pnpm exec vitest run packages/api-contracts/src/__tests__/extension-native-data.test.ts
pnpm exec vitest run packages/api-contracts/src/__tests__/extension-native-workflow.test.ts
pnpm exec vitest run apps/api/src/plugins/__tests__/native-admin-registry.test.ts
pnpm exec vitest run apps/api/src/plugins/__tests__/native-data-registry.test.ts
pnpm exec vitest run apps/api/src/plugins/__tests__/native-domain-workflow.test.ts
pnpm exec vitest run apps/admin/src/components/platform/__tests__/NativeExtensionAdminView.test.tsx
pnpm exec vitest run apps/admin/src/components/platform/__tests__/NativeExtensionDomainEditor.test.tsx
pnpm exec vitest run apps/admin/src/components/platform/__tests__/NativeExtensionActionForm.test.tsx
pnpm exec vitest run apps/admin/src/components/platform/__tests__/NativeExtensionArabicRtl.test.tsx

# 3. Integration & Multi-Process Replica Parity
pnpm exec vitest run tests/integration/native-admin-multi-process-replica.test.ts # 9/9 passed
pnpm exec vitest run tests/integration/native-data-cursor-multi-replica.test.ts   # 5/5 passed
pnpm exec vitest run tests/integration/native-admin-independent-packaged-consumer.test.ts # 9/9 passed
pnpm exec vitest run tests/integration/real-lms-authoring-host.test.ts           # 11/11 passed

# 4. Genuine End-to-End Browser & Database Acceptance
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/native-admin-lms-real-e2e.test.ts # 7/7 passed
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/native-admin-lms-arabic-rtl.test.ts # 6/6 passed

# 5. Production Container Assembly & Security Scanning
docker build -f docker/api.Dockerfile . -t vibress-api:scan
docker build -f docker/worker.Dockerfile . -t vibress-worker:scan
trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 vibress-api:scan    # 0 findings
trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 vibress-worker:scan # 0 findings
```

---

## 3. Operational Rollout Procedures

### Procedure 1: Fresh Installation
1. Provision infrastructure: PostgreSQL 16+, Redis 7+, object storage (local/S3).
2. Create environment configuration from template:
   ```bash
   cp infrastructure/env.prod.example .env
   # Generate encryption key
   openssl rand -hex 32
   ```
   Set `VIBRESS_ENCRYPTION_KEY=<generated-64-hex>`.
   Leave `VIBRESS_NATIVE_ADMIN_UI_RELEASES` and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` unset.
3. Run one-shot database migration:
   ```bash
   docker compose -f compose.prod.yml run --rm migrate
   ```
4. Bootstrap system owner:
   ```bash
   pnpm owner:create --email admin@example.com --password <secure-password>
   ```
5. Start services:
   ```bash
   docker compose -f compose.prod.yml up -d
   ```
6. Verify initial state:
   - Access `GET /health/ready` -> returns HTTP 200.
   - Native Admin UI endpoints return `mode: "legacy"` or 404 (disabled by default).

### Procedure 2: Upgrading an Existing Installation
1. **API First Deployment**:
   - Build new API and Worker container images:
     ```bash
     docker compose -f compose.prod.yml build api worker
     ```
   - Keep `VIBRESS_NATIVE_ADMIN_UI_RELEASES` unset during upgrade.
   - Run online additive database migrations:
     ```bash
     docker compose -f compose.prod.yml run --rm migrate
     ```
   - Perform rolling restart of API replicas:
     ```bash
     docker compose -f compose.prod.yml up -d --no-deps api worker
     ```
2. **Admin SPA Deployment**:
   - Build and deploy Admin SPA assets (`apps/admin/dist`).
   - Old API clients continue receiving legacy iframe/scalar views.
   - New Admin SPA gracefully detects `nativeProbeSupported` and falls back to legacy views until allowlists are activated.

### Procedure 3: Signed Plugin Deployment & Admission
1. Verify detached signature of operator lockfile before staging:
   ```bash
   node apps/api/dist/plugins-admit.js \
     --lockfile content/plugins/trusted-plugins.json \
     --public-key content/plugins/operator-public.pem \
     --signature content/plugins/trusted-plugins.sig
   ```
2. Run operator migration preflight (if plugin declares physical models):
   ```bash
   node apps/api/dist/plugins-preflight.js --plugin <plugin-id>
   ```
3. Extract entrypoint artifact SHA-256 digest from admitted `trusted-plugins.json`:
   ```bash
   jq -r '.plugins["<plugin-id>"].releases["<release-id>"].entrypointSha256' content/plugins/trusted-plugins.json
   ```
4. Verify entrypoint digest matches exact calculated checksum of plugin file:
   ```bash
   sha256sum content/plugins/<plugin-id>/index.js
   ```

### Procedure 4: Read-Only Native Rollout
1. Ensure the plugin is admitted, active, and functioning in legacy iframe mode.
2. Configure `VIBRESS_NATIVE_ADMIN_UI_RELEASES` on all serving API replicas:
   ```dotenv
   VIBRESS_NATIVE_ADMIN_UI_RELEASES=<plugin-id>@<entrypoint-sha256>
   ```
3. Restart API replicas or reload configuration.
4. Verify in Admin:
   - Navigate to `/admin/extensions/<plugin-id>/<view-id>`.
   - UI renders native React stat cards and field lists.
   - No iframe DOM nodes exist in page inspector.
   - Write actions and mutation forms remain invisible and disabled.

### Procedure 5: Separately Approved Write Rollout
1. Complete read-only verification (Procedure 4).
2. Verify Staff user permissions:
   - Global role must include `plugins.manage`.
   - Publication-local role must be `owner` or `admin`.
   - Plugin manifest must declare `extension.storage.write`.
3. Configure `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` on all serving API replicas:
   ```dotenv
   VIBRESS_NATIVE_ADMIN_ACTION_RELEASES=<plugin-id>@<entrypoint-sha256>
   ```
4. Reload API replicas.
5. Verify in Admin:
   - Create and update buttons appear with confirmation dialogs.
   - Mutations succeed with version increment (`version: v + 1`).
   - Competing concurrent writes return HTTP 409 or `{ outcome: "conflict" }`.

### Procedure 6: Multi-Replica Configuration
To ensure zero session disruptions or pagination errors across multiple API nodes:
1. **Shared Encryption Key**: Distribute the identical `VIBRESS_ENCRYPTION_KEY` to all API replicas. Mismatched keys cause cross-replica HMAC cursor invalidation (`INVALID_CURSOR`).
2. **Shared Operator Lockfile**: Ensure identical `trusted-plugins.json` and signatures exist across all replicas via shared read-only volume or container image baking.
3. **Identical Allowlists**: Set identical `VIBRESS_NATIVE_ADMIN_UI_RELEASES` and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` on every replica.

### Procedure 7: Emergency Disablement
In the event of an unexpected defect, security incident, or unverified plugin behavior:
1. **Option A: Immediate Write Gate Disablement (Preserves Read UI)**:
   - Unset `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` across API replicas.
   - Reload API replicas.
   - All mutation endpoints immediately reject requests with 404/403.
2. **Option B: Total Native UI Disablement (Instant Fallback to Legacy)**:
   - Unset both `VIBRESS_NATIVE_ADMIN_UI_RELEASES` and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES`.
   - Reload API replicas.
   - Admin UI immediately switches back to the legacy isolated iframe / scalar view.
3. **Option C: Per-Publication Plugin Deactivation**:
   - In Admin SPA, navigate to **Settings > Plugins** and toggle plugin to **Inactive**.
   - API immediately revokes access across all replicas (returns 404).
   - Stored plugin data remains 100% intact in PostgreSQL.

### Procedure 8: Rollback and Recovery
1. Reverting an approved Native release does **not** require rolling back database migrations.
2. Remove the revoked `pluginId@sha256` from `VIBRESS_NATIVE_ADMIN_UI_RELEASES` and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES`.
3. If rolling back to an older plugin release:
   - Update `trusted-plugins.json` with previous release digest.
   - Re-sign lockfile with operator Ed25519 key.
   - Add previous `pluginId@older-sha256` to allowlists.
4. Verify stored content integrity in PostgreSQL:
   ```sql
   SELECT count(*), max(version) FROM plugin_storage_records WHERE plugin_id = '<plugin-id>';
   ```

### Procedure 9: Backup & Restore Validation
1. Execute physical backup drill:
   ```bash
   bash scripts/backup.sh /var/backups/vibress-pre-release.sql.gz
   ```
2. Verify restore on isolated test database:
   ```bash
   bash scripts/restore.sh /var/backups/vibress-pre-release.sql.gz
   ```
3. Run post-restore data integrity checks:
   - Validate `plugin_storage_records` row count and indexes.
   - Run `pnpm exec vitest run packages/database/src/__tests__/dr-backup-restore.test.ts`.

---

## 4. Fail-Closed Security Contracts

| Trigger / Condition | Enforced Outcome |
| --- | --- |
| `VIBRESS_NATIVE_ADMIN_UI_RELEASES` unset | Returns `mode: "legacy"` -> Admin renders sandboxed iframe / scalar view. |
| Entrypoint digest mismatch with lockfile | Returns 404 `EXTENSION_DATA_NOT_FOUND` -> Fails closed. |
| Read allowlisted, but Write allowlist unset | Read views render; mutations return 404 `EXTENSION_DATA_NOT_FOUND`. |
| Staff lacks publication `owner`/`admin` role | Returns 403 `PERMISSION_DENIED` -> No plugin data disclosed. |
| Missing or tampered pagination cursor | Returns 400 `INVALID_CURSOR` -> Cursors cannot be forged across actors or sites. |
| Competing concurrent updates (CAS conflict) | Version mismatch rejected -> Exactly one write succeeds; loser receives conflict. |
| Active publication switched in browser | Client in-flight response discarded -> Former site data never displayed. |
| Plugin deactivated for active publication | Returns 404 `EXTENSION_DATA_NOT_FOUND` -> Stored data intact but inaccessible. |
