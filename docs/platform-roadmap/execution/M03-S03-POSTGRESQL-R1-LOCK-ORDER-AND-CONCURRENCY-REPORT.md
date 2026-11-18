# M03-S03 — PostgreSQL 16 P05/R1 Lock Order & Concurrency Report

**Date:** 2026-11-18 Asia/Riyadh. **Status:** EXPERIMENT ONLY / REQUEST CHANGES / NOT DBA-CERTIFIED. This is a role-based AI technical assessment, not an independently accountable human DBA signature.

**Sources:** canonical PR #198 b5cfc0687076c86a7450a8a785a072f6e63ad289; Policy A PR #203 1fb5e1600fd2300d7509ec998ff3b1fa1fff5078; IAM reproduction PR #206 fb6e12203c3ca8e589419467369bf908e645c7cb; experimental code+test checkpoint 2e4a75cc4c45672ceb1cf5c42c077f147d11ad28. Operator blob 9c587afca423320307a3f62f57f27e92a0dd4587; migration 0060 blob d8b1e50a0a4dd347fde235ae7cb1a12468249719. No migration or ACL changes.

## Actual transaction lock dependency graph

| Transaction | Ordered lock/resource steps |
|---|---|
| Operator | BEGIN READ COMMITTED → installation xact advisory → registry row FOR UPDATE → approval-key xact advisory → initial plan/approval/actor reads → target table ACCESS EXCLUSIVE → catalog/row checks → **experimental AUTHOR and APPROVER FOR SHARE rows, sorted by login** → Policy A clock_timestamp final check → ADD_FIELD → manifest CAS → journal → COMMIT |
| Approval INSERT via 0060 | Registry FOR SHARE → approval-key advisory → actor read → plan FOR SHARE |
| Approval UPDATE/DELETE via 0060 | PostgreSQL approval-row update lock → approval-key xact advisory → actor read |
| Privileged actor deactivation | Actor-row UPDATE lock → 0060 owner/role guard → COMMIT |

Actor-row sorting prevents opposing orders **between the two new actor locks**, but does not impose a complete cross-resource order over privileged admin transactions.

## Why the narrow R1 fix works in the stated races

**Deactivation COMMIT before final actor lock:** after waiting for target-table ACCESS EXCLUSIVE, operator's final SELECT FOR SHARE sees the new committed inactive row in READ COMMITTED and denies. No DDL should have happened.

**Deactivation UPDATE in progress:** SELECT FOR SHARE waits for conflicting updater; if admin commits inactive, updated row is returned and denies; if admin rolls back, old active value remains authoritative. No JavaScript timestamp establishes order.

**Operator acquires FOR SHARE before admin UPDATE:** the latter waits for operator transaction completion before COMMIT. If its COMMIT occurs after the final decision, P05/R1 explicitly makes it nonretroactive. Experimental R1-06 and R1-09 test these cases using actual pg_stat_activity wait-event barriers.

**Approval revocation:** existing 0060 approval advisory fence is still held by operator to COMMIT/ROLLBACK. Additional actor locks do not change approval timestamp semantics. Physical ADD_FIELD + registry CAS + journal remain in one transaction.

## Candidate comparison

| Candidate | Property | Limitation | Status |
|---|---|---|---|
| A: actor row FOR SHARE + final revalidation | Observes committed change, blocks subsequent update while valid | Reactivation can restore old approval; possible mixed admin deadlock | Narrow test-only implementation |
| B: actor-specific advisory xact key | Works when every update/reader obeys same key | Existing owner direct DML bypasses unless new trusted trigger/migration enforces protocol | NOT IMPLEMENTED |
| C: epoch only | Historical invalidation can be detected when epoch is bound | Concurrent update between check and DDL remains possible without lock | INSUFFICIENT ALONE |
| D: hybrid A + immutable instance/generation | Serializes update, denies prior-generation approval reuse | Requires separate E2 owner/human IAM/DBA decision and additive migration | RECOMMENDED FOR DESIGN REVIEW ONLY |

## Critical new lock-order counterexample — do not certify deadlock freedom

- OPERATOR holds approval advisory key A and needs actor-row lock X at final revalidation.
- PRIVILEGED ADMIN holds actor-row X by deactivation UPDATE and in the SAME transaction attempts approval revocation, which needs advisory A.
- This produces the wait-for cycle OPERATOR→X (ADMIN), ADMIN→A (OPERATOR).
- PostgreSQL can abort either transaction with SQLSTATE 40P01. If admin aborts, its deactivation was never committed; a later operator success can still respect R1. If operator aborts, no physical DDL/journal should commit.
- An owner/admin who mixes these mutations outside a reviewed lock order can also create other cycles. A deterministic test and explicit admin protocol/trigger design are mandatory before technical DBA approval. Do not assert that sorted actor locking solves global ordering.

## Other required negative and recovery tests

- Target-table wait followed by AUTHOR/APPROVER committed deactivation; post-final waiting update; uncommitted update then COMMIT/ROLLBACK.
- Actor deactivation concurrent with approval advisory wait, registry wait, simultaneous deactivation, R1 revocation and actor restoration.
- 40P01 deadlock victim, 55P03 lock timeout, 57014 query cancellation; verify rollback rather than infer it.
- Definite COMMIT versus lost ACK, backend termination/fencing and INDETERMINATE/no blind DDL retry.
- Proven same-order plan/actor/approval provenance, zero catalog/registry/journal drift and no changed effective privileges.

**Test status:** the old-source negative race has prior real PG evidence; experiment workflow is not certified as PASS until its exact last code/docs SHA completes. Distinct test definitions and repetitions must be recorded separately.

## D1, privileges, rollback and reviewer decision

Existing 2000ms PG lock_timeout, 10000ms statement timeout and 4000ms CLI connect timeout are not a 2517ms cumulative D1 supervisor. Extra actor row locks and two round trips are inside the future required T0 budget; no whole-operation supervisor or independently approved pre-COMMIT M is present. **D1 compliance NOT INTEGRATED.**

No changes to 0059/0060, PUBLIC/role grants, privileged watchdog, runtime DDL or production DB. Roll back only by reverting/closing this experimental branch; disposable fixture teardown is mandatory. A remote COMMIT of uncertain outcome cannot be reversed by marking timeout and requires fenced reconciliation.

**Agent02 PostgreSQL technical verdict: REQUEST CHANGES.** Narrow row-lock proof is plausible; deadlock-global-order and epoch reactivation safety remain unverified. Human DBA review PENDING; no release authorization.

**Primary sources reviewed 2026-11-18:** https://www.postgresql.org/docs/16/explicit-locking.html ; https://www.postgresql.org/docs/16/transaction-iso.html ; https://www.postgresql.org/docs/16/functions-admin.html ; https://www.postgresql.org/docs/16/errcodes-appendix.html ; https://www.postgresql.org/docs/release/16.16/ .