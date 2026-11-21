# L1 — Global administrative lock protocol: design review, NOT certification

> 2026-11-18 Asia/Riyadh. REVIEW-ONLY / NOT NORMATIVE. Source: PR #209 documentation HEAD `999246ce8a0379908be6d749cb3c1acd2330fa38`; verified tested executable `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`; tree `30fd302094db904ed537f1809c6b69e607312d00`. Canonical PR #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289` unchanged. No new PG16 test or independent human signature is claimed by this document.

## Verified source facts
Migration 0060 defines `platform_schema_trusted_actor_registry_guard`, `platform_schema_approval_provenance_guard`, `platform_schema_submit_plan` and related SECURITY DEFINER functions. The approval guard obtains approval advisory A in its UPDATE/DELETE BEFORE-row trigger, which cannot undo earlier implicit UPDATE row acquisition. Disposable E2 fixture `s03_test_governed_deactivate_and_revoke` is SECURITY INVOKER and owner-only. Operator currently requests installation I, registry R, approval A, target table ACCESS EXCLUSIVE, actor X and final Policy A approval. The fixture's governed combined writer pre-locks approval row before A and actor X. This is tested choreography, not universal ACL enforcement.

## Writer/authority inventory (incomplete until live roles/catalog/scripts are inspected)
| Entry path | Current disposition | Required gate |
|---|---|---|
| Schema operator `executeApprovedAdditiveColumn` | GOVERNED experimental read path | Exact resource locks and D1 supervisory checks |
| E2 fixture `s03_test_governed_deactivate_and_revoke` | GOVERNED test-only | Never treat as approved production gateway |
| `platform_schema_trusted_actors` direct INSERT/UPDATE/DELETE by owner | TRUST ROOT / MUST RESTRICT ordinary access | Pre-mutation L1 gateway or independent DBA-run audited exception |
| Direct approval UPDATE/DELETE through 0060 | MUST BE RESTRICTED | No ordinary direct writer path; preflight approval row before A |
| `platform_schema_submit_plan` / approval/revocation SQL entrypoints | INCOMPLETE / UNKNOWN L1 compliance | Inspect EXECUTE ACL, caller identity, trigger and row/table locks |
| SECURITY DEFINER/INVOKER, provisioning, migrations, scripts, role memberships | UNKNOWN until exhaustive inventory | Review `pg_proc`, `pg_depend`, `pg_auth_members`, schema/table ACL and all executable call sites |
| Superuser, table owner, independent disaster recovery | TRUST ROOT (not constrained by normal GRANT) | Dedicated credentials, operational controls, audit and break-glass process |

## Graph and proposed supported lock-order rule
Original reproduced known cycle: operator holds **A** and awaits **X**; admin holds actor UPDATE tuple lock **R_actor**, takes **X**, then wants **A** via approval revocation => 40P01. PostgreSQL may acquire row tuple locks before BEFORE triggers; trigger-only X is insufficient.

For a **single installation and predeclared affected set**, proposed pre-mutation hierarchy: authenticate -> installation **I** -> registry **R** -> approval tuples `R_approval` in deterministic key order (only where writes require them) -> approval advisory keys **A** in deterministic order -> all actor advisory keys **X** in deterministic actor-instance/login order -> actor row DML locks **R_actor** -> authenticated mutations -> atomic COMMIT. For operator transactions, I/R/A/target-table wait and catalog verification precede X; ensure no governed admin acquires a reverse conflicting target/resource/table lock. PostgreSQL table-level `ROW EXCLUSIVE`/tuple/FK/index/trigger locks must be added to the proven graph rather than presumed subordinate. Cross-installation transactions are unsupported unless a separately verified total order covers all installations.

**Proof obligation:** given all participating transactions acquire the conflicting shared prefix and no participant holds a later-order lock before requesting an earlier one, the specific A<->X cycle cannot occur. This is a conditional proof only. Old direct DML, external DDL, table ownership and 0060 trigger SQL are counterexamples requiring containment or redesign. `SELECT FOR SHARE` on actor roster is NOT an approved bypass; it requires UPDATE privilege, which dedicated operator must not receive.

## Required direct SQL evidence, not yet produced for this stage
On disposable PG16, capture complete `pg_roles`, `pg_auth_members`, `relacl`, `proacl`, function owners, trigger order, dynamic SQL/CLI call sites, and grants BEFORE/AFTER. Negative test ungoverned actor DML and approval revocation from every non-trust-root role; demonstrate actual denial and no partial state. Reproduce R1-10 with live `pg_locks`/`pg_blocking_pids`; rerun corrected mixed-admin, opposite-order multi-actor, cancel, termination and rollback with deterministic barriers. New complete certification remains BLOCKED.

## Finding L1-01 (HIGH impact; exploitability privileged)
Administrative owner/direct DML can acquire actor tuple lock before advisory X and approval A, so compliant transaction ordering is not enforceable across all writers. Fix by owner-approved constrained administrative gateway with demonstrated ACL exclusivity and trusted-root safeguards; do not attempt to constrain a malicious superuser through grants. **Agent 02 review disposition: REQUEST CHANGES.**

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
