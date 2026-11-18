# M03-S03 — E2 Proposed Additive Migration, Authorization & Privilege Review

**Date:** 2026-11-18 Asia/Riyadh · **Approval state: NOT AUTHORIZED.** This report proposes a migration protocol but does NOT reserve a migration number, rewrite migrations 0059/0060, request actual role grants, or install anything outside disposable PostgreSQL 16 fixtures. No canonical integration.  
**Owner Policy A / D1 / P05/R1:** APPROVED for restricted disposable tests only; E2-A/B/C, mandatory reapproval, migration, runtime grants and human IAM/DBA signatures PENDING.  
**Source:** canonical #198 `b5cfc0687076c86a7450a8a785a072f6e63ad289`; prior experiment tested executable `e340e92154dde6d98cad441cddc87793dde4d756`, new Draft #209 from Draft #208 head `130bd9633c07a10368286dd9c0c8ecc8f11421b5`. No normative migration file introduced.

## 1. Experimental schema-only fixture

Disposable-only test SQL `tests/fixtures/m03-s03-e2-actor-generation-experimental.sql` executes *after* the unchanged 0059 and 0060 SQL inside each uniquely named localhost test database. It adds trusted actor UUID instance and monotonic generation, plus plan AUTHOR and approval AUTHOR/APPROVER immutable provenance. Additional `SECURITY INVOKER`, fixed search-path provenance/lifecycle triggers supply and reject generation metadata within the same DB transaction. They are **not a safe production migration without review**.

Relevant before/after schema proposal:

| Table | Additional fields (proposed) | Safety rule |
|---|---|---|
| `platform_schema_trusted_actors` | `actor_instance_id uuid NOT NULL DEFAULT gen_random_uuid()`, `actor_generation bigint NOT NULL DEFAULT 1 CHECK (>0)` | immutable actor instance, increment for every committed sensitive lifecycle transition, positive generation and nonreuse |
| `platform_schema_plans` | `author_actor_instance_id uuid NULL`, `author_actor_generation bigint NULL` | authenticated AUTHOR bound to exact generation at submission |
| `platform_schema_approvals` | `author_actor_instance_id uuid NULL`, `author_actor_generation bigint NULL`, `approver_actor_instance_id uuid NULL`, `approver_actor_generation bigint NULL` | independently approved, immutable generation binding; legacy NULL always invalid |
| Future lifecycle audit | proposed append-only signed actor transition register | distinguish deactivate/reactivate/re-register/principal reassignment and reconstruct effective authority |

## 2. Expand → Backfill → Validate → Contract

**Expand:** independent human-reviewed additive migration creates fields/constraints, lifecycle and provenance triggers in a least-privilege approved transaction. Evaluate locked table size/DDL concurrency in disposable rehearsal. Ensure functions use explicit `public.` references and safe `search_path=pg_catalog,pg_temp`. Revoke PUBLIC EXECUTE where required; no operator/runtime actor DML or lifecycle grants. DDL migration number and privilege changes must be **separately authorized**.

**Backfill:** assign new actor-instance IDs only after a genuine verified roster identity and owner provisioning audit, not by pretending it was the historic actor ID. DO NOT fabricate old approval generation provenance from current `active` rows. Treat all old plans and approvals with NULL E2 provenance as `LEGACY_UNATTESTED`, deny execution. Require a new independently approved plan and approval per owner policy once chosen.

**Validate:** clean replay from 0059→0060→candidate on a disposable PG16 database; compare exact schema objects (PK, FK, constraints, triggers, sequences, ACLs and default EXECUTE), human-readable `pg_catalog` snapshots and trust boundaries. Reproduce actor credential rotation, deactivation, reactivation, actor deletion/re-registration, approval replay, legacy NULL and privilege-misgrant attacks. Verify no role membership, `SET ROLE`, runtime grants or `pg_signal_backend` changes. Exercise rollback and check original journal/registry and payload rows unchanged.

**Contract:** only when owner selects E2 reapproval semantics and human IAM + DBA approve exact SHA, migration and grants, replace test-only triggers with an enforceable governed lifecycle gateway/ACL design. The trusted admin gateway must acquire installation/registry/approval/actor locks before any actor/approval row DML. Legacy 0060 `platform_schema_revoke_operation` UPDATE-before-advisory ordering must be reviewed and constrained for combined-admin calls; a row BEFORE trigger alone cannot impose global pre-mutation ordering. No migrations 0059/0060 rewrite.

## 3. Privilege review

| Role / principal | Existing lab privilege | Proposed additional privilege | Decision |
|---|---|---|---|
| Dedicated operator | SELECT actor/plan/approval/registry, narrow registry UPDATE & journal INSERT, own table ALTER | **NONE** | Preserve. `SELECT FOR SHARE` needs prohibited UPDATE, so use read-only advisory fence |
| Runtime role | application table DML only, no schema/roster DDL or actor lifecycle | **NONE** | Preserve |
| AUTHOR/APPROVER | authenticated SEC DEFINER 0060 entrypoints only as explicitly granted | **NONE by this experiment** | Actor identity is `session_user`, not SET ROLE |
| Governed administrator (future) | current owner/superuser DML trust root in disposable fixture | maybe dedicated narrowly scoped gateway EXECUTE, but **NOT APPROVED** | Requires independent IAM/DBA and owner decision, separate migration and tested grant/revoke |
| Database owner/superuser | can alter triggers/ACL/schema | impossible to fully constrain with ordinary ACL | Audit and governance controls, no claim of unbypassability |

**Security caution:** superuser/admin can bypass installed trigger protections, and function provenance captured while a SECURITY DEFINER call is executing requires session-user attribution, not a caller-controlled parameter. An explicit ADMIN gateway must be audited for SQL injection and fixed search_path; no generic, PUBLIC callable SECURITY DEFINER helper is acceptable. Existing actor roster 0060 trigger permits owner/superuser mutation only; retain that baseline.

## 4. Rehearsal and recovery checklist (PENDING unless source-pinned CI confirms)

- Replay two existing migrations and the experimental fixture against clean PG16.16 with pinned dependencies.
- Verify grants before and after installation with catalog/has_table_privilege and full role inheritance; no operator/runtime actor UPDATE.
- Assert approval/plan provenance immutability for unprivileged roles, generation bump and rollback correctness, UUID never repeats upon re-registration.
- Repeat simultaneous actor/approval administrative transactions with revised L1 ordering; prove known R1-10 wait cycle excluded *for governed calls*, verify 40P01 abort for legacy diagnostic, and fail closed for errors.
- Verify no data loss, registry manifest drift, duplicate journal or lost COMMIT classification; no blind migration retry on unknown COMMIT.
- Benchmark added advisory/epoch reads against approved D1 2517ms without restarting timer or inventing positive M. Recovery T15 remains separate.

## 5. Rollback / forward recovery

In current experiment, rollback is straightforward: revert branch code, drop only disposable test databases after verified teardown; no shared schema or production state touched. For eventual applied E2, **do not use destructive down-migration to erase actor history or revive stale approvals**. Instead fail closed, disable the operator, deploy forward remediation under authorization, retain actor-instance and generation evidence, use independently verified backup/PITR if data corrupted. A production rollback or schema DROP needs separate signed risk assessment and verified recovery and is not authorized here.

## 6. Human approvals / conditions

**Owner:** E2-A (fresh plan+approval), E2-B (fresh approval / validated plan), or E2-C (audited recovery) still requires explicit selection. Any migration/grant contract separately authorized.  
**Independent human IAM:** [review request](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959197756) — BLOCKED until attributable exact-SHA review of actor identity, reapproval, admin authority, role isolation and provenance.  
**Independent human PostgreSQL DBA:** [review request](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526) — BLOCKED until lock-order, migration replay, 40P01/55P03/57014, rollback and COMMIT uncertainty evidence.  
**Agent06:** future independent source examination after signed gates; NOT a release authority.

**Agent05 IAM / Agent02 DBA / Agent03 AppSec preliminary technical dispositions: REQUEST CHANGES** (distinct review lenses, not separately authenticated human signatures).

**Sources checked 2026-11-18:** [PG16 SQL privilege model](https://www.postgresql.org/docs/16/ddl-priv.html), [trigger behavior](https://www.postgresql.org/docs/16/trigger-definition.html), [explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
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
