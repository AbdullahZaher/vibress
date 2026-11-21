# M00 — Unit Failure Root Cause Register

**Investigated candidate:** `ac07c737de0b512f9ad616773715ee3a8cd095a4`.
**Original run:** Node v26.13.0, disposable PG16 only, no Redis/S3/Mailpit -> 2324 passed / 53 failed / 356 skipped.
**Final run:** Node v24.22.3 (declared range `>=24.0.0 <25`), PG16 + Redis 7 + S3-compatible + Mailpit -> 379 files / 2733 tests passed, exit 0.

## Classification summary

| Classification | Entries | Root cause | Evidence |
| --- | --- | --- | --- |
| JSDOM_ENVIRONMENT | 2 | Node 26 global `window.localStorage` getter (`internal/webstorage`) shadowed jsdom Storage; Node warned `--localstorage-file` was not provided | Probe showed the Node getter on v26 and a jsdom getter on v24; the same tests pass on v24 with no assertion changes |
| MISSING_TEST_DEPENDENCY | 46 | Redis/S3 absent; API readiness returned 503 and ioredis reported `MaxRetriesPerRequestError` | `docker ps` showed only `ruxbase_db`; after Redis 7 / MinIO started, the same tests pass |
| TEST_TIMEOUT | 22 | Hooks/tests waited on unavailable services (5s/10s) | `Hook timed out in 10000ms` / `Test timed out in 5000ms`; all pass with healthy services |
| INCORRECT_SERVICE_CONFIGURATION | 6 | S3-compatible endpoint unavailable | S3/MinIO tests pass with the pinned Silo image on port 9000 |
| ACTUAL_APPLICATION_REGRESSION | 0 | None found | Every original failure passes under the restored supported environment; no application source was changed for this |
| UNKNOWN_REQUIRES_INVESTIGATION | 0 | None remaining | — |

The reported canonical count was **53 test-level failures**; the raw log contains 76 unique `FAIL` identifiers because Vitest also reports beforeAll/beforeEach hook and suite-level failures separately. Both are inventoried below.

## Per-test inventory (original failed run log, deduplicated)

| Test file | Test | Original message | Classification | Final result |
| --- | --- | --- | --- | --- |
| tests/security/single-publication-boundary.test.ts | > ARCH-01: Single-Publication Runtime Boundary & Multi-Tenant Attack Surface Verification | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/ai-routes.test.ts | > AI Gateway API Routes | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/billing-api.test.ts | > Batch 9 — Billing Integration & Security | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/body-limit.test.ts | > Body Limit Enforcement | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/collaboration-routes.test.ts | > Studio Collaboration API Routes | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/comments-adversarial-publication-isolation.test.ts | > Phase 14 — Adversarial Comments Multi-Tenant & Publication Isolation | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/comments-closure-gates.test.ts | > Comments Final Evidence Closure Gates | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/community-api.test.ts | > Batch 11 — Community Integration & Security | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/content-models-adversarial-publication-isolation.test.ts | > Content Modeler Adversarial Publication Isolation & Security Certification | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/content-models-api.test.ts | > Content Modeler API Routes | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/content-models-lifecycle-and-concurrency.test.ts | > Content Modeler — Publication Lifecycle & Concurrency Hardening (P0/P1) | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/intelligence-api.test.ts | > Batch 13 — Intelligence Integration & Security | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/media-upload-real.test.ts | > POST /api/admin/v1/media Upload Testing | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/newsletters-api.test.ts | > Batch 10 — Newsletters & Email Integration & Security | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/operations-api.test.ts | > Batch 14 — Operations Integration & Security | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/performance-baseline.test.ts | > PHASE 11: Production Performance Baseline Suite (p50/p95/p99) | AssertionError: invalid value "undefined" for header cookie | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/platform-api.test.ts | > Batch 12 — Platform Integration & Security | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/post-feature-image-api.test.ts | > API: Post Feature Image & Unsplash Integration | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/rate-limit-store.test.ts | > F-013: rate-limit counters are shared through Redis | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/staff-auth-lifecycle.test.ts | > AUTH-01 & AUTH-02: Staff Identity Lifecycle & Password Recovery Suite | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/theme-e2e-lifecycle-full.test.ts | > E2E External Theme Full Lifecycle & Cold Restart Persistence Gate | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/themes-api.test.ts | > API — External Theme System Integration | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| packages/storage-s3/src/__tests__/s3-minio-integration.test.ts | > Real MinIO Protocol & Storage Integration | Error: connect ECONNREFUSED 127.0.0.1:9000 | INCORRECT_SERVICE_CONFIGURATION | PASS |
| tests/security/auth-api.test.ts | > Auth & Authorization API Security > login with valid credentials sets HttpOnly cookie and returns user summary | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| tests/security/auth-api.test.ts | > Auth & Authorization API Security > login with invalid password or non-existent email returns generic INVALID_CREDENTIALS | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| tests/security/auth-api.test.ts | > Auth & Authorization API Security > rejects state-changing requests with invalid external origin | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| tests/security/auth-api.test.ts | > Auth & Authorization API Security > returns current user identity on GET /api/admin/v1/auth/me | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| tests/security/auth-api.test.ts | > Auth & Authorization API Security > enforces permission checks on protected endpoints | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| tests/security/auth-api.test.ts | > Auth & Authorization API Security > revokes session on logout | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| tests/security/content-api.test.ts | > Admin Content API & Permissions Security > allows authorized user to create, update, and publish posts | AssertionError: invalid value "undefined" for header cookie | MISSING_TEST_DEPENDENCY | PASS |
| tests/security/content-api.test.ts | > Admin Content API & Permissions Security > enforces permission denial on publish when user lacks posts.publish permission | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| tests/security/content-api.test.ts | > Admin Content API & Permissions Security > handles optimistic concurrency conflict (409 CONTENT_CONFLICT) | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| tests/security/content-api.test.ts | > Admin Content API & Permissions Security > does not leak members/paid visibility content through public content API or lists | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > ensures spoofed XFF does not reset or evade the IP rate limit | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > rate-limits password reset acceptance per client IP | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > ensures an attacker IP cannot lock out the owner logging in f | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > still triggers legitimate lockout for a single attacker IP af | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > behaves identically for unknown emails to prevent account enu | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > allows legitimate login and resets the throttle counter on su | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > verifies behavior with a trusted proxy CIDR configured | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > fails closed for login with 503 and clear log if Redis is una | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > enforces account throttling on member auth request and verify | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > rejects malformed Referer with 403 INVALID_ORIGIN instead of  | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > ensures throttle keys always possess a positive TTL after fai | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > logs a startup security warning when TRUST_PROXY is true in p | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > normalizes IPv6 /64 subnets correctly across compressed and e | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/auth-hardening.test.ts | > Task 1: Rate limiting IP resolution and account-level throttling > enforces progressive delay capped at 1000ms and does not hard | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/plugins/__tests__/admin-ui-frame-tickets.test.ts | > EXT-301B2B shared Redis frame tickets > atomically consumes an operator-approved ticket exactly once across replicas | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/plugins/__tests__/admin-ui-frame-tickets.test.ts | > EXT-301B2B shared Redis frame tickets > rejects invalid tokens and cannot reissue an old client-controlled token | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/member-auth-api.test.ts | > Batch 8 — Member API Integration & Security > member auth request returns generic enumeration-safe response | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/member-auth-api.test.ts | > Batch 8 — Member API Integration & Security > does not reveal member existence via response shape | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/member-auth-api.test.ts | > Batch 8 — Member API Integration & Security > does not create a session from a cross-site GET to the verify endpoint | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/member-auth-api.test.ts | > Batch 8 — Member API Integration & Security > extension member API rejects a member from another publication before plugin execu | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/member-auth-api.test.ts | > Batch 8 — Member API Integration & Security > supplies self-only member bridge to a verified member on an enabled publication | Error: Test timed out in 5000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/storage-api.test.ts | > Storage Configuration & Multi-Provider Integration > should verify mixed-provider deletion routing | (see suite log) | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/theme-lifecycle-hardening.test.ts | > API Security & Themes — Theme Lifecycle & Multi-Version Hardening > creates and resolves preview tokens for themes | AssertionError: expected 500 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Authentication Guard > rejects unauthenticated requests to GET /api/admin/v1/whats-new with | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Authentication Guard > rejects unauthenticated requests to POST /api/admin/v1/whats-new/:id | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Feed Fetching & In-Memory Caching (1 Hour TTL) > falls back to empty notification state gra | AssertionError: expected 503 to be 200 // Object.is equality | MISSING_TEST_DEPENDENCY | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Authentication Guard > rejects cookie-authenticated dismissal without a trusted Origin | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Feed Fetching & In-Memory Caching (1 Hour TTL) > successfully fetches, validates, and serve | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Feed Fetching & In-Memory Caching (1 Hour TTL) > falls back to stale cache when remote fetc | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Feed Fetching & In-Memory Caching (1 Hour TTL) > tolerates individual malformed items in fe | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Per-User Dismissal & Authorization Isolation > dismisses an item for the authenticated user | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Per-User Dismissal & Authorization Isolation > guarantees User A dismissal does not affect  | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/api/src/__tests__/whats-new-api.test.ts | > What's New API & Service Subsystem > Per-User Dismissal & Authorization Isolation > displays a newly added notification item eve | Error: Hook timed out in 10000ms. | TEST_TIMEOUT | PASS |
| apps/portal/src/lib/return-to.test.ts | > Portal sign-in destination > lands on the authenticated member account when no safe return was saved | TypeError: Cannot read properties of undefined (reading 'clear') | MISSING_TEST_DEPENDENCY | PASS |
| apps/portal/src/lib/return-to.test.ts | > Portal sign-in destination > preserves an explicitly selected same-origin public path once | TypeError: Cannot read properties of undefined (reading 'clear') | MISSING_TEST_DEPENDENCY | PASS |
| apps/portal/src/lib/return-to.test.ts | > Portal sign-in destination > rejects untrusted redirect schemes, protocol-relative URLs, Admin and Portal targets | TypeError: Cannot read properties of undefined (reading 'clear') | MISSING_TEST_DEPENDENCY | PASS |
| packages/storage-s3/src/__tests__/s3-backup-descriptor.test.ts | > S3 Backup Descriptor Verification & Tamper Detection > should successfully emit a complete JSON descriptor file with matching ar | Error: Command failed: pnpm exec tsx "/Users/abdullahzaher/vibress/scripts/s3-backup.mjs" --bucket " | INCORRECT_SERVICE_CONFIGURATION | PASS |
| packages/storage-s3/src/__tests__/s3-backup-descriptor.test.ts | > S3 Backup Descriptor Verification & Tamper Detection > should support custom --filename and reflect the exact filename in the de | Error: Command failed: pnpm exec tsx "/Users/abdullahzaher/vibress/scripts/s3-backup.mjs" --bucket " | INCORRECT_SERVICE_CONFIGURATION | PASS |
| packages/storage-s3/src/__tests__/s3-backup-descriptor.test.ts | > S3 Backup Descriptor Verification & Tamper Detection > should verify that archiveSha256 in descriptor strictly matches the physi | Error: Command failed: pnpm exec tsx "/Users/abdullahzaher/vibress/scripts/s3-backup.mjs" --bucket " | INCORRECT_SERVICE_CONFIGURATION | PASS |
| packages/storage-s3/src/__tests__/s3-backup-descriptor.test.ts | > S3 Backup Descriptor Verification & Tamper Detection > should detect and reject tampering when descriptor archiveSha256 differs  | Error: Command failed: pnpm exec tsx "/Users/abdullahzaher/vibress/scripts/s3-backup.mjs" --bucket " | INCORRECT_SERVICE_CONFIGURATION | PASS |
| packages/storage-s3/src/__tests__/s3-backup-restore.test.ts | > S3 Fail-Closed Backup & Full Object Restoration > should perform full round-trip backup & restore to isolated bucket with byte-f | Error: connect ECONNREFUSED 127.0.0.1:9000 | INCORRECT_SERVICE_CONFIGURATION | PASS |
| apps/admin/src/components/settings/__tests__/ImportExportCard.test.tsx | > Admin import and export scope > matches Settings search, describes native JSON, and retains job operations | TypeError: Cannot read properties of undefined (reading 'removeItem') | JSDOM_ENVIRONMENT | PASS |
| apps/admin/src/components/settings/__tests__/ImportExportCard.test.tsx | > Admin import and export scope > presents the same scope in Arabic | TypeError: Cannot read properties of undefined (reading 'removeItem') | JSDOM_ENVIRONMENT | PASS |

## Method

1. Parsed the original Vitest log and deduplicated FAIL lines by file + test.
2. Reproduced representative failures at baseline `e44477ca` against the same DB: `expected 503 to be 200` and `window.localStorage` undefined reproduced exactly.
3. Started declared disposable dependencies and used the declared supported Node runtime; no assertion or application code was weakened.
4. Reran the complete suite: 2733/2733 passed. Historical failures are preserved here, not rewritten.
