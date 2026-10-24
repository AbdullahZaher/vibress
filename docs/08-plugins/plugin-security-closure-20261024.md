# Plugin security remediation and production acceptance — 2026-10-24

**Scope:** `feat/plugin-platform-trust-catalog-20261024` only. This is a code/diff-based closure register, not a completed production certification. No LMS features were changed.

## Reviewed issues and disposition

| Finding | Code change | Acceptance evidence still required |
| --- | --- | --- |
| M-01 reviewed release replaced before registration | Operator-only catalog exposes an immutable `approvalId` for both signed v1 and legacy operator-pinned lockfiles; `POST /plugins/register-trusted` optionally pins `expectedReleaseId`. Domain verifies before any DB write; Host rechecks against signed approval at registration boundary | API tests for mismatch, concurrent lockfile change and wrong operator credentials; Docker immutable mount drill |
| M-02 catalog claimed installation readiness | Catalog exposes `readiness: verification_required`, not a verified status; actual ESM/Admin/evidence hashes and plans are checked immediately before registration; UI blocks older server responses missing the immutable approval identity | Performance/rate limit check for at most 64 artifacts and production bundle integration |
| M-03 file replacement during UI reads | Preflight and Host Admin HTML asset reads use bounded regular file descriptors with inode/size/digest checks; ESM evaluated from verified byte snapshot, not mutable path | Linux/Alpine symlink, parent-directory swap and concurrent-mount tests; enforce operator read-only mount and atomic release snapshots |
| M-04 claim of scanned supply chain | Strict operator admission requires operator-signed, SHA-pinned security review with zero High/Critical findings and exact artifact digest. Review is an **assertion**; the operator must run an independent scanner and retain original scan logs | Automate/offline verify genuine scanner output and review provenance/age; this is not yet cryptographically proved by the CMS |
| M-05 upgrade compatibility review | Catalog computes installed-versus-approved version/capability/metadata diff, requires explicit `acknowledgeUpgrade` for changed pinned updates, and preserves active-state deactivation requirement | Existing populated DB/Redis restore, migration dry-run and two-replica version/capability tests; same-version digest swaps are not a supported browser upgrade |
| M-06 lifecycle recovery mismatch | Admin separates retryable `error` from stuck `activating/deactivating`; retry is operator-only; maintenance recovery retains original quiescence/age protections | Keyboard/RTL/E2E tests and failure/retry/transition integration |
| M-07 stored site state versus runtime state | Additive `publicationConfiguredEnabled` is independent of effective `publicationEnabled`; inactive configured sites may be safely disabled, without enabling inactive plugins | Wrong-publication, unauthorized and reactivation-persistence integration tests |

## Blocking production gates

1. Run `pnpm install --frozen-lockfile`, scoped Vitest packages, `pnpm typecheck`, `pnpm lint` and relevant builds; diagnose failures rather than suppressing checks.
2. Run API auth/permissions and cross-publication integration tests; verify catalog read is operator-only, registration rejects stale digest/unauthorized Staff, and Host does not execute bytes on failed admission.
3. Build the actual Alpine API and Worker images; verify signed/unsigned legacy startup, strict policy missing/incorrect public-key and lockfile fingerprints, tampered artifact and evidence reports, and recovery maintenance.
4. Test fresh installation and upgrade of a database containing plugin settings, per-publication enablement, migration history and failed queued events; ensure rollbacks cannot silently undo a forward-only migration.
5. Review release diff, all dependent SDK/third-party theme contracts, Arabic/RTL, keyboard/focus and responsive states, observability and operator secrets. Confirm release snapshots are immutable across every replica.
6. Document separate ADR and implement **true process/container isolation** before accepting untrusted marketplace ZIP/GitHub plugins. Signed Node ESM always retains Host process privileges today.

## Backward compatibility

- Legacy operator-only `{manifestId}` registration requests still work, but modern Admin sends `expectedReleaseId` and cannot blindly approve an unpinned lockfile.
- Existing storage schemas, released DB migrations, user content and SDK manifest format are not changed by this remediation.
- Existing `publicationEnabled` means **effective execution**; the new `publicationConfiguredEnabled` is an additive, stored preference.
- Strict admission remains **opt-in** through `compose.plugins.strict.yml`, after the operator has staged and reviewed the new evidence. Do not silently migrate legacy installations.
- A `securityReview` file is operator-controlled evidence, not a substitute for an independent scanner or a sandbox.

**Decision:** security mitigations are implemented in code and tests were authored; remain NOT READY FOR PRODUCTION until the execution gates pass.
