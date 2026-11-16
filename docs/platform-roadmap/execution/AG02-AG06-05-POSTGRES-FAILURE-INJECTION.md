# Agent 02 — AG06-05 Atomic PostgreSQL Failure-Injection Report

**Assessment date:** 2026-11-16; **base integration PR:** #176; **reviewed source SHA:** `b52ca3f4c0a740d7ff6b1ad784d9e3100b34e899`.  
**Status:** SOURCE-LEVEL REMEDIATED; **65/65 real PostgreSQL tests VERIFIED IN ISOLATED CI ON SOURCE SHA \`65dc13b38f3789da125e318af6e006ba8acffc23\`**; deployed production topology and R26 authorization remain BLOCKED. This is an AI-assisted assessment; Agent 06 and human DBA sign-off are not implied.  
**Author:** AI-assisted Agent 02 technical delegate, **not** human DBA signature or Agent 06 concurrence.

## Confirmed defects from code review

- **AG06-05-A, high assurance:** `provisionPlatformRolesAtomically` assumed a successful ROLLBACK after an unsuccessful COMMIT response meant safe rollback. The response could have been lost after the server committed. Caller might reuse a still-open ClientBase without reconciliation.
- **AG06-05-B, high assurance:** after ROLLBACK failure the original code threw `AggregateError` but did not close/destroy the connection; pool clients could be returned to circulation by the caller.
- **AG06-05-C, medium:** a failure at BEGIN wasn't inside the transaction state machine. An ambiguous BEGIN response could leave an open transaction while the caller reused the connection.
- **AG06-05-D, high:** final provisional role validation checked only five attributes, not `rolreplication`, `rolcanlogin`, inherited/SET-able memberships or pre-existing database-object ownership; pre-existing service roles might retain greater effective privileges.
- **AG06-05-E, medium test gap:** prior 10 checks measured role presence and one TRUNCATE privilege, but not loss of COMMIT acknowledgment, broken ROLLBACK, lost connection, pre-existing inherited grants, ownership, or advisory-lock hold/release behavior.

## Remediation under review

- Introduced `UnsafePlatformRoleProvisioningConnectionError` with `phase=begin|commit|rollback` and reconciliation-required marker; connection is tainted, destroyed via `PoolClient.release(true)` or `Client.end()`, and helper refuses reuse.
- No `ROLLBACK` attempt after uncertain COMMIT; failed COMMIT is never reported as rolled back.
- All BEGIN failures are handled fail-closed; verified ROLLBACK during pre-commit errors allows a controlled retry.
- Before COMMIT, abort if any of the roles has `rolreplication`, lacks LOGIN, holds membership (INHERIT/SET) or owns a database/schema/relation/routine.
- Added disposable-postgres-only failure injection comparing actual effective privileges and injected transaction outcomes with a second PostgreSQL client.
- Dedicated GitHub workflow requires PostgreSQL server_version_num 160016–169999 before migrations and tests. Job has no deployment secrets or production URL.

## Required case mapping

| Requirement | Test | Initial status |
| --- | --- | --- |
| Successful creation of three roles | original `commits a complete ...` | source observed; pending exact SHA run |
| Failure before provisioning | original `before creating ...`; new BEGIN-ack loss | **PASS on CI 43874307271**, disposal-only |
| Failure during runtime configuration | original `rejected runtime ...` | **PASS on CI 43874307271**, disposal-only |
| Failure during reader configuration | original `membership reader fails` | **PASS on CI 43874307271**, disposal-only |
| Failure during verifier configuration | original `verifier provisioning fails` | **PASS on CI 43874307271**, disposal-only |
| Existing ACL rollback | original TRUNCATE + new TRUNCATE/UPDATE/SCHEMA/FUNCTION + membership snapshot | **PASS on CI 43874307271**, disposal-only |
| Safe retry | original retry after confirmed rollback | **PASS on CI 43874307271**, disposal-only |
| Advisory lock/concurrency | original competing callers + new `pg_try_advisory_xact_lock` hold/release | **PASS on CI 43874307271**, disposal-only |
| Lost pre-COMMIT connection | new disconnect at after_validation | **PASS on CI 43874307271**, disposal-only |
| Unknown COMMIT outcome | new successful server COMMIT followed by lost client response; independent catalog proof | **PASS on CI 43874307271**, disposal-only |
| ROLLBACK failure | new injected ROLLBACK transport error; destructor and independent catalog proof | **PASS on CI 43874307271**, disposal-only |
| Privilege reconciliation | new effective ACL snapshots and independent observer role inventory | **PASS on CI 43874307271**, disposal-only |

## Remaining safeguards not certified

- A cooperative advisory lock does not block noncooperating DB sessions from granting privileges. Independent read-only inventory and role assertion remain necessary.
- This patch does **not** apply R26 0055, remove PUBLIC/default function privilege grants, or narrow the legacy CMS/worker role.
- ClientBase instances without a way to destroy a session are refused. All production call sites use real `pg.Client` or `PoolClient`.
- Connection reset and retained memberships must be independently verified on the **deployed** PostgreSQL roles, not just tests.
- Backups/restore, real worker/process identity, F-012 decision, Agent 03 and Agent 06 approval, R26 A/B owner authorizations remain BLOCKED.

## Independent reference and sources (checked 2026-11-16)

- PostgreSQL 16 advisory locks: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 role membership and SET options: https://www.postgresql.org/docs/16/role-membership.html
- PostgreSQL 16 release 16.16 (2026-11-12): https://www.postgresql.org/docs/16/release-16-16.html
- PostgreSQL privileges and defaults: https://www.postgresql.org/docs/16/ddl-priv.html
- PR #176: https://github.com/AbdullahZaher/vibress/pull/176


## Verified disposable PostgreSQL execution — exact source build

**Run:** https://github.com/AbdullahZaher/vibress/actions/runs/43874307271  
**Commit:** `65dc13b38f3789da125e318af6e006ba8acffc23`  
**Date/time:** 2026-11-16 UTC. **Environment:** isolated GitHub-hosted runner, Node 24, PostgreSQL `server_version_num=160016` (`16.16`), `compose.dev.yml` with Docker volume removed after tests.

From job 133323218079 logs: migrations success; changed-file ESLint success; atomic/R26 test group `22 passed / 0 failed` (18 atomic + 4 R26); real-role RLS/installation/view test group `43 passed / 0 failed` (24 tenant, 8 installation, 8 production topology, 3 R35); **total 65/65** in 6 files. Explicit `AG02_DISPOSABLE_PG_CONFIRMED=1` is set by the isolated workflow, not any production deployment. No skipped test is shown in the group summaries.

**Caveat:** the release-level CI for the integrated candidate remains separately required; Node/TypeScript full-workspace typecheck was not part of 43874307271 and is scheduled in the next exact-HEAD CI run. Operator production R26 Scope A/B, non-superuser owner transition, worker DB identity separation and restore remain BLOCKED.
