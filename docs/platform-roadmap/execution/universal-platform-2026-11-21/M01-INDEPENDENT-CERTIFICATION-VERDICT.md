# M01 — Independent Certification Verdict (Agent 06)

**Auditor identity / independence.** Issued by the strictly independent Agent 06 auditor. I did not implement or remediate any M01 code or evidence under review, and my only permitted write is this verdict. All inspection was read-only. No production or CI service was contacted and no full DB-backed suite was run. Targeted non-DB suites were re-run from the committed source using the repository's committed config and a `/tmp`-only config; neither modified the repository (verified by `git status`).

## Exact identities

| Item | SHA / tree |
| --- | --- |
| M00 baseline candidate | `a6d33b9c3f976a4f182c40a5b7820d4643017661` / `cbb2e877d781d2ba8c958cf7ff40d7323fae1c7c` |
| **M01 candidate audited** | **`18fa2489257f751eeeb00282078610c3cf1ad374` / `86610e05fcbc1f39e24c878d1c85ace659506171`** |
| Branch | `m01-external-consumer-continuation` |

`git rev-parse HEAD` / `HEAD^{tree}` match the candidate; working tree was clean before and after verification; `git merge-base --is-ancestor a6d33b9c 18fa2489` returned 0. Delta = 2 commits (`6d328cf8`, `18fa2489`).

## Delta file inventory (`git diff --name-status a6d33b9c 18fa2489`)

20 files, 827 insertions / 39 deletions:

- Source: `packages/platform-kernel/src/identity.ts` (M), `index.ts` (M), `lifecycle.ts` (A), `packages/platform-kernel/src/__tests__/lifecycle.test.ts` (A)
- Tests/tooling: `tests/architecture/m01-external-consumer-negative.test.ts` (A), `scripts/platform/m01/installation-isolation-drill.sh` (A), `vitest.m01kernel.tmp.config.ts` (A)
- Ledger/evidence: `EPIC-EXECUTION-LEDGER.json` / `.md` (M), `M00-EVIDENCE-INDEX.json` (M), `scripts/platform/evidence/m00-evidence-index.mjs` (M), `REPOSITORY-INVENTORY.json` / `.md` (M), `WAVE-01-M00-M02.md` (M)
- New M01 docs: `M01-ENGINEERING-IMPLEMENTATION-REPORT.md`, `M01-EXTERNAL-APPLICATION-LIFECYCLE-TEST-MATRIX.md`, `M01-EXTERNAL-CONSUMER-CERTIFICATION.md`, `M01-FINAL-MILESTONE-VERIFICATION.md`, `M01-INDEPENDENT-CERTIFICATION-HANDOFF.md`, `M01-REGISTRY-AND-IDENTITY-SECURITY-REPORT.md`

## Verification results

- **Ten M01 Epics (E01–E10):** all are present in the ledger and `WAVE-01-M00-M02.md`. None is formally closed, none is claimed generally available. Engineering statuses are restricted: E01/E02/E03/E06/E09/E10 `IMPLEMENTED_RESTRICTED`; E04/E05/E07/E08 `IN_PROGRESS`. The final verification doc's 10-Epic matrix is consistent with this, except for the evidence contradictions in F-1.
- **Lifecycle CAS / fail-closed (source read):** `lifecycle.ts` enforces an explicit transition table, `expectedRevision === revision` compare-and-swap, application/installation identity binding, `INVALID_EVIDENCE` on non-sha256 manifest digests and empty schema revisions, mandatory new digest/revision on `upgrade`, frozen records, and a terminal `REMOVED` state with no outgoing transitions. Exceptions are typed via `ApplicationLifecycleError`. No hidden bypass found.
- **`pub_default` refusal (source read):** `parseIdentifier` rejects the legacy fallback for every platform identity, including new `WorkspaceId`; only `asPublicationId` (CMS compatibility adapter) accepts it. Matches the original gate "No app/tenant identity may be derived from a client-controlled publication fallback."
- **External consumer / boundary negatives:** `m01-external-consumer-negative.test.ts` accepts only `@vibress/platform-kernel` in the canonical fixture and refuses private workspace paths, `@vibress/database`, `@vibress/config`, direct Fastify and relative sibling imports.
- **Independently re-run (non-DB only):** kernel suite `3 files / 24 tests passed` (kernel 12 + manifest 5 + lifecycle 7); negative consumer fixtures `1 file / 7 tests passed`. No repository files changed by these runs.
- **Doc claims not independently reproduced:** full suite `381 files / 2748 tests, exit 0`, A/B isolation drill `7/7 exit 0`, packed consumer `5/5` — these are evidence-doc assertions only; no raw M01 log or drill output is committed, and I did not run the DB-backed suite or Docker drill (see F-2).
- **Isolation drill design (source read):** gated by `VIBRESS_M01_DRILL_CONFIRM=1`, disposable uniquely named PG16/Redis containers, non-superuser roles, schema-scoped secrets, cross-schema `permission denied` check, Redis DB cross-read checks, and an EXIT cleanup trap. It is explicitly bounded to nonproduction authorization denial; it does not claim OS process, S3 IAM, backup isolation, or production hosting.
- **No forbidden activation:** delta contains no `*.sql`, migration, grant/revoke, `package.json`, CI workflow, hosting config, capability-matrix or SDK-compatibility change. No package was published; packages remain private (unchanged). M04 Batch 03, generated REST/Admin runtime and production hosting remain unauthorized.
- **Ledger / evidence verifier:** 140 Epics, `formallyClosed=true` = 0, no `FORMALLY_CLOSED` status, all M01 structured `independentReview` verdicts null, all 140 `ownerAuthorization.status = PENDING`. `verify-m00-evidence.mjs` exits 0 (17 artifacts / 7 suites / 6 negatives, 0 errors); independent SHA-256 recomputation of all 17 artifacts and 7 suites found zero mismatches; `verify-execution-traceability.mjs` passes.
- **Governance:** publication blocked on A2/G6, live OIDC/JWKS and RLS proof deferred to M02/M08; the handoff explicitly claims no verdict and no human approval; the M00 governance register (all PENDING, A02–A05 NOT OBTAINED) is unchanged.

## Findings

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| F-1 | **P2** | Internally contradictory milestone-end evidence. `M01-EXTERNAL-APPLICATION-LIFECYCLE-TEST-MATRIX.md` line 4 says "M01 milestone-end suite NOT RUN (wave gate pending)" and line 14 marks install/activate/upgrade as `NOT EVIDENCED` requiring an M05 gate, while `M01-FINAL-MILESTONE-VERIFICATION.md` lines 10–13 report the full 2748/2748 cycle, 24/24 kernel, 7/7 negatives and 7/7 drill as complete. The negative fixture even asserts the matrix still contains `NOT EVIDENCED`, so the contradiction is embedded in the pass condition. | Matrix lines 4, 14; final verification lines 10–13; `m01-external-consumer-negative.test.ts` lines 41–47. |
| F-2 | **P2** | No immutable raw evidence for the full suite or A/B drill. Unlike the M00 baseline (`M00-FINAL-UNIT-TEST-LOG.txt` + attestation), no M01 unit log or drill output is committed; 2748/2748, 7/7 drill and 5/5 packed-consumer results are narrative-only. I independently reproduced only the non-DB kernel (24/24) and negative-fixture (7/7) suites. | Delta file inventory; verification doc lines 10–14; `M01-REGISTRY-AND-IDENTITY-SECURITY-REPORT.md` lines 21–29. |
| F-3 | **P2** | No M01-specific CI run attributed to the candidate SHA. No M01 document cites an `actions/runs` URL; the evidence index still lists the six M00-era runs and the ledger's M01 Epics cite only `44935360022`. Original completion proof requires immutable PR+CI evidence. | grep of `M01-*.md`; evidence index `ciRunUrls`; ledger M01 `evidence.ciRunUrls`. |
| F-4 | **P3** | `M01-ENGINEERING-IMPLEMENTATION-REPORT.md` line 13 calls `lifecycle.test.ts` "8 positive/negative tests"; the file contains 7 `it` blocks. The 24/24 total is consistent with 7, so the prose count is the error. | `lifecycle.test.ts` lines 40–145; kernel 12 + manifest 5 + lifecycle 7 = 24. |

**P0/P1:** none. No security defect, no weakened assertion, no fabricated human approval, no Epic closure escalation, no migration/grant/hosting/publication change, and no evidence-digest mismatch.

## Scope limits and authority statement

This verdict certifies only the restricted engineering baseline of the M01 delta at `18fa2489` / `86610e05…`. It does not certify runtime hosting, production OIDC/RLS, OS-level or S3/backup isolation, a published SDK, general availability, or formal milestone closure. It does not re-run the full DB-backed suite or external CI. It grants **no** human approval, specialist sign-off, merge authorization into `main`, Project Owner/maintainer decision, or production release authorization. No Epic is closed; Production remains NO-GO and Risk Acceptance NONE.

## Verdict

**`M01_CONDITIONALLY_ACCEPTABLE`**

The M01 engineering implementation is sound at source level: CAS/evidence fail-closed semantics, `pub_default` refusal, dependency inversion and external-consumer negatives are genuine and the 24/24 kernel and 7/7 negative suites were independently reproduced. Acceptance is conditional on F-1 (reconcile the "NOT RUN / NOT EVIDENCED" matrix with the final verification record), F-2 (commit immutable M01 full-suite and drill logs), and F-3 (attribute a CI run to the M01 candidate SHA), with F-4 corrected at the next re-freeze. These are bounded evidence/accounting conditions; they do not indicate a functional or security regression in the reviewed code.
