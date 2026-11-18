# M03-S03 P05/R1 — Trusted-Actor Revocation Linearization: Experimental Certification Record

**Date:** 2026-11-18 (Asia/Riyadh) · **Status: EXPERIMENTAL / REQUEST CHANGES / NOT CERTIFIED FOR INTEGRATION.**  
**Owner decision:** P05/R1 [Issue #197 #6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436), policy only. P02 Policy A FINAL_PRE_DDL and P04 D1 2517ms restricted disposable test still apply.  
**Canonical #198:** \`b5cfc0687076c86a7450a8a785a072f6e63ad289\`, UNCHANGED.  
**Source #203:** \`1fb5e1600fd2300d7509ec998ff3b1fa1fff5078\` (Policy A docs HEAD, operator blob \`31b1e862f594434944fec516f768265baf794525\`).  
**Original reproduction branch #206:** \`fb6e12203c3ca8e589419467369bf908e645c7cb\`.  
**Experimental code+test+workflow checkpoint:** \`2e4a75cc4c45672ceb1cf5c42c077f147d11ad28\` (operator blob \`9c587afca423320307a3f62f57f27e92a0dd4587\`, test blob \`37a2b5f0534a6b491801b4b5512b400f0de01b18\`). Later documentation commits must be separately pinned.  
**Actual PostgreSQL 16 test result:** pending workflow execution on the exact checkpoint; do not infer PASS from earlier code. No new tested epoch schema exists.

## Exact authorization source inventory

- \`packages/database/migrations/0059_platform_schema_execution_registry.sql\`: plan, registry, approval and completed journal metadata; no actor epoch.
- \`packages/database/migrations/0060_platform_schema_authenticated_approvals.sql\`: \`platform_schema_trusted_actors(login_name, principal_id, actor_kind, identity_mode, active, registered_at)\`; protected owner-only provisioning trigger, approval-key transaction advisory trigger, session_user provenance and revoke audit; **no actor-generation / actor UPDATE serialization with operator**. Blob \`d8b1e50a0a4dd347fde235ae7cb1a12468249719\`.
- \`packages/database/src/platform-schema-migration-operator.ts\`: initial actor roster SELECT BEFORE target ACCESS EXCLUSIVE; original final Policy A SELECT only rechecks approval timestamps/revocation. Exact root cause: a committed privileged actor UPDATE during target relation wait is not observed at final decision.
- \`packages/database/src/schema-operator-cli.ts\`: isolated disposable-only operator, not an integrated whole-operation D1 supervisor.
- \`tests/integration/platform-schema-migration-operator.test.ts\`: prior actual PostgreSQL negative cases IAM-RACE-01A/B documented old \`APPLIED\` after committed actor deactivation.

## Current vs proposed timeline

Old: installation transaction advisory lock → registry FOR UPDATE → approval advisory lock → approval/roster snapshot → WAIT target ACCESS EXCLUSIVE → catalog → final approval-only SELECT clock_timestamp → DDL → manifest CAS/journal → COMMIT.

Experimental: same original sequence, but after target lock and catalog/post-row-count, **acquire individual actor rows SELECT ... FOR SHARE** in lexicographic login order, verify exact AUTHOR and APPROVER login/principal/kind/identity_mode/active, hold row locks to transaction end → final Policy A fresh clock_timestamp() → DDL without new external wait → registry/journal/COMMIT.

## R1 linearization argument (bounded, not a complete lifecycle proof)

1. Actor UPDATE has the normal PostgreSQL UPDATE row lock; \`FOR SHARE\` conflicts with it. If UPDATE committed while operator waited for target table, final actor locking reads the committed inactive row and denies.
2. If actor UPDATE is still in-flight when final actor lock is requested, operator waits; under READ COMMITTED a locked row is rechecked after the writer commits or rolls back. Committed inactive denies; rolled-back deactivation is not authoritative.
3. If operator acquired actor FOR SHARE first, a subsequent privileged UPDATE cannot acquire the conflicting row lock and COMMIT until operator ends its transaction. Even if requested before the final decision, its **COMMIT** is after the decision, so owner P05/R1 makes the operation nonretroactively valid.
4. The final PostgreSQL server-time Policy A check still occurs after the new blocking lock requests and immediately before DDL; no new blocking stage is inserted after final authorization.
5. Neither the JavaScript wall clock nor a plain re-SELECT defines R1 order. Actual PostgreSQL row-lock conflict and transaction completion provide the partial serialization. D1 time remains independent and is **not implemented** in this experiment.

**Known counterexample:** privileged deactivation COMMIT → reactivation COMMIT → final row check sees active=true and a preexisting approval can be reused. P05/R1 policy covers committed deactivation, but the owner has NOT selected reactivation/epoch semantics. Therefore this prototype closes the named table-wait race only; a **full lifecycle-safe R1 contract remains BLOCKED**.

## Test evidence and status

| ID | New intended assertion | Evidence status |
|---|---|---|
| R1-01, R1-02 | AUTHOR and APPROVER deactivation COMMIT during real ACCESS EXCLUSIVE wait ⇒ no DDL, registry/journal untouched | Previous source proved old bug; new checkpoint CI pending |
| R1-06 | Deactivation queued strictly after final actor locking waits, operator can commit first | New real-PG barrier test added; CI pending |
| R1-09 | Actor UPDATE uncommitted during final lock; COMMIT inactive ⇒ deny | New real-PG barrier test added; CI pending |
| IAM-RACE-01G | Concurrent actor deactivation + approval revocation preserves rejection and audit | Previous source expected success; new expected rejection added; CI pending |
| IAM-RACE-01E | Deactivate+reactivate exposes stale approval reuse | Expected residual flaw, NOT an accepted behavior |
| Deadlock, D1-PG06, lost ACK | Required before future certification | Not closed by actor-lock experiment |

No code is in canonical #198; no migration 0059/0060 rewrite, new privilege grant or production database access.

## Technical decisions (separate role-based assessments, not 3 independently authenticated reviewers)

- **Agent05 / IAM lens: REQUEST CHANGES.** FOR SHARE+final identity validation is a plausible minimum short-race repair; epoch/reapproval binding still missing.
- **Agent02 / PostgreSQL lens: REQUEST CHANGES.** READ COMMITTED lock argument is defensible but an admin transaction that holds an actor UPDATE lock then seeks the approval advisory fence can deadlock against an operator holding the fence then seeking the actor lock. Must measure/test and resolve governance of mixed admin transactions.
- **Agent03 / adversarial lens: REQUEST CHANGES.** Stale approval replay via actor reactivation, account replacement, privileged direct mutation and SQLSTATE 55P03 error misclassification remain unresolved. No security acceptance.

**Human IAM: PENDING. Human DBA: PENDING. Agent06 independent final: PENDING.**

## Risk, rollback and next permitted action

**Risk:** unauthorized reactivation replay (open), lock inversion/deadlock (open), lost COMMIT and D1 false success (outside experiment), privilege-bearing operator credential (existing). No Critical/High risk accepted.  
**Rollback:** close/revert experimental Draft PR; its mutations are source/test/CI only, in disposable PG16; no production schema/grant state to roll back. All fixtures create uniquely named localhost test databases and tear them down.  
**Next:** evaluate actor lifecycle E1/E2/E3, run exact experimental CI/fault tests and resolve any failures, commission named independent IAM and DBA reviews of epoch/migration and global lock order. Do not merge.

## Sources inspected 2026-11-18
- [PostgreSQL 16 explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html) and [READ COMMITTED](https://www.postgresql.org/docs/16/transaction-iso.html).
- [PostgreSQL 16 SQL SELECT and locking clause](https://www.postgresql.org/docs/16/sql-select.html), [advisory functions](https://www.postgresql.org/docs/16/functions-admin.html).
- [PostgreSQL 16.16 release dated 2026-11-12](https://www.postgresql.org/docs/release/16.16/).
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
