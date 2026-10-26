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
