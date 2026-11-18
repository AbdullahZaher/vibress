# M03-S03 — R1-10 + E2 IAM / PostgreSQL DBA / AppSec Implementation Handoff

**Date:** 2026-11-18 Asia/Riyadh · **Final engineering decision: REQUEST CHANGES / NO-GO.**  
**Canonical:** [Draft #198](https://github.com/AbdullahZaher/vibress/pull/198) at `b5cfc0687076c86a7450a8a785a072f6e63ad289`, no integration or release authorization.  
**Governance:** Policy A FINAL_PRE_DDL, D1 2517ms restricted dev/disposable PG16, P05/R1 for AUTHOR+APPROVER [owner record](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436) approved. **E2 and its reapproval/migration/privileged admin design are NOT APPROVED.** Original R1-10 PG16.16 [CI #44236955524](https://github.com/AbdullahZaher/vibress/actions/runs/44236955524) reproduces 40P01 by design.

## 1. Isolated experiment / source provenance

**[Draft PR #209](https://github.com/AbdullahZaher/vibress/pull/209)** branches from Draft #208 documentation HEAD `130bd9633c07a10368286dd9c0c8ecc8f11421b5`. It is NOT canonical. First experimental E2 source additions:
- Disposable-only `tests/fixtures/m03-s03-e2-actor-generation-experimental.sql`: actor UUID+generation, immutable AUTHOR plan + APPROVER approval bindings and narrow SECURITY INVOKER triggers; no production migration number or role grant.
- Experimental operator initial and pre-DDL actor generation checks on the exact same authenticated author+approver instances.
- L1 test orchestration: approval-advisory A before actor X and row UPDATE, preserving existing operator approval-first order. Keep original deadlock reproducer as a hostile negative and add corrected supported-order test.
- E2-A negative tests reject old approval after actor deactivation/reactivation, re-registration with same LOGIN, generation tamper or legacy NULL provenance.
- Disposable PostgreSQL 16 CI workflow, pinned Node/pnpm, typecheck, ESLint, explicit-any, full operator and fault-injection suites, teardown/leak check.

**Not implemented or approved:** new GOVERNED admin lifecycle gateway, production approval revocation rewrite, privileges, source migration 0059/0060 edits, D1 supervisor, COMMIT admission M, watchdog, SQLSTATE repair, Agent06 certification. A successful corrected lab test does not validate ungoverned direct DBA DML or old 0060 revoker interactions with every privilege path.

## 2. Independent role-based technical recommendations

Each disposition below is a **distinct review lens** within this AI-assisted task. There are no separately authenticated human IAM/DBA approvals or independent Agent06 signatures.

**Agent 05 — IAM: REQUEST CHANGES.** Recommends E2 immutable actor instance and generation, with E2-A mandatory fresh plan+approval after author/approver lifecycle changes, and enforced authenticated lifecycle writer pathway. Approve technical design only after final policy choice and negative tests of old approval replay, actor re-registration, principal substitution and revocation.

**Agent 02 — PostgreSQL DBA: REQUEST CHANGES.** R1-10 original 40P01 proven. L1 pre-mutation lock ordering is plausible for supported fully governed paths but not globally enforced; 0060 approval-row UPDATE may acquire implicit locks before BEFORE trigger and may interact with actor mutations. Require exact PostgreSQL 16.16 CI, repeated deterministic concurrent tests, evidence of rollback and verified lock-order enforcement for all ordinary admin paths. The database owner/superuser remains audit trust root.

**Agent 03 — Adversarial AppSec: REQUEST CHANGES.** Threats: direct privileged DML bypass, reused LOGIN, stale generation/approval, inherited grants, SET ROLE, untrusted SECURITY DEFINER invocation, search_path injection, cross-installation approval reuse, unknown COMMIT, operator D1 late APPLIED, and SQLSTATE 55P03 mapped to UNAUTHORIZED. Require explicit negatives; no safe auto-retry on uncertainty and no role/grant expansion.

**Agent 04 — Deadline/SRE: REVIEW PENDING.** Need source-pinned latency of actor advisory locks, E2 authorization reads, administrative contention, and impact on 2517ms monotonic D1; no independent M or new SLO authorization.

**Agent 06 — Independent audit: PENDING.** Must inspect frozen source including privilege diff, migration, actor replay, deadlock remedy, CI and human approvals, then issue independent exact-SHA certification; cannot approve code it implemented.

## 3. Requested owner E2 decision (P05/R1 is already approved)

Select one **new** contract without reapproving R1:
- **E2-A (RECOMMENDED)** — invalidated author/approver approval cannot revive after reactivation; new immutable plan and independent approval bound to current actor instance/generation required. Clarify whether new operation ID/digest and plan supersession are mandatory.
- **E2-B** — old plan reusable only when AUTHOR instance and generation still valid; new independent approval under current APPROVER generation, with separately defined revocation/journal/reissue semantics.
- **E2-C** — exceptional recovery only through independently authorized, separately audited, non-generic privileged recovery procedure.

Owner approval must explicitly cover any normative additive migration, strict new admin lifecycle gateway/grants, scope, risk, tested backup, rollback and risk-acceptance expiry if applicable. No decision is inferred by this prototype.

## 4. Attributable human authority sign-off requests

**IAM authority:** [Existing Review Request](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959197756) — require genuine independent reviewer identity and authority basis, exact reviewed SHA, P05/R1 & E2 scope, provenance, actor lifecycle and approval replay tests, privilege audit, explicit conditions, date and permalink. **PENDING**.

**PostgreSQL DBA authority:** [Existing Review Request](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526) — require actual PG16 lock graph, 40P01 correction and rollback proof, migration replay, actor/approval trigger semantics, COMMIT uncertainty, D1 time budget, backup/recovery rehearsal, exact reviewed SHA and attributable signature. **PENDING**.

Acceptable dispositions are APPROVE, APPROVE WITH CONDITIONS, REJECT, BLOCKED. Conditions are not satisfied by a green workflow alone.

## 5. Release gate matrix (must update after exact-SHA test completion)

| Gate | Current disposition |
|---|---|
| Owner Policy A | APPROVED — restricted lab |
| Owner D1 = 2517ms | APPROVED — restricted lab; no D2 |
| Owner P05/R1 | APPROVED — policy only |
| Old R1-10 and actor race | VERIFIED on earlier source |
| Proposed corrected L1 admin protocol | EXPERIMENTAL — not globally enforced |
| E2 actor instance/generation | EXPERIMENTAL; owner decision PENDING |
| E2-A mandatory fresh plan/reapproval | PROPOSED, NOT APPROVED |
| Normative E2 migration, grants and admin gateway | NOT AUTHORIZED |
| Full exact-SHA PG16 verification | PENDING until latest run completes |
| D1 supervisor / pre-COMMIT M | NOT INTEGRATED / NOT DETERMINABLE |
| Human IAM / DBA approvals | PENDING / PENDING |
| Agent06 final independent | PENDING |
| Canonical integration / merge / production | BLOCKED / NOT AUTHORIZED / NO-GO |

## 6. Containment and rollback

All code remains Draft, test-only and disposable. Test fixture DDL is applied only after validating loopback PostgreSQL 16 and cluster-owner role in uniquely generated development databases. CI must prove zero fixture database leaks and tear down only the owned Docker service. No production/shared DB access, new actor role grants, privileged watchdog, migrations 0059/0060 rewrite, canonical #198 change or main merge.

**Rollback:** close/revert Draft #209; drop/dispose test databases only. For an actual future unknown COMMIT, quarantine the connection/backend and reconcile via fresh trusted catalog/registry/journal; never infer rollback from a lost acknowledgment or repeat DDL blindly.

**Explicit next action:** finish exact-SHA PostgreSQL 16 proof of L1/E2, document code and ACL diffs, independently review combined-admin bypass, request owner E2-A/B/C and human IAM/DBA approvals, then invite Agent06 exact-SHA independent review. No canonical work before gates.

**Research checked 2026-11-18:** [PostgreSQL 16 row locking](https://www.postgresql.org/docs/16/explicit-locking.html), [PostgreSQL 16 transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [PostgreSQL 16 trigger behavior](https://www.postgresql.org/docs/16/trigger-definition.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).