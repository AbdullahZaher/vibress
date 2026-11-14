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
- The 2026-11-13 security review records RLS as not activated (F-012 residual);
  the proposed CMS disposition is recorded in
  [F-012 decision record](../F-012-CMS-RLS-DECISION.md) and remains unaccepted.

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
| Non-superuser table owner, no context | 0 rows |
| Non-superuser table owner, `SET LOCAL row_security = off` | denied, `42501` |
| Non-superuser table owner, matching context | only that tenant's row |
| Non-superuser table owner DDL on its own table | allowed (ownership ≠ runtime role) |
| **Owner function via `PUBLIC` EXECUTE** | **executes — residual R26** |

## Open blockers before this ADR can be accepted

1. **R26 remediation (inventoried, not applied):** the dev fixture has 33 public
   functions, **0 `SECURITY DEFINER`**, 31 extension-owned `pg_trgm` functions and
   2 migration trigger functions, all with default `PUBLIC` EXECUTE; no
   `pg_default_acl` policy exists. A targeted revocation plus a default-privilege
   change is proposed but **not applied**, pending a production-shaped inventory
   and DB/security approval. See
   [R26 inventory](../R26-FUNCTION-EXECUTE-INVENTORY.md).
2. **Owner role in deployment:** `FORCE RLS` is now proven in tests against a
   non-superuser owner. The dev/Compose migration role `vibress` is still a
   superuser, so the deployment topology must be changed to a non-superuser owner
   and re-verified there; a superuser owner would bypass RLS silently.
3. **Views/materialized reports (R35):** no view is covered by this policy; views
   must be excluded from the generated resource contract or reviewed separately.
4. **Cross-installation proof:** see ADR-PLAT-001.
5. **Independent security review** by someone other than the author.

Until these close, this ADR stays `PROPOSED` and the Wave 1 gate stays **NO-GO**.
