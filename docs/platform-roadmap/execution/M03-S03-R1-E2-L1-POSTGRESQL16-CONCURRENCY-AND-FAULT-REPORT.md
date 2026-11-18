# PostgreSQL16 R1/E2/L1 concurrency and fault evidence boundary

> 2026-11-18 Asia/Riyadh. REVIEW-ONLY / NOT NORMATIVE. Source: PR #209 documentation HEAD `999246ce8a0379908be6d749cb3c1acd2330fa38`; verified tested executable `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`; tree `30fd302094db904ed537f1809c6b69e607312d00`. Canonical PR #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289` unchanged. No new PG16 test or independent human signature is claimed by this document.

## Historical verified PG16 evidence (NOT rerun in this stage)
[CI 44242532694](https://github.com/AbdullahZaher/vibress/actions/runs/44242532694) completed SUCCESS at executable SHA `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`: PostgreSQL 16.16 (server_version_num 160016), Node 24.22.3; focused 20 pass, full operator 67 pass, fault injection 21 pass, three independent Vitest processes each 10 pass on same hosted Runner; 138 test executions with overlap, **88 distinct full-suite definitions**. Verified CI log recorded blocking backends via `R1_10_BACKEND_TRACE` and disposable DB leak count zero. Original diagnostic intentionally throws 40P01; FIX/FIX2 cooperative cases passed. Documentation commit after this SHA modified only five Markdown files.

## New obligatory deterministic experiments (NOT EXECUTED)
| ID | Experiment / direct evidence required | Expected fail-closed result |
|---|---|---|
| L1-ADMIN-01 | Actor UPDATE before approval UPDATE, and reverse, both under proposed gateway | No known 40P01 cycle; atomic state |
| L1-ADMIN-02 | Actor/approval update with direct owner bypass / BEFORE trigger implicit tuple lock | Record counterexample and restrict ordinary entrypoint |
| L1-ADMIN-03 | Two actors opposite order, multiple approvals and installations | Sorted lock order or deny unsupported multi-installation |
| L1-PG-04 | Table/registry/plan tuple contention and external DDL | Bounded timeout; catalog unchanged or safe reconcile |
| E2-CONCUR-05 | AUTHOR/APPROVER generation transition COMMIT during target table wait | Deny before DDL |
| E2-ROLL-06 | Lifecycle change aborted before COMMIT | No authoritative generation advance |
| E2-REPLAY-07 | Old approval after reactivation or same-LOGIN new UUID | DENY, no journal |
| PG-FAULT-08 | Cancel, backend terminate, lost rollback ACK, lost COMMIT ACK, PG restart | Unknown commit => INDETERMINATE + fencing/reconcile |
| PG-FAULT-09 | Source privilege snapshot and action after failure | No unintended GRANT, no stale approval |
| PG-RESTORE-10 | Independent disposable backup and checked restore | Exact catalog, provenance and audit recovered |

Capture barriers, txn/PID/backend_start, actual SQLSTATE, pg_blocking_pids/pg_locks, before/after DB checksums, registry/journal, teardown counts and source SHA for EVERY scenario. Client disconnect or cancel request is not rollback acknowledgment. A 40P01 is a transaction failure; do not label a victim harmless without verifying rollback. No blind retry on uncertain DDL COMMIT. Never infer universal deadlock freedom from finite trials.

## Technical verdict
Known internal R1-10 cycle: **eliminated in previously tested cooperative FIX/FIX2 scenarios only**. Global L1, new migration, combined-fault D1 integration, human DBA/AG06 review: **NOT VERIFIED**. Agent02 disposition REQUEST CHANGES.

## References (checked 2026-11-18)
- https://github.com/AbdullahZaher/vibress/issues/197
- https://github.com/AbdullahZaher/vibress/pull/209
- https://github.com/AbdullahZaher/vibress/actions/runs/44242532694
- https://www.postgresql.org/docs/16/explicit-locking.html
- https://www.postgresql.org/docs/16/sql-altertable.html
- https://www.postgresql.org/docs/16/sql-createfunction.html
- https://www.postgresql.org/docs/16/ddl-priv.html
- https://www.postgresql.org/docs/16/trigger-definition.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
