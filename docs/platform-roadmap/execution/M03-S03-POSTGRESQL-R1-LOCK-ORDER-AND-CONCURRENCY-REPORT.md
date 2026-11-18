# M03-S03 — PostgreSQL R1 Lock Ordering & Concurrency Report (Revised)

**Date:** 2026-11-18 Asia/Riyadh · **Verdict: REQUEST CHANGES / NO DBA CERTIFICATION.**  
**Source:** canonical b5cfc0687076c86a7450a8a785a072f6e63ad289; Policy A 1fb5e1600fd2300d7509ec998ff3b1fa1fff5078; original IAM test fb6e12203c3ca8e589419467369bf908e645c7cb; revised experimental code 871089fe032c45dbcdc40259a7ad244edc6be866 and test e636a54e5100359ee772bdebb47ffc9bd0a16515. Migration 0059/0060 hashes unchanged.

## 1. Empirical privilege blocker and revised lock protocol

The initial experimental SELECT FOR SHARE actor-row strategy FAILED CI [#44234590759](https://github.com/AbdullahZaher/vibress/actions/runs/44234590759). PostgreSQL 16 requires UPDATE privilege on an actor roster column even for FOR SHARE; dedicated operator has SELECT only. Do not grant it UPDATE. [Official privileges](https://www.postgresql.org/docs/16/ddl-priv.html).

**Revised disposable-only prototype:**

| Actor/flow | Actual lock order |
|---|---|
| Operator | installation advisory → registry FOR UPDATE → approval advisory → initial actor SELECT → target ACCESS EXCLUSIVE → catalog/row count → **AUTHOR & APPROVER advisory xact locks sorted login** → fresh actor SELECT/revalidate each → Policy A clock_timestamp final authorization → one DDL → manifest CAS/journal → COMMIT |
| Privileged actor writer in disposable lab | Actor row UPDATE/INSERT/DELETE lock (as issued by PostgreSQL) → **test-only BEFORE trigger acquires per-actor advisory xact key** → COMMIT |
| Approval INSERT trigger 0060 | registry FOR SHARE → approval-key advisory → actor SELECT → plan FOR SHARE |
| Approval UPDATE trigger 0060 | approval-row DML lock → approval-key advisory → actor SELECT |

The actor trigger uses SECURITY INVOKER, fixed search_path and no new role grants; only fixture admin can modify actors under preexisting 0060 owner check. It is not present in migrations 0059/0060 and NOT approved for shared/prod databases.

## 2. R1 linearization argument and conditions

- If writer deactivation COMMITs while the operator waits for target-table lock, it released the actor advisory key; final operator lock/read sees committed inactive under READ COMMITTED and denies DDL.
- If writer has actor advisory key and an uncommitted update, operator waits. After writer COMMIT/ROLLBACK, actor read sees authoritative outcome; only committed inactive invalidates.
- If operator acquires actor advisory keys first, writer's trigger waits before its own COMMIT. The subsequent COMMIT is later than final authorization and R1 treats it as nonretroactive. This is NOT an excuse to ignore a committed earlier deactivation.
- Both actor keys must be acquired in a stable global order; the test-only trigger orders old/new login keys on a rename. Any privileged path bypassing writer trigger breaks this proof. No JavaScript time compares transaction authority.

## 3. Existing and new lock-order counterexamples

**Operator–privileged-admin cycle:** OP holds approval advisory A, needs actor advisory X. Admin holds actor update/advisory X, tries approval revocation needing A. The cycle OP→X, ADMIN→A is a possible PostgreSQL deadlock (40P01). Sorting AUTHOR/APPROVER keys inside operator doesn't eliminate this mixed-resource inversion. A future trusted admin lifecycle protocol must take locks in a globally reviewed order, including approval row and existing 0060 trigger interactions. Owner/superuser direct DML may bypass any cooperative protocol, so access governance and compensating detection are required.

**Two actor update orders:** Admin updates APPROVER then AUTHOR while operator acquires AUTHOR then APPROVER; a second transaction could wait in opposite order. Deterministic mixed-owner negative tests needed before stating deadlock freedom.

**Replay counterexample:** actor deactivation COMMIT then reactivation COMMIT before operator final actor locks; active=true revives original approval. Epoch- or permanent-reapproval design remains a separately unapproved contract.

## 4. PostgreSQL and D1 regression requirements

**Required:** R1-01/02 committed deactivation during real target wait, R1-06 nonretroactive post-final writer wait, R1-09 in-flight writer COMMIT/ROLLBACK, real 40P01/55P03/57014, actor+approval admin interleavings, scope/role negative tests, no physical DDL/registry/journal on denial, clean disposable fixture teardown.

Old operator still misclassifies SQLSTATE 55P03 as UNAUTHORIZED; this experiment does not fix AG06-S03-10. Existing per-statement 2000ms lock timeout is NOT the cumulative D1 2517ms budget. Pre-COMMIT M NOT DETERMINABLE; COMMIT unknown remains INDETERMINATE with no blind retry. Actor advisory waits add latency which must be measured in future exact-SHA D1 supervisor.

## 5. Status and decision

**Agent02 technical lens: REQUEST CHANGES.** The no-new-ACL advisory protocol has a plausible R1 ordering proof **only when the writer trigger is universally applied**, but owner-controlled DML bypass, admin deadlocks, epoch reuse, D1 and T15 recovery are unresolved. First-row-lock CI FAILED; revised exact-source CI is pending new verification. No independent human DBA or IAM signature. No canonical integration.

**Rollback:** revert experimental branch/teardown disposable test databases. Never rewrite 0059/0060 or grant actor UPDATE. For an unknown COMMIT result require fresh fenced reconciliation.

**Sources (2026-11-18):** https://www.postgresql.org/docs/16/ddl-priv.html ; https://www.postgresql.org/docs/16/functions-admin.html ; https://www.postgresql.org/docs/16/transaction-iso.html ; https://www.postgresql.org/docs/16/explicit-locking.html ; https://www.postgresql.org/docs/16/errcodes-appendix.html .
