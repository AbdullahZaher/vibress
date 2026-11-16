# R35 — INTEGRATED APPSEC ENFORCEMENT VERIFICATION

> **Date:** 2026-11-16 · PR #176 source `fdcc3986b0b5be26ee57540e55b213f1ddb4cc79` · Reviewer: Agent 03 (AI-assisted) · **Verdict: PARTIAL, NOT FULLY CERTIFIED**.

## Exact enforcement observed

1. [Runtime privilege contract](../../../packages/database/src/platform-runtime-privilege-contract.ts) rejects both `materialized_view` and `foreign_table` synchronously before any SQL. This is the reviewed #171 change imported into #176. `tests/architecture/platform-runtime-contract-relation-kinds.test.ts` has 4 positive/negative cases. Actual CI for **this AppSec final branch** is pending.
2. For **declared ordinary views**, [runtime boot assertions](../../../packages/database/src/platform-runtime-role.ts) query PostgreSQL `pg_class.reloptions` and reject a view missing `security_invoker=true` with `view_not_security_invoker`.
3. Existing [PostgreSQL R35 integration test](../../../tests/integration/platform-view-surface.test.ts) contains 3 real-DB cases on a disposable role/view: materialized view reject; demonstrable non-invoker view leakage on the superuser-owned *test* fixture and boot reject; invoker view returning only scoped tenant rows. The previous Wave 1 report states 3/3 passed on 2026-11-15. **Agent 03 did not execute PostgreSQL here; treat those as historical evidence only** until exact integrated-head CI is green.
4. Runtime-role validation examines effective relation/column/function/sequence privileges including membership and PUBLIC; executable non-system SECURITY DEFINER routines are rejected. This describes only the role that is subject to this contract.

## Explicit residuals

- Legacy CMS API/worker and plugin-owned SQL paths do not use this restricted runtime contract; a `security_invoker` view is not a replacement for CMS RLS or a worker-scoped role.
- Non-runtime identities: migration owner, registry provisioner, backup, analytics/reporting and legacy `vibress_app` require a separately executed **actual catalog view/function census**. A non-invoker view or SECURITY DEFINER called using privileged identities can bypass tenant assumptions.
- Materialized views can contain precomputed cross-tenant data. Banning them in one contract does not remove existing materializations or owners' direct SELECT privileges.
- Foreign data wrappers have independent remote user mappings; no local table RLS guarantee can be inferred. Runtime contract denial is correct, but foreign tables readable by other roles remain untested.
- PostgreSQL 16 `security_invoker` changes base table privilege/RLS checks, but functions called by views retain their own `SECURITY DEFINER` or invoker behavior (see official CREATE VIEW docs). Do not assert global view safety from reloptions alone.
- In the historical dev fixture the migration owner is a superuser; production must not retain a superuser for tenant-serving data and needs a non-superuser owner/restore rehearsal.

## Negative proof plan (nonproduction, operator/Agent 02 owned)

1. Connect as runtime, reader, verifier, worker, reporter and legacy CMS role separately. Query `pg_roles`, `pg_class`, `pg_depend`, `pg_proc`, `pg_auth_members`, `pg_default_acl` and `has_*_privilege` read-only, including indirect and PUBLIC grants. Record DB server version and exact SHA.
2. With disposable view and owner, verify non-invoker runtime **BOOT REJECTS**; invoker runtime views only return tenant A under A, zero under B; materialized and foreign runtime contract declarations **REJECT BEFORE GRANT**.
3. Create disposable routine with SECURITY DEFINER and owner-only function access, prove runtime startup **BLOCKS** any executable path; test same paths as legacy, reporter and worker explicitly, not by inference.
4. Verify production owner is `NOSUPERUSER NOBYPASSRLS`, no SET-able owner privilege for serving roles, `FORCE RLS` and deny cross-installation SQL.
5. Re-run `tests/integration/platform-view-surface.test.ts`, `tests/integration/platform-function-privileges.test.ts`, `tests/integration/platform-r26-revocation.test.ts` and all CMS/Studio compatibility on **exact final SHA**. Record SQLSTATE and cleanup status.

## Disposition

R35-CTR (restricted contract): **source-level guard implemented**. R35-ALL (all data consumers): **BLOCKED** until read-only production-shaped catalog/negative matrix and Agent 02 + Agent 06 independent verification.

Sources checked 2026-11-16: [PostgreSQL 16 RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html), [PostgreSQL 16 CREATE VIEW](https://www.postgresql.org/docs/16/sql-createview.html), [CREATE FUNCTION](https://www.postgresql.org/docs/16/sql-createfunction.html), [CREATE FOREIGN TABLE](https://www.postgresql.org/docs/16/sql-createforeigntable.html).
