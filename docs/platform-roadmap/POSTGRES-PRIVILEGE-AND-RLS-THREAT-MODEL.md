# PostgreSQL Effective Privileges & RLS Threat Model — Design Contract

> **Proposed production security requirements; not an implementation or completed penetration test.** Sources: [Vibress runtime DB grants](../../packages/database/src/runtime-role.ts), [connection](../../packages/database/src/connection.ts), [transactions](../../packages/database/src/transaction/transaction-runner.ts), and official [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html), [function security](https://www.postgresql.org/docs/current/sql-createfunction.html), and [RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## 1. Effective privileges cannot be inferred from a single REVOKE

The current `provisionRuntimeRole()` grants `USAGE, CREATE ON SCHEMA public`, DML on every public table and EXECUTE on every public function plus default privileges for future objects. Separating installer and runtime owners is necessary but insufficient unless privilege inheritance and grants to `PUBLIC` are audited.

- PostgreSQL ordinarily grants **EXECUTE to PUBLIC on newly created functions**. A `REVOKE ... FROM runtime_role` alone may not remove the effective privilege while `PUBLIC` still grants it.
- For trusted, privileged SECURITY DEFINER functions, create/revoke/grant within the **same transaction** where applicable, constrain `search_path` to trusted schemas with `pg_temp` ordered safely, inventory owner roles and restrict effective callers. Do not allow untrusted writable schemas on trusted function resolution paths.
- Review role membership/inherited grants, current and default object ACLs per creation owner, built-in and extension-managed functions, default schema/database privileges, schema `CREATE`, `TEMPORARY`, and app/worker migration-role separation. Default privileges are **per owning role**, so changing one role's defaults is not a universal fix.
- Audit effective permissions with catalog queries and `has_function_privilege`, `has_schema_privilege`, `has_table_privilege` executed as the actual production roles; compare a fresh database with one upgraded from the CMS/plugin baseline. Never assume an RLS check closes a broad function-EXECUTE path.

## 2. RLS policy composition and operations it does not cover

- PostgreSQL **permissive** policies may be combined with OR, so adding an innocent-looking permissive policy can widen access. Deliberately select restrictive vs permissive policies, document their composition per operation and fail closed with missing app/tenant claim.
- Normal row policies use `USING` for visible/update/delete rows and `WITH CHECK` for inserted/updated ownership. Test update changing tenant ID, nested relations and foreign key edges.
- **RLS does not gate TRUNCATE or REFERENCES**, so runtime must not hold those privileges for tenant-owned tables (and cross-tenant integrity/constraint errors remain potential information side channels).
- Table owners and BYPASSRLS roles may bypass policies; FORCE RLS can affect owner access but must not be treated as a substitute for separating owner and normal runtime.
- Session variables/custom GUCs can be changed by code executing arbitrary SQL with the same credentials: **RLS based on these variables is not hostile-code sandboxing**. Trust server-owned scope resolution and *deny arbitrary SQL access* to users and low-trust modules.

## 3. Mandatory PostgreSQL role and RLS conformance matrix

| Scenario | Test under actual role | Expected behavior |
| --- | --- | --- |
| Public function EXECUTE | New function created by migration owner; PUBLIC/default/explicit grants audited | Only approved normal-callable functions accessible; privileged DEFINER call denied |
| SECURITY DEFINER shadowing | Writable schema in search_path / temp name shadowing probe | No unauthorized privileged behavior |
| DDL privilege | `CREATE` in public, `ALTER`/`DROP`, `TRUNCATE` and `REFERENCES` | Denied for unprivileged app runtime |
| RLS policy composition | Add broad permissive policy to tenant resource in fixture | No unintended cross-tenant visibility; fail release if violation |
| Default denied claims | Missing, malformed, stale, switched tenant/app in transaction | No rows/changes, no pool reuse leakage |
| RLS owner and BYPASSRLS | Actual production DML role with relevant table owners | Not owner, cannot bypass policies |
| Cross-schema/DB effective ACL | app A and B role against each other's tables/objects | No direct or inherited access |
| Restore + upgrade | Existing public grants and old plugin models in upgraded database | Planned grants maintained; safe reversible migration or forward-fix |
| Privileged maintenance | Narrow operator/migration role and audit | No escalation from regular request, actor and operation logged |

## 4. Migration approach

1. Inventory effective grants and security-definer functions **in actual installation schemas**; enumerate consumers of operator-approved plugin models before changing ownership.
2. Introduce distinct privileged migration/provisioner identity; make normal runtime DML grants explicit and limited to needed schemas/objects; remove PUBLIC default execution from sensitive new functions.
3. Test generated and legacy CMS tables with new role policies; compare both clean installation and upgrade fixture. Avoid breaking old publication-scoped flows.
4. Validate every Postgres supported version and connection-pool mode with parallel tenant sessions, retry, async worker and long-running migration behavior.
5. Promote to staging with evidence of function ACL changes, rollback/forward-fix and role rotation, then seek security owner sign-off. Do not revoke live grants blindly.

**Exit gate:** An isolated tenant transaction test is not enough if normal runtime can bypass policies through inherited grants, callable privileged functions, arbitrary DDL, TRUNCATE or an RLS policy-composition error.
