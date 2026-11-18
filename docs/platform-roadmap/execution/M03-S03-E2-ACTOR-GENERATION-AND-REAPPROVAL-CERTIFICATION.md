# M03-S03 — E2 Actor Generation & Reactivation/Reapproval Architecture (EXPERIMENTAL)

**Date:** 2026-11-18 Asia/Riyadh · **Status: RECOMMENDED, NOT OWNER APPROVED, NOT HUMAN IAM/DBA CERTIFIED.**  
**Owner decision:** P05/R1 already APPROVED for AUTHOR and APPROVER ([#6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436)). E2, reapproval, additive migration and privileged gateway remain unapproved. **Canonical #198:** `b5cfc0687076c86a7450a8a785a072f6e63ad289` unchanged. **Baseline experimental #208:** `130bd9633c07a10368286dd9c0c8ecc8f11421b5` (tested executable `e340e92154dde6d98cad441cddc87793dde4d756`). New isolated [Draft #209](https://github.com/AbdullahZaher/vibress/pull/209).

## 1. E2 identity and lifecycle invariants

- Each trusted actor record has an immutable, randomly assigned `actor_instance_id` (UUID in disposable fixture) and `actor_generation` starting at 1, positive, monotonic within an actor instance.
- Committed deactivation, reactivation, principal replacement, kind reassignment, or login reassignment increments the generation in the *same transaction* as the actor update. A rollback also rolls back the generation increase; no post-hoc wall-clock comparisons establish validity.
- Account re-registration after deletion gets a new `actor_instance_id` even if the same LOGIN and principal text are reused; old plans/approvals cannot match the new instance.
- An immutable plan carries AUTHOR instance/generation; approval carries both the plan's AUTHOR generation and independently authenticated APPROVER instance/generation. The operator compares both against fresh current state under P05/R1 actor advisory locks at final authorization.
- NULL legacy provenance is denied, not silently bound to the current actor generation. Direct mutation of historical provenance by unprivileged users must be denied; a real owner/superuser is a separately monitored trust root.
- Only individually authenticated nonprivileged PostgreSQL LOGIN identities can act as AUTHOR or APPROVER. `session_user` is the basis for existing 0060 guards, not caller text or SET ROLE. Runtime operator does not obtain actor DML, lifecycle-function EXECUTE or extra grants.

## 2. Experimental implementation — not an accepted migration

`tests/fixtures/m03-s03-e2-actor-generation-experimental.sql` is loaded **only in newly created disposable PostgreSQL 16 test databases after unchanged migrations 0059 and 0060**. It adds:
1. `trusted_actors.actor_instance_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid()`, `actor_generation bigint NOT NULL DEFAULT 1 CHECK (>0)`.
2. `plans.author_actor_instance_id`, `plans.author_actor_generation`.
3. `approvals.author_actor_instance_id`, `approvals.author_actor_generation`, `approvals.approver_actor_instance_id`, `approvals.approver_actor_generation`.
4. `SECURITY INVOKER`, fixed-search-path lifecycle trigger with generation increment on approved actor changes and denial on manual generation or instance-ID rewrite. SQL fixture has no new operator/runtime actor grants.
5. `SECURITY INVOKER` triggers that bind AUTHOR provenance when the plan is submitted and both AUTHOR/APPROVER provenance when independently approved, executing after original 0060 provenance guards.

The experimental TypeScript operator extends initial and final validation with exact actor instance and generation equality. The final validation remains after table locks and catalog verification and before Policy A final server `clock_timestamp()` check/DDL. The fixture's actor advisory writer trigger is the earlier #208 test-only mechanism; it is **not** installed in any shared/production installation.

**Trust boundary:** the fixture's administrative superuser can bypass/destroy triggers or replay grants; this model does not claim protection against a malicious database owner. A production design needs a separately reviewed authenticated admin gateway and explicit ACL/backup/restore/audit controls.

## 3. Owner reapproval options requiring an attributable decision

| Option | Behavioral contract | Security & migration implication |
|---|---|---|
| **E2-A — Mandatory fresh plan + fresh independent approval (RECOMMENDED)** | After a committed AUTHOR or APPROVER lifecycle invalidation, previous operation authorizations cannot be resurrected. Submit a new digest-bound plan and get a fresh approval tied to current actor instances/generations. | Strongest straightforward anti-replay rule; may require new plan digest / operation identifier and an approved operator reset procedure; no silent revalidation |
| **E2-B — Fresh approval, old plan may be reused if author provenance is still valid** | AUTHOR plan only reused if author instance/generation remains current; independent APPROVER generation must be renewed; reapproval cannot cross scope | Less churn but risks unclear plan immutability and approval renewal collisions; needs precise one-way revocation/journal rules |
| **E2-C — Restricted administrative recovery** | Exceptional restoration requires separate recorded, bounded authorization rather than resetting generations or quietly reusing old approval | Expensive auditing; dual-control and independent IAM/DBA review essential; no general break-glass function implied |

**Recommendation: E2-A** for the one-operation M03-S03 development/test constraint. Owner has **NOT selected A, B or C**, so tests of E2-A are explicit proposed-policy experiments only. The final policy decision must also specify whether an invalidated plan must be regenerated with a new operation ID/digest and the approver independence rule after account replacement; this is not decided by the fixture.

## 4. E2 adversarial matrix and observation requirements

| ID | Negative or allowed test | Expected |
|---|---|---|
| E2-01 | Approver deactivate/COMMIT/reactivate/COMMIT | Generation +2 and old approval DENY; no DDL/journal |
| E2-02 | Author deactivate/reactivate; try direct epoch increment | Old plan DENY; direct generation mutation 42501; no DDL |
| E2-03 | DELETE and re-register same approver LOGIN/principal | New UUID instance, old approval DENY |
| E2-04 | Corrupt E2 generation to legacy NULL using disposable owner | Operator DENY; no legacy auto-upgrade |
| Existing AUTH/SET ROLE | forged author/approver or scope reuse attempts | Deny by existing 0060 and new generation validation |
| Actor UPDATE rolled back | Actor active and generation unchanged after ROLLBACK | Existing authenticated operation remains valid if other policies pass |
| Concurrent COMMIT and advisory waits | P05/R1 final serialization independent of E2 | Only committed-before-final invalidates |
| D1 cumulative / COMMIT ACK lost | Not implemented in prototype | Do not claim D1 or recovery certification |

**Caveat:** fixture trigger ordering and fail-closed behavior are subject to exact-SHA real PostgreSQL CI and independent verification. Timeouts and lock-order changes may alter D1 remaining budget, which Agent04 must quantitatively assess before canonical admission.

## 5. Lifecycle state machine (proposed, not normative)

```text
NEW(actor_instance_id=UUID1,generation=1,active=true)
   -> PLAN(AUTHOR UUID1/G1) -> APPROVAL(APPROVER UUID2/G1)
   -> DEACTIVATE COMMIT(actor generation=2,active=false)
   -> old plan/approval now mismatched and permanently unusable under E2-A
   -> REACTIVATE COMMIT(actor generation=3,active=true)
   -> new PLAN + independent APPROVAL required; old G1 never restored
   -> DELETE/RE-REGISTER yields UUID3/G1, not UUID1/G1
ROLLBACK of any lifecycle update: no authoritative generation change
```

## 6. Owner/independent approval gates and residual risk

**IAM technical lens:** REQUEST CHANGES until owner selects E2-A/B/C and human IAM validates immutable actor provenance with security-negative tests. **DBA technical lens:** REQUEST CHANGES until database schema/replay, privilege diff, trigger write order and lock proof are independently accepted. **AppSec technical lens:** REQUEST CHANGES until old-approval replay/identity substitution, shared-login and owner-direct-mutation bypasses have evidence. No individual agent here substitutes for separately accountable human IAM/DBA or independent Agent06.

**Human IAM review:** [Issue #197 existing request](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959197756). **Human DBA review:** [Issue #197 existing request](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526). **Owner decision requested:** E2-A/B/C plus any specific migration/privilege contract, *not* R1 again.

**Rollback:** test branch reversion, drop only disposable test databases. For an eventually approved additive migration, retain generation history and disable operations until reapproved; never implement automatic rollback by erasing invalidation metadata.

**Research checked 2026-11-18:** [PG16 triggers](https://www.postgresql.org/docs/16/trigger-definition.html), [PG16 isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [PG16 explicit locks](https://www.postgresql.org/docs/16/explicit-locking.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
## Verified final experimental executable-SHA CI addendum — 2026-11-18

**This supersedes earlier PENDING / incomplete test notes in this report, but does not supersede the owner or human approval gates.** Tested executable commit: `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`, Git tree `30fd302094db904ed537f1809c6b69e607312d00`. [GitHub Actions run #44242532694](https://github.com/AbdullahZaher/vibress/actions/runs/44242532694): **COMPLETED SUCCESS**, all required workflow steps including clean teardown SUCCESS. Node v24.22.3, PostgreSQL 16.16 (`server_version_num=160016`). Verified pinned dependencies, TypeScript typecheck, ESLint and explicit-any checks PASS.

| Suite / runner execution | Observed |
|---|---|
| Focused `IAM-RACE-01|IAM-WD-01|P05/R1|R1-0|R1-10|E2-` | 20 PASS, 47 filter-skipped |
| Full operator suite (includes R1-10 original and R1-10-FIX/FIX2 plus E2 cases) | 67/67 PASS |
| Full fault-injection suite using same disposable actor/E2 fixtures | 21/21 PASS |
| Repeated independent Vitest processes with R1-10 and E2 tests | 3 separate process runs, each 10 PASS (57 filter-skipped) |
| Disposable PG16 fixture DB leak count | 0 |
| Owned Docker service/volumes teardown | PASS |

**Counting:** 138 successful test *executions* across these groups; the full suites contain **88 distinct test definitions** (67 operator + 21 fault). The 20 focused and 30 repeated executions overlap with full operator suite, therefore NOT 138 distinct cases. All three repetitions used fresh Vitest processes on one GitHub-hosted runner, not three independent runner machines. No statistical D1 guarantee follows. The run includes sanitized `R1_10_BACKEND_TRACE` of actual backend PID, backend_start, pg_blocking_pids, wait_event and `pg_locks` class/object identity. In the first run, backend 172 waited for advisory lock held by backend 170; it proves a real PG wait; the diagnostic R1-10 also induced PostgreSQL `40P01`. Corrected governed L1 cases passed on the supported fixture protocol; this does NOT imply universal deadlock absence.

**Gate disposition:** the corrected experimental R1-10 test scenario and E2 anti-replay regressions are VERIFIED for the exact executable snapshot only. **Global lock-order implementation is NOT accepted**: legacy privileged direct DML and human DBA/IAM authority remain unreviewed, fixture gateway not normative. **E2-A** fresh plan+independent approval remains a recommendation ONLY; owner has NOT selected E2-A/B/C. Human IAM PENDING; human PostgreSQL DBA PENDING; Agent06 exact integrated candidate review PENDING. Agent04 standalone timing certification PENDING. D1 2517ms cumulative supervisor and pre-COMMIT M NOT IMPLEMENTED / NOT DETERMINABLE; IAM-WD-01 and AG06-S03-10 OPEN; canonical PR #198 untouched and Draft. No risk accepted.

**Containment and rollback:** all schema alterations and `SECURITY INVOKER` gateway remain in owned disposable PG16 fixture SQL, with **zero new GRANT statements**, no changes to migrations 0059/0060, no runtime/operator privilege expansion. Reverse experimental branch changes or discard disposable fixtures. If a future COMMIT is uncertain, isolate/fence and reconcile via fresh trusted catalog/registry/journal; never infer rollback or blindly retry DDL.

**Research provenance checked 2026-11-18:** [PostgreSQL 16 explicit locks](https://www.postgresql.org/docs/16/explicit-locking.html), [PG16 transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [PG16 trigger definition](https://www.postgresql.org/docs/16/trigger-definition.html), [PG16 error codes](https://www.postgresql.org/docs/16/errcodes-appendix.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

**Exact next permitted step:** independent human IAM and DBA review with E2/reapproval owner policy decision and globally governed mutation lock ordering; require source-pinned new test+review for any modification, then independent Agent06 before any new canonical integration authorization. **REQUEST CHANGES; MERGE BLOCKED; PRODUCTION NO-GO.**
