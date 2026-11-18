# M03-S03 — P05/R1 Security Remediation and IAM/DBA Handoff (Revised)

**Date:** 2026-11-18 Asia/Riyadh · **Decision: REQUEST CHANGES / NO-GO.** Owner P05/R1 policy APPROVED for AUTHOR and APPROVER only, [Issue #197 #6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436). P02 Policy A + P04 D1 2517ms remain restricted to development/disposable PG16 testing. Actor epoch and reapproval are NOT owner-approved.

## Evidence identities
| Asset | Exact source |
|---|---|
| Canonical #198 | b5cfc0687076c86a7450a8a785a072f6e63ad289; unchanged Draft |
| Policy A #203 | 1fb5e1600fd2300d7509ec998ff3b1fa1fff5078 |
| Old IAM race reproduction #206 | fb6e12203c3ca8e589419467369bf908e645c7cb |
| Owner P05 governance #207 | 2f3a6afde703c79b105bb6c6b48bd942f44a7173 |
| Rejected experimental row-lock CI | [#44234590759](https://github.com/AbdullahZaher/vibress/actions/runs/44234590759): 7 passed, 4 failed, 2 unhandled; no full-suite certification |
| Revised experimental operator | commit 871089fe032c45dbcdc40259a7ad244edc6be866, blob 292b6275769aec77b408e13c9432643007b627c4 |
| Revised disposable-only actor mutation trigger/tests | commit e636a54e5100359ee772bdebb47ffc9bd0a16515, test blob 8dc3b1601e75f98e1783b3611f81c1c977809bf2 |
| Migration 0059 / 0060 | Unchanged, no new grants |

## Why the original prototype was rejected

PostgreSQL SELECT FOR SHARE requires UPDATE privileges, contrary to the roster SELECT-only operator security contract. Do not grant UPDATE to operator. The initial experimental real-PG test exposed this, showing the value of independent execution rather than assuming an architecture proof.

## Current experiment (NOT approved production design)

After all target lock and authoritative catalog checks, the operator obtains per-actor transaction advisory locks in login order, then freshly validates both actors, then final Policy A clock_timestamp before DDL. A **SECURITY INVOKER, disposable-only BEFORE mutation trigger** on actor registry acquires the exact same keys for INSERT/UPDATE/DELETE, without operator UPDATE rights or migration 0059/0060 rewrites. R1 test scenarios are inverted to denial, plus real PostgreSQL wait barriers. **Any privileged actor mutation that does not honor the proposed key protocol bypasses this protection.** Adopting the trigger requires new reviewed additive migration and human IAM/DBA approval.

## Current release gate status

| Gate | Status |
|---|---|
| Owner P05/R1, Policy A, D1 | APPROVED policy/restricted tests only |
| Old-source IAM-RACE-01 | VERIFIED; current canonical violates R1 |
| First row-lock prototype | REJECTED — FAIL on real PG16 without actor UPDATE privilege |
| Revised actor advisory prototype | EXPERIMENTAL; exact-new-head CI results PENDING |
| E2 immutable instance/generation reapproval | RECOMMENDED; owner/human IAM/DBA approval PENDING |
| Global lock order, mixed actor+approval deadlocks | OPEN, real negative test and reviewed admin protocol required |
| D1 whole-op deadline and M | NOT INTEGRATED / NOT DETERMINABLE |
| SQLSTATE 55P03, IAM-WD-01, unknown COMMIT | OPEN / OPEN / RECOVERY INCOMPLETE |
| Human IAM & PostgreSQL DBA | PENDING / PENDING |
| Agent06 independent final, canonical #198 integration | PENDING / NOT AUTHORIZED |
| Merge / Production | BLOCKED / NO-GO |

## Separate specialist technical dispositions (role lenses, NOT independent human signatures)

**Agent05 IAM — REQUEST CHANGES:** cooperative actor-final fence is acceptable as an isolated design candidate, but owner-controlled actor writes must be enforced and E2 reapproval rules settled.  
**Agent02 DBA — REQUEST CHANGES:** mandatory actor writer participation, global lock inversions, deadlocks, and transaction outcome proofs are not certified.  
**Agent03 AppSec — REQUEST CHANGES:** actual first prototype failed because it needed forbidden UPDATE access; revised approach must pass hostile runtime, direct-mutation, old-approval replay and lost-COMMIT negative tests.

All three assessments were prepared in this coordinated AI-assisted work; no separately accountable human specialist or independent Agent06 has signed off.

## Human review requests

**IAM:** https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959197756 — review E1/E2/E3, actor instance/epoch/reapproval and actor mutation enforcement; provide identity/authority, exact SHA, findings/conditions and dated permalink.

**DBA:** https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526 — review real PG16 lock/trigger/privilege contract, admin deadlocks, clean migration replay, rollback/COMMIT uncertainty, D1 admission and M. Any privileged new DDL/migration remains separately gated.

## Risk, rollback and next action

**Risks:** old approval reuse after deactivate/reactivate, privileged direct DML bypassing cooperative advisory locks, deadlock 40P01 from actor+approval admin transaction, 55P03 misclassification, D1-PG06 and watchdog. No High/Critical risk waiver.  
**Containment:** only isolated branch #208 and disposable PG16 databases, no secrets, new operator grants, production SQL, canonical integration or merge.  
**Rollback:** revert source/CI docs, dispose owned test DBs. If COMMIT ACK uncertain, fence backend and reconcile trusted catalog/registry/journal; no blind DDL retry.  
**Next:** verify revised exact-head CI; test owner/admin lock inversions, propose E2 owner decision and separate migration, secure human IAM/DBA concurrence, then independent Agent06 review before canonical admission.

**Sources checked 2026-11-18:** https://www.postgresql.org/docs/16/ddl-priv.html ; https://www.postgresql.org/docs/16/functions-admin.html ; https://www.postgresql.org/docs/16/explicit-locking.html ; https://www.postgresql.org/docs/16/transaction-iso.html ; https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html .
