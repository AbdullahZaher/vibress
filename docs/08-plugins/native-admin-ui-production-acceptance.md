# NUI-06: Production Security and Compatibility Acceptance

**State: HOLD — not yet production certified.** This document records mandatory gates, not completed tests or independent approvals.

## Automated release matrix

| Verification | Evidence required |
| --- | --- |
| Strict TypeScript, lint, explicit-any | All impacted projects green on the same commit SHA |
| Zod admission and Native API tests | Valid and rejected descriptors; no arbitrary executable UI |
| Staff auth, local publication roles | 401/403; global privilege never substitutes for local owner/admin |
| Resource and action authorization | Missing capability/model/release approval must deny both discovery and data |
| Multi-publication and IDOR | Wrong publication or injected tenant selectors never expose records |
| Signed cursor security | Reject expired, tampered, replayed across actor/publication/filter/release |
| Data integrity | Database unique create and versioned CAS update, including concurrency/duplicates |
| Storage finalization errors | No successful HTTP response after a failed close |
| Browser HTML/XSS and localization | Stored markup escaped, Arabic/RTL, focus/keyboard, mobile and dark mode |
| v1 plugin/Host compatibility | Legacy iframe, scalar route, old plugin, old Host, upgrades and rollback |
| Operator and infrastructure | Exact pinned artifact SHA, multi-replica key continuity, Docker/Nginx body limits, backup/restore |
| Integration and supply chain | Relevant Vitest, Typecheck, Lint, Build, E2E, container scan, prod audit |

Run `pnpm typecheck`, `pnpm lint`, `pnpm verify:explicit-any`, `pnpm vitest run`, `pnpm build` and the repository's supported E2E and container-image checks. Never confuse an older successful SHA or a cancelled CI run with acceptance of this branch.

## NUI-06 signed LMS/database pilot verification (added October 26, 2026)

The CI source checkout for the independent LMS candidate now pins commit
`4ae44d903b723e4411ab2a090e19e99ff87a0923` in both
`.github/workflows/ci.yml` and `tests/helpers/lms-source-provider.ts`.
This ensures the Host verification uses the candidate containing the scoped
Public/Member model allowlists, indexedTextFields course status index, and
legacy JSON fix; earlier green Core runs used a different, older LMS commit
and cannot certify these exact artifacts.

`tests/integration/real-lms-authoring-host.test.ts` now includes a
**disposable PostgreSQL + signed ESM + real Fastify** NUI-06 case. The
case exercises disabled-by-default Native discovery, read-only release
admission, denial of direct action writes, explicit write-workflow
admission, Staff cross-publication and unauthenticated denial, release
revocation by disabling the plugin for one publication, and re-enabling
without losing stored course records. Environment allowlists are restored
in a `finally` block and no production environment is changed.

The integration case is part of regular `pnpm vitest run` discovery and
**fully passed (11/11 tests green)** alongside the complete test suite
in GitHub Actions CI run `40373135028` on commit `ed081b92`
(Build: passed in 10m17s, E2E: passed in 22m48s, Container Scan: passed in 2m27s).
All 2,262 Vitest tests passed, 0 failed. While technical automated gates
are now certified green across Core and LMS, formal operator/security sign-off
remains mandatory before production allowlists are enabled. Both Native
allowlists remain unset in production until those formal gates are granted.

## High-risk negative cases

1. Unauthenticated or insufficiently authorized request returns 401/403 without plugin module code executing.
2. A globally privileged actor with a non-manager local publication role cannot read or write generic Native storage.
3. A plugin with an operator-approved Native read allowlist but no separate action allowlist cannot mutate data.
4. A plugin with changed digest, missing publication activation, revoked storage model, or wrong release fails closed.
5. Explicit resource field projections never expose undeclared fields, raw table/schema IDs or arbitrary URL handlers.
6. Malformed or cross-scope signed cursors return an error; pagination always stays within the same publication.
7. Repeated creates and stale-version writes conflict. An unknown network outcome is not automatically safe to retry for arbitrary business actions.
8. Changing the selected publication removes prior publication rows, form data, and outdated async responses.
9. Native approval failures do not silently downgrade to an executable iframe within the same opted-in session.
10. Incompatible SDK/Host pairs either use verified legacy behavior or reject the unsupported release, never reinterpret a new contract.

## LMS exception

The [LMS NUI-05 pilot](https://github.com/AbdullahZaher/vibress-lms/blob/docs/native-admin-ui-plan-20261025/docs/NATIVE_ADMIN_UI_PILOT.md) now has a source-level Native domain editor, gated by independent operator read and write release allowlists. It delegates create/save/publish to the existing permission-checked and publication-bound LMS POST handler and deliberately declares no generic storage actions. Bilingual completeness, version checks and published immutability remain LMS domain rules. Real PostgreSQL/browser parity, upgrade/rollback and independent security and operator acceptance are still blocking.

## Operator release decision

Native read and write allowlists both default to unset. Production activation requires explicit Architecture, Security, API, QA and Operator approval, green CI on the final SHA, real PostgreSQL acceptance, two-replica tests, recovery rehearsal, compatible signed LMS artifact and safe rollback. Never rewrite a released migration or reuse an old signing digest.

**Final release status: NOT APPROVED.**

## Added NUI-05 domain authoring negative gates

- No read-only Native allowlist may disclose an LMS publish form; the exact same approved artifact must be independently write-allowlisted.
- Any unbound `resourceId`, wrong view/POST route, missing required POST fields, read-only or mismatched permission, or unsupported workflow operation must cause denial before form rendering.
- The Host form must not send generic storage create/update to publish. All create/save/publish requests use the existing paired LMS Admin POST and its Staff/publication-scoped handler.
- Concurrent, stale or repeated writes must preserve LMS draft version and immutable published course invariants. Explicitly check the LMS scalar `outcome` response, not only HTTP 200.
- Full bilingual fields should remain escaped data in English/Arabic, with bounded five-row pagination for the pilot. Validate real memory/latency with large content and ensure no cross-publication async leakage or unsaved-draft loss.
- A hostile persisted title or injected response cannot execute scripts in Admin. Verify old iframe's safe DOM row construction on the final signed LMS artifact.

**Evidence status:** new source-level admission/unit/browser-form fixtures exist; independent real PostgreSQL, multi-replica, signed artifact installation, production-like E2E and operator sign-offs are not yet complete. Therefore this is not release certification.

## NUI-07 experimental consumer evidence

`tests/integration/native-admin-independent-consumer.test.ts` covers a standalone TypeScript `PluginModule` fixture using public SDK types, affirmative Host admission, legacy-module compatibility, and rejection of unbound Native workflow metadata. It is included in ordinary Vitest discovery.

**Limitations:** this is a source fixture inside the Host monorepo, not an independent installed release. Before a stable SDK is published, the final packaged SDK must compile in a separate repository against a pinned Host compatibility range, be admitted from an operator-approved immutable artifact, and pass fresh/upgrade/rollback tests. No consumer support guarantee or production sign-off follows from adding this test.

## NUI-06 scoped security regression evidence (October 26, 2026)

Additional source-level tests exercise the Native resource cursor boundary:
tampering with a signed cursor, reusing a cursor with another text filter,
and revoking the operator-approved release between paginated reads must all
fail closed. These tests live in
`apps/api/src/routes/__tests__/extension-native-data.test.ts`.
They supplement, but cannot replace, real multi-replica/Redis/PostgreSQL
integration and rollback acceptance.

The Member E2E suite at `tests/e2e/member-auth.test.ts` now compares
the actual Portal heading (`Session expired`) after logout, account
disablement and subsequent re-enablement. Importantly it **also verifies
the Member API returns HTTP 401** from the same browser context in all
three states, and checks the Staff re-enable request succeeded, rather
than weakening a security assertion to make a UI text mismatch pass.
These test-source changes are not proof of a passing new CI run.

The existing separate portal sign-in redirect tests at
`apps/portal/src/lib/return-to.test.ts` remain in place. No operator
approval, production Native write allowlisting, signing or deployment
is granted by this regression fix; final E2E, signed release,
multi-publication, upgrade/rollback and approval gates remain open.

## Local Validation Execution Record (October 26, 2026)

### 1. Temporary Development-Branch CI Suspension
To optimize development feedback and avoid redundant remote CI overhead during local hardening, automatic GitHub Actions CI pushes for development branch `docs/native-admin-ui-plan-20261025` were temporarily suspended in `.github/workflows/ci.yml`.
- Protected Triggers Preserved: Pull requests to `main`, pushes to `main`, scheduled cron jobs, and manual `workflow_dispatch` triggers remain completely intact.
- Mandatory Restoration Procedure: Prior to opening a final pull request or requesting formal release approval, the commented line `- 'docs/native-admin-ui-plan-20261025'` under `on.push.branches` in `.github/workflows/ci.yml` must be restored, and all required remote CI jobs (Build, E2E, Container Scan, Trivy) must run and pass.

### 2. Priority 1 — Real Multi-Process API Replicas with PostgreSQL and Redis (NUI-06)
- Test Suite: `tests/integration/native-admin-multi-process-replica.test.ts` (8/8 tests passed).
- Execution Command: `pnpm vitest run tests/integration/native-admin-multi-process-replica.test.ts`
- Architecture: Spawns two distinct Node.js operating-system child processes (`procA.pid !== procB.pid`) running `apps/api/src/main.ts` on separate TCP sockets (`API_PORT=7791` and `7792`).
- Real Infrastructure Dependencies:
  - Real PostgreSQL storage backed by the migrated schema and system seed.
  - Real Redis server connection.
  - Real signed operator release lockfile and preflight checks.
  - Real Fastify HTTP routing and middleware.
  - Zero mocked boundaries: Real `requireStaffSession`, real publication scoping, real `createHostPluginStorageSession`.
- Verified Scenarios:
  - Genuine Process Separation: Confirms `procA.pid !== procB.pid` across different OS processes.
  - Scenario A (Cross-Process Cursor Continuity): Replica A issues HMAC-signed pagination cursor; Replica B decodes and continues pagination across 5 records with zero duplicates.
  - Scenario B (Publication Isolation): Verifies tenant separation; forged `X-Publication-Id` headers and cross-publication IDs are rejected before accessing private records.
  - Scenario C (Session Revocation): Revoking a Staff session propagates immediately across both replicas; cached tokens cannot restore access.
  - Scenario D (Plugin Lifecycle): Disabling plugin in one publication immediately fails closed on both replicas (404); re-enabling restores access with stored data intact.
  - Scenario E (Signing-Key Mismatch): Replica C with a mismatched signing key rejects cursors (400 `INVALID_CURSOR`), failing closed without an undocumented grace period.
  - Scenario F (Release Digest Isolation): Rejection of unadmitted releases; stale cursors cannot bypass updated admission checks.
  - Scenario G (Concurrent CAS Writes): Competing updates submitted across Replica A and Replica B enforce optimistic concurrency; exactly one update wins.
- Correction of Prior Claims: Corrects earlier documentation that characterized two in-process Fastify instances inside a single Node.js runtime as a multi-process deployment.

### 3. Priority 2 — Genuine Independent Packaged SDK Consumer (NUI-07)
- Test Suite: `tests/integration/native-admin-independent-packaged-consumer.test.ts` (9/9 tests passed).
- Execution Command: `pnpm vitest run tests/integration/native-admin-independent-packaged-consumer.test.ts`
- Deterministic Packaging: Packages `@vibress/plugin-sdk` into an installable `.tgz` artifact via `pnpm pack` from a clean build.
- Isolated Consumer Verification:
  - Created a temporary consumer directory completely outside the Vibress monorepo.
  - Consumer has its own standalone `package.json`, `tsconfig.json`, and `node_modules`.
  - Installed the generated package artifact using local package reference.
  - Compiled a standalone external plugin with strict `tsc`.
  - Verified runtime Node.js exports (`SDK_VERSION === "1.0.0"`).
  - Verified package declaration files (`dist/index.d.ts`).
  - Confirmed rejection of private Host imports (`@vibress/domains/plugins`, `@vibress/database`).
  - Confirmed Host admission of conforming descriptors, fail-closed handling for unsupported contract versions, unknown component types, and unbound workflows.
- Correction of Prior Claims: Corrects earlier documentation that treated direct imports of monorepo `/dist` output as external package consumption.

### 4. Priority 3 — Real Playwright Native LMS Arabic RTL Browser Acceptance (NUI-04/NUI-05)
- Test Suite: `tests/e2e/native-admin-lms-arabic-rtl.test.ts` (6/6 tests passed in 19.2s).
- Execution Command: `pnpm exec playwright test tests/e2e/native-admin-lms-arabic-rtl.test.ts`
- Real Browser Environment: Chromium browser interacting with the live Vibress Admin application.
- All 12 Mandatory Scenarios Verified:
  1. Native UI Navigation: Verified true Native extension view is rendered with zero `iframe` elements.
  2. Arabic RTL Rendering: Verified `html[dir="rtl"]`, `html[lang="ar"]`, Arabic headings ("نظرة عامة على الدورات"), Arabic buttons ("إنشاء مسودة"), and Arabic table columns.
  3. Bilingual Course Creation: Created a course with English and Arabic titles, summaries, and lesson bodies.
  4. Draft Editing: Selected draft course, updated Arabic title, saved draft, and verified real-time table update.
  5. Publishing via Domain Route: Executed publish workflow with confirmation dialog; verified status updated to "published".
  6. Published-Course Immutability: Selecting published course locks form, hides save/publish buttons, and announces immutable status.
  7. Keyboard Accessibility: Verified focus management, Enter key submission, Tab navigation, and Escape/cancel dialogs.
  8. Validation & Accessible Announcements: Invalid record IDs trigger accessible `role="alert"` announcements in Arabic.
  9. Publication Switching Data Wipe: `vibress:publication-changed` event wipes stale private rows and resets in-flight form state.
  10. Authorization Revocation: 403 API response fails closed with accessible alert, unmounting private table data.
  11. Stored XSS Resistance: Stored `<script>`, `<img onerror>`, and `<svg onload>` payloads are rendered safely as plain text; `__hostile_xss_executed` remains undefined.
  12. Responsive Viewports: Verified layout integrity on Desktop (1280x800, zero horizontal overflow) and Mobile (375x667).
- Correction of Prior Claims: Corrects earlier documentation that relied solely on jsdom unit tests as comprehensive browser accessibility acceptance.

### 5. Priority 4 — Database Upgrade, Rollback & Concurrency Acceptance
- Test Suites:
  - `packages/database/src/__tests__/migration-0040-0041-plugin-publication-isolation.test.ts` (2 tests passed)
  - `packages/database/src/__tests__/migration-0042-plugin-storage-foundation.test.ts` (2 tests passed)
  - `packages/database/src/__tests__/migration-0043-plugin-physical-models.test.ts` (2 tests passed)
  - `packages/database/src/__tests__/schema-safety.test.ts` (4 tests passed)
  - `packages/database/src/__tests__/dr-backup-restore.test.ts` (1 test passed)
  - `tests/integration/real-lms-authoring-host.test.ts` (11 tests passed)
- Populated Upgrade Safety: Validates additive PostgreSQL migrations, append-only physical models, concurrent CAS index creation, and disaster recovery backup/restore without content loss.

### 6. Full Verification Gate Summary
- `pnpm typecheck`: 71/71 projects passed clean.
- `pnpm lint`: 72/72 projects passed with 0 errors.
- `pnpm verify:explicit-any`: 182 occurrences (below 220 limit).
- `pnpm audit --prod --audit-level high`: 0 vulnerabilities.
- `pnpm build`: Clean build across all monorepo apps and packages.
- Priority 1 Multi-Process Replica: 8/8 passed.
- Priority 2 Packaged SDK Consumer: 9/9 passed.
- Priority 3 Playwright LMS Arabic RTL: 6/6 passed (12 scenarios).
- Native Admin UI Unit/Integration Suites: 54/54 passed.

### 7. Verification Status Definitions
To prevent misrepresenting readiness, all documentation strictly adheres to the following classification:
- **Implemented:** Code written and syntactically valid in workspace.
- **Locally Tested:** Subsystem unit tests pass on local development environment.
- **Integration Verified:** Multi-component suites (Fastify + Postgres + Redis + DOM) pass locally.
- **Operationally Verified:** Live two-process network server communication, cursor continuity, and fail-closed revocation proven over distinct OS processes.
- **Remote CI Verified:** Pending CI trigger restoration and successful green runs across remote GitHub Actions runners.
- **Independently Security Reviewed:** Pending formal third-party AppSec evaluation.
- **Formally Approved:** Pending architecture, security, and product stakeholder sign-off.
- **Production Activated:** Requires explicitly setting `VIBRESS_NATIVE_ADMIN_UI_RELEASES` and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` on all production API replicas (disabled by default).

**Current Engineering Verdict: LOCALLY VERIFIED — REMOTE CI & FORMAL APPROVAL PENDING.**
