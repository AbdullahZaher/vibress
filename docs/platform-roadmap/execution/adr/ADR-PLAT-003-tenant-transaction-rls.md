# ADR-PLAT-003 (PROPOSED) — Tenant Transaction and Row-Level Security Contract

> **Status: PROPOSED. Prototype exists on this branch; independent security review
> and acceptance are missing.** Owner: **UNASSIGNED** (DB/security lead).

## Context

Existing runtime paths cannot enforce tenant isolation:

- `getDb()` returns a pooled Drizzle handle with no verified scope
  ([connection.ts](../../../../packages/database/src/connection.ts)).
- `runInTransaction()` reuses nested transactions **without savepoints**
  ([transaction-runner.ts](../../../../packages/database/src/transaction/transaction-runner.ts)).
- The legacy runtime role holds `CREATE` on `public`, DML on all tables and
  `EXECUTE ON ALL FUNCTIONS`, plus default privileges for future objects
  ([runtime-role.ts](../../../../packages/database/src/runtime-role.ts)).
- The 2026-11-13 security review records RLS as not activated (F-012 residual).

## Proposed decision

1. **No tenant-owned data access without a verified scope.** All reads/writes go
   through a unit of work that requires a `VerifiedScope` and runs on **one**
   connection inside **one** transaction.
2. Application, tenant and principal context are applied with
   `set_config(..., is_local => true)` on that connection and **read back** before
   any callback query runs. Mismatch aborts the transaction.
3. A nested unit of work may only reuse the parent scope. A scope switch marks the
   outer transaction **rollback-only** and throws, even if the caller catches it.
4. Any SQL that mutates `vibress.*` settings through the scoped handle is rejected.
5. A transaction marked rollback-only is always rolled back; a swallowed PostgreSQL
   error is detected by a probe query before `COMMIT`.
6. Tenant-owned tables use `ENABLE` **and** `FORCE ROW LEVEL SECURITY`; policies fail
   closed when context is missing or empty (`NULLIF(current_setting(..., true), '')`)
   and apply `USING` plus `WITH CHECK` for both `tenant_id` and `application_id`.
7. The runtime role is a non-owner with `NOBYPASSRLS`, DML only on tenant-owned
   tables, no `CREATE`, no `TRUNCATE`/`REFERENCES`/`TRIGGER`, and no access to the
   operator registry. Migration/owner and runtime roles are distinct.

## Explicit non-claims

- A custom GUC is **not authentication**. Trusted application code with arbitrary SQL
  can set the context; this contract is a policy interface, not a sandbox.
- `row_security=off` is treated as an error signal, not a bypass.
- Function `EXECUTE` granted to `PUBLIC` by default is **not** removed by a
  role-specific `REVOKE`; the residual is measured and tracked (see below).
- `FORCE ROW LEVEL SECURITY` only constrains non-superuser owners; a superuser
  migration role bypasses it.

## Measured evidence (this branch)

`tests/integration/platform-tenant-isolation.test.ts` runs against PostgreSQL 16 in
`vibress-postgres-1`, through a provisioned non-owner role:

| Check | Result |
| --- | --- |
| Role attributes | non-superuser, no createdb/createrole/bypassrls |
| `CREATE TABLE` in `public` | denied, SQLSTATE `42501` |
| `TRUNCATE platform_crm_customers` | denied, `42501` |
| `SELECT` on CMS `users` | denied, `42501` |
| `SELECT` on `platform_applications` | denied, `42501` |
| Missing context read | 0 rows |
| Tenant A / Tenant B reads | A sees `cust-a`, B sees `cust-b` |
| Cross-tenant `UPDATE` | 0 rows |
| Cross-tenant `INSERT` | denied, `42501` |
| Matching `INSERT` | allowed |
| `SET LOCAL row_security = off` | denied, `42501` |
| Pooled connection reuse | context does not leak after `COMMIT` |
| Unit of work read | scoped rows only |
| Nested tenant switch | rejected, outer transaction rolled back |
| Raw `set_config` through scoped handle | rejected |
| **Owner function via `PUBLIC` EXECUTE** | **executes — residual R26** |

## Open blockers before this ADR can be accepted

1. **R26 function inventory:** list `SECURITY DEFINER` functions, owners, effective
   `PUBLIC`/inherited `EXECUTE`, `search_path`, and default privileges; ship a
   reviewed targeted-revocation migration. Not performed here.
2. **Owner role:** the dev migration role is a superuser, so `FORCE RLS` behavior
   against a non-superuser owner is unproven. Production must use a non-superuser
   owner, with a test proving owner reads still fail closed.
3. **Views/materialized reports (R35):** no view is covered by this policy; views
   must be excluded from the generated resource contract or reviewed separately.
4. **Cross-installation proof:** see ADR-PLAT-001.
5. **Independent security review** by someone other than the author.

Until these close, this ADR stays `PROPOSED` and the Wave 1 gate stays **NO-GO**.
