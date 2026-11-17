# AG02 — M03-S03 Effective PostgreSQL Privilege & Catalog Locking Remediation

**Date:** 2026-11-17. **Original reviewed PR:** #198; **frozen base SHA:** `a4a8eb8290950cec3079d89f49ca965c7298f29b`. **Independent Agent 06 source:** PR review 5934507464. **Change:** AG06-S03-02 (P1 BLOCKING) + AG06-S03-03 (P2 BLOCKING EVIDENCE).

## Decision: BLOCKED / PRODUCTION NO-GO

This contributor-authored draft patch cannot certify itself. No shared/production SQL or grants, migrations, owner privileges, DDL or secret changes were made. All new tests use existing separately created `vibress_s03_*` disposable PostgreSQL 16 labs. **Do not merge until Agent 05 coordinates approval provenance, Agent 04 reviews lock/recovery operations, Agent 06 independently checks exact source and reruns, and a release owner authorizes.**

### Confirmed root causes

1. `assertAuthority` checked `SECURITY DEFINER` only in schema `public`, despite PostgreSQL allowing routine execution when a role has both schema `USAGE` and function `EXECUTE` (possibly through `PUBLIC`, inherited privileges or `SET ROLE`). Functions outside public could bypass the check.
2. Advisory transaction locking only serializes cooperating operators. Without an explicit target table lock, an unrelated session can `ALTER TABLE` after the catalog validation and before the bounded `ADD COLUMN` takes its lock.
3. **Owner capability is not bounded SQL grammar:** the disposable operator *owns* the application table and PostgreSQL permits that credential to `ALTER` and `DROP` table structure directly. The TypeScript renderer supports only one approved optional `ADD COLUMN`, but a compromised operator database credential is much more powerful.

### Changes for independent review

- Added `platform-schema-effective-privileges.ts`: query effective callable SECURITY DEFINER routines across **all** namespaces (not public-only), both runtime and operator, using PostgreSQL `has_schema_privilege` + `has_function_privilege`; inspect every `MEMBER/SET/USAGE` membership path, CREATE across all non-system schemas, runtime ownership of any non-system relation, and current database ownership. **Fail closed if ANY reachable SECURITY DEFINER or unexpected authority exists; no implicitly safe function allowlist.** Even a hard-coded harmless test definer must be removed before migration.
- Operator calls the independent inventory before authorizing DDL. No grants or mass revocation.
- An explicit `LOCK TABLE ONLY "public"."<compiler-table>" IN ACCESS EXCLUSIVE MODE` is obtained under pre-existing 2-second `lock_timeout` and 10-second `statement_timeout` **before** authoritative table/catalog inspection and held through DDL, CAS and journal COMMIT. This serializes noncooperating DDL as well as cooperative operators.
- Existing `SERIALIZABLE` began reading registry and approval **before** taking the table lock. PostgreSQL docs warn that the snapshot may be stale after locking in this order. The single-application, single-column operation uses `READ COMMITTED` for a fresh catalog snapshot after the lock while retaining installation advisory fencing, registry `FOR UPDATE`, manifest CAS and atomic DDL/journal. This isolation change is **a review-sensitive compatibility tradeoff**, not a general claim that READ COMMITTED ensures end-to-end approval revocation safety. Agent 05 owns the concurrent approval/revocation lock/identity contract.

### Effective-privilege and definer exposure policy

No function is whitelisted in this patch. Any reachable `SECURITY DEFINER` routine, including extension-owned routines, fails closed **even if its body appears harmless**. Effective callable paths are checked for both service roles via schema USAGE + function EXECUTE; inherited and PUBLIC grants are folded into PostgreSQL privilege checks. Noncooperating `SET ROLE` and inherited group memberships are prohibited for operator/runtime service identities. Review `proconfig`, owner, extension provenance and `search_path` in the separate read-only catalog inventory before proposing an independently approved allowlist. SQL-language chains, indirect object DML triggers on unrelated CMS tables and a compromised privileged owner DSN are **not fully proved absent** by this scanner; require real credential isolation, complete catalog inventory, application route audit and Agent 05/06 concurrence.

### PostgreSQL owner risk

| Identity | SQL grammar in application | Database credential authority |
| --- | --- | --- |
| Runtime | No DDL through sanctioned API | Non-owner: CREATE/ALTER/DROP/TRUNCATE denied in disposable fixture |
| Operator (owner of target table) | Renderer permits exactly one additive optional scalar column | Full table-owner ALTER/DROP and associated ownership authority outside application code |
| Migration/admin | Provisioning only | Powerful control-plane authority; never in API/Worker/plugin runtime |

**Risk acceptance:** NONE. A stolen operator DSN can bypass the renderer; must be segregated to an operator-only process, nonproduction fixture today, hardware/secret access-scoped in future, with audit logs and monitored use. Do not promise ADD COLUMN-only PostgreSQL role privileges while the role owns the table.

### Locking / drift / recovery model

1. Operator validates trusted scope and metadata; locks installation advisory key and registry row, and rehydrates the canonical plan.
2. Lock **exact canonical physical relation** in `public` with PostgreSQL ACCESS EXCLUSIVE before trusting any table catalog result. Any concurrent DDL already underway must finish (then new catalog check sees it) or the operator times out and refuses.
3. Recheck owner, schema, relkind, persistence, RLS state, unexpected constraints/triggers/inheritance, exact expected columns/type/null/default/identity and runtime privileges. Reject mismatch before ALTER.
4. Apply only approved bounded ADD COLUMN; recheck full physical catalog and row count; CAS accepted manifest and write completed journal in **one PostgreSQL transaction**; commit. Rollback of any error reverts DDL and journal.
5. Lock tradeoff: ACCESS EXCLUSIVE blocks readers/writers and DDL for the short transaction, so production needs separate lock window, lock timeout, statement timeout and monitoring. Order of advisory + registry row + target table locks matters; noncooperating DB sessions may reverse order and create deadlocks, which PostgreSQL detects and the operator must fail closed/retry only after manual reconciliation.
6. `READ COMMITTED` plus registry row locking does **not** settle Agent 05's pending approval revocation race; do not accept an approval as valid at commit unless the approval row is locked and revocation uses the same serialization protocol.

### Required regression matrix (source tests; final results tied to CI SHA)

- Public / non-public definer, default PUBLIC EXECUTE, inherited group grants, SET ROLE, extra-schema CREATE, owner-level ALTER, unexpected CHECK/trigger, cross-installation CONNECT denial, runtime registry/approval denial, noncooperating DDL before lock, lock timeout, failed journal rollback and replay; explicit lock held during independent DDL attempt.
- Existing normalized manifest/replay/registry compatibility tests still required.
- Actual production catalog permission matrix, indirect function chains, searched extension routines, mixed-version upgrade/backup/PITR, and Agent 05 principal provenance, approval race and connection-loss classes remain independent blockers.

### Read-only evidence queries and source references (reviewed 2026-11-17)

- `M03-S03-AG02-POSTGRES-PRIVILEGE-INVENTORY.sql` (REQUIRES verified runtime/operator role values; template, **not executed against production**).
- PostgreSQL 16: https://www.postgresql.org/docs/16/functions-info.html
- PostgreSQL 16 role inheritance/SET: https://www.postgresql.org/docs/16/role-membership.html
- PostgreSQL 16 locks and snapshot ordering: https://www.postgresql.org/docs/16/sql-lock.html
- PostgreSQL 16 `SECURITY DEFINER` search_path guidance: https://www.postgresql.org/docs/16/sql-createfunction.html
- GitHub baseline: https://github.com/AbdullahZaher/vibress/pull/198
