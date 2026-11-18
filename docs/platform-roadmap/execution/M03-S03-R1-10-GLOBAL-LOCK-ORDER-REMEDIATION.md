# M03-S03 — R1-10 Global PostgreSQL Lock-Order Remediation (TEST-ONLY)

**Date:** 2026-11-18 Asia/Riyadh · **Disposition:** REQUEST CHANGES / NOT a normative approval.  
**Repository:** AbdullahZaher/vibress. **Canonical Draft #198:** `b5cfc0687076c86a7450a8a785a072f6e63ad289`, unchanged. **Original R1-10 test source:** `e340e92154dde6d98cad441cddc87793dde4d756`, PostgreSQL 16.16 [CI #44236955524](https://github.com/AbdullahZaher/vibress/actions/runs/44236955524) PASS as a **diagnostic reproduction of 40P01**, not a fix. **New experiment:** [Draft PR #209](https://github.com/AbdullahZaher/vibress/pull/209), built on Draft #208 HEAD `130bd9633c07a10368286dd9c0c8ecc8f11421b5`, executable source checkpoint `e1028a55aed59a43b969c21fd8f5a0f9f065831b` (CI pending). Owner P05/R1 approval [Issue #197](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436) is policy-only.

## 1. Root cause and original PostgreSQL wait-for graph

The original operator takes the approval-key transaction advisory lock **A** before the actor-key lock **X**. In a privileged combined administrative transaction, an actor UPDATE can acquire an implicit tuple UPDATE lock and, through the disposable actor trigger, the actor advisory **X**, then attempt approval revocation whose original 0060 approval trigger obtains **A** after the approval UPDATE has already targeted its row.

```text
A = approval-specific xact advisory lock
X = actor-specific xact advisory lock; R_actor = actor-row UPDATE tuple lock
R_approval = approval-row implicit UPDATE lock

Operator T_OP:  HOLD A -> WANT X
Admin    T_AD:  HOLD R_actor -> HOLD X -> WANT R_approval -> WANT A
Dependency:     T_OP -> T_AD (X)
                T_AD -> T_OP (A)    --> PostgreSQL 40P01
```

The [original R1-10 PostgreSQL 16.16 test](https://github.com/AbdullahZaher/vibress/actions/runs/44236955524) deterministically sets these dependencies on authenticated independent backends, observes a PostgreSQL lock wait, requires one SQLSTATE `40P01` victim, explicitly rolls back both transactions, verifies original column absent, checksum unchanged, registry digest unchanged and journal empty. The test does not establish which backend PostgreSQL will choose as victim; either is acceptable if rollback and physical integrity are verified. PostgreSQL implicit tuple locking occurs as part of UPDATE, not necessarily after a BEFORE trigger advisory lock.

## 2. Lock inventory and protocol

| Resource | Existing operator | Proposed governed admin | Residual bypass |
|---|---|---|---|
| Installation advisory **I** | first | **must acquire first** for the single supported installation | owner direct DML may omit |
| Registry row **R** | FOR UPDATE | reviewed FOR SHARE after I if needed | 0060 INSERT trigger has registry-before-approval; UPDATE trigger does not acquire registry |
| Approval advisory **A** | after R | **before any actor/approval DML** | existing `platform_schema_revoke_operation` performs UPDATE before trigger A |
| Target ACCESS EXCLUSIVE **T** | after A, before final actor locks | admin lifecycle does not access physical target | unrelated DDL may deadlock |
| Actor advisory **X1/X2** | sorted login, after T | sorted actor login, after A and before first DML | actor-row triggers cannot prevent implicit pre-trigger tuple lock on a noncooperating UPDATE |
| Actor tuple update **R_actor** | read-only operator has no UPDATE rights | acquired only AFTER I/R/A/X | privileged direct-DML bypass |
| Approval tuple update **R_approval** | operator read-only | acquired only AFTER I/R/A/X; original trigger reacquires A | direct revoker may hold row first |
| Plan/journal rows | reads / INSERT journal after DDL | ordinary admin need not access journal | separate review for new admin operations |

**Global reviewed design target for single-installation development/test scope:** operator `I → R → A → T → X(sorted) → FINAL_PRE_DDL → DDL → CAS → journal → COMMIT`; combined privileged admin `I → R (if applicable) → A → X(sorted) → actor/approval UPDATE → COMMIT`. All locks transaction-scoped. The ordering proof excludes the original two-backend cycle because the admin cannot hold X while waiting for A if it always takes A first; no intervening implicit actor/approval tuple lock is taken before acquiring A and X.

**Crucial limitation:** the present experiment proves the corrected order only for **the test-governed admin entrypoint**. The legacy 0060 revocation function and privileged raw DML do **not** universally enforce this ordering. They must be restricted through a separately authorized gateway / privilege audit, or the full system remains vulnerable to other cycles. This is not an approved new SECURITY DEFINER function, GRANT, trigger or migration.

## 3. Evaluated alternatives

| Alternative | Advantages | Known limitations / decision |
|---|---|---|
| **L1 — pre-mutation admin locks** | Smallest experiment; no added operator or runtime privilege; approval-first ordering prevents R1-10 for cooperating admin | Global enforcement of entrypoints, implicit row locks, mixed-operation gating required. **TESTED CANDIDATE, NOT RELEASE READY** |
| **L2 — controlled administrative lifecycle gateway** | Enforces I/R/A/X before any row DML and per-installation owner identity; can constrain who mutates lifecycle | Would require a new reviewed function/service, revoke ungoverned privileges, migration/ACL changes and human IAM+DBA authorization. **RECOMMENDED FUTURE ENFORCEMENT**, NOT IMPLEMENTED |
| **L3 — minimal additional advisory trigger** | Minimal code and old 0060 compatibility for simple actor-only transactions | BEFORE ROW triggers may run after tuple locks, and admin may hold X before A; original R1-10 remains. **REJECT as complete solution** |

## 4. R1 correctness and threat boundary

The operator still takes actor transaction advisory locks and revalidates AUTHOR/APPROVER active state after target-table/catalog waits and immediately before the final Policy A `clock_timestamp()` check. If a cooperative deactivation COMMITs before those locks, the subsequent READ COMMITTED actor query observes inactive; if the operator holds X first, the writer cannot COMMIT until after the authorized transaction ends. The original approval advisory remains held to COMMIT/ROLLBACK, and physical ADD_FIELD + manifest CAS + journal are atomic.

Privileged direct-DML, a disabled trigger, or extra administrative calls outside the approved ordering **can bypass this proof**. True superuser/owner is a governance trust root. A trigger alone is not a substitute for a controlled admin interface. Exactly one application installation is currently supported by the operator. Multiple-installation cross-actor key ordering is outside the approved workload and requires a distinct design review.

## 5. Test plan, failure classification, rollback

Test original `R1-10` intentionally reproduces `40P01`. Corrected `R1-10-FIX` uses separate PG sessions, verifies admin waits for approval **A** before actor UPDATE, then operator acquires X and commits first; admin obtains A then X, mutates actor and approval, COMMITs. Denied/aborted states must preserve catalog, seeded data, registry, journal. This tests the named cycle, **not universal deadlock freedom**. Additional matrix needed: approval-first and actor-first admin ordering, simultaneous actor changes, inherited role attacks, cancellation/rollback loss, commit uncertainty and D1.

Do not misclassify `40P01` as `UNAUTHORIZED`; existing `AG06-S03-10` remains OPEN. D1 cumulative 2517ms and pre-COMMIT M NOT integrated/approved; actor keys add time and must eventually be included in the monotonic budget. No D2.

**Rollback:** revert test branch/fixture; do not modify migrations 0059/0060 or grant runtime/operator UPDATE. Recover any unknown COMMIT through freshly authenticated fenced reconciliation, never a blind DDL retry.

**Agent02 PostgreSQL technical lens:** REQUEST CHANGES until corrected exact-SHA CI, global admin entrypoint enforcement and repeatable deadlock regression pass; independent human DBA signature pending.

**Research checked 2026-11-18:** [PG16 locking](https://www.postgresql.org/docs/16/explicit-locking.html), [PG16 pg_locks](https://www.postgresql.org/docs/16/view-pg-locks.html), [PG16 isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [PG16 triggers](https://www.postgresql.org/docs/16/trigger-definition.html), [PG16 advisory locks](https://www.postgresql.org/docs/16/functions-admin.html).