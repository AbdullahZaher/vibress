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
