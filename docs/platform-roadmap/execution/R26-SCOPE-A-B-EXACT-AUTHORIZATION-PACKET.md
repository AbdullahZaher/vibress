# R26 Exact Scope A/B Authorization Request — Agent 02

**Date:** 2026-11-16. **Review baseline:** PR #176 `b52ca3f4c0a740d7ff6b1ad784d9e3100b34e899`.  
**Verdict:** **BLOCKED / NO AUTHORIZATION.** This is a written technical request, not a signed approval. No production/shared DB grants or migration changes were performed.

## Scope A — global default and two existing functions

**Target:** Only explicitly inventoried non-extension owner-created functions `public.prevent_comment_moderation_events_mutation()` and `public.vibress_plugin_storage_append_only()`, plus one GLOBAL per-creating-owner default ACL. Exact owner must be verified from live `pg_proc.proowner`; do not substitute dev superuser name into production.

Proposed SQL (DISPOSABLE ONLY until all owner approvals):
```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.prevent_comment_moderation_events_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vibress_plugin_storage_append_only() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE <REAL_MIGRATION_CREATOR>
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- The guarded proposal 0055 also checks for unexpected owner routines and
-- the GLOBAL pg_default_acl entry before committing.
COMMIT;
```
Actual safeguarded proposal: `docs/platform-roadmap/execution/proposals/0055_revoke_public_execute.sql`. It stays outside the production migration directory and journal. GLOBAL (not IN SCHEMA) default-revoke is required by PostgreSQL 16 documentation.

**Blast radius:** future owner-created functions in ALL schemas, including later extension scripts run as that role, may stop working for consumers without explicit EXECUTE; pre-existing pg_trgm extension objects retain PUBLIC; other creating owners retain their own defaults. Need DB-role/function inventory before applying.

**Required tests:** `42501` on an independently connected unprivileged role executing a newly created ordinary owner function; existing trigger behavior unchanged; catalog shows `defaclnamespace=0`; post inventory includes all non-system schemas; check no executable unreviewed SECURITY DEFINER with unsafe search_path.

## Scope B — legacy CMS and worker explicit grants

`packages/database/src/runtime-role.ts` grants legacy `vibress_app` blanket DML, `public` schema CREATE and EXECUTE on all public functions plus future defaults. `runMigrations` reprovisions these grants at each run. **Scope A alone cannot close R26.**

Requested: first inventory direct CMS/API/worker/plugin callers, create an explicit allowlist of approved function signatures and owned plugin tables, split worker credential, modify `provisionRuntimeRole` so migrations NEVER regrant blanket EXECUTE and default EXECUTE, then in the same reviewed deployment:
```sql
-- TEMPLATE ONLY; do not run without reviewed caller list and role names.
BEGIN;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM <LEGACY_APP_ROLE>;
ALTER DEFAULT PRIVILEGES FOR ROLE <REAL_MIGRATION_CREATOR> IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM <LEGACY_APP_ROLE>;
-- GRANT only named reviewed routines back to each distinct consumer.
COMMIT;
```
This does not close unrelated PUBLIC or inherited grants. Other schema/function owners and non-extension objects need explicit per-role audit. Decide separately whether legacy CMS can operate under reduced table/schema privileges; `CREATE` may be required by legitimate plugin storage code, and removing it unreviewed will break installations.

## Rollback, restore and decision prerequisites

- **A rollback:** use commented rollback section of proposal 0055 to restore PUBLIC on two functions and default for creating role; it does not retroactively change ACLs of functions created during restriction.
- **B rollback:** code and SQL grant changes must revert together after **verified disposable** compatibility rehearsal; unreviewed blanket regrant should not be a default recovery action.
- **Recovery gate:** tested snapshot/PITR restore to a separate PG16.16+ cluster; named RPO/RTO and restore transcript; compare `pg_auth_members`, function/default ACL and object ownership before/after each injected failure.
- **Required sign-off:** named DB owner + AppSec reviewer + Agent 06 concurrence; release owner logs assessed scope, risk, timebox, recovery and expiry for any accepted high risk; no automatic application from this request.
- **Services:** legacy CMS/API, worker/background queues, Studio, plugins, search `pg_trgm`, registry provisioner, platform runtime, membership reader, deployment verifier, migration runner.
- **Decision values:** `R26-A=APPROVE|REJECT|DEFER`, `R26-B=APPROVE|REJECT|DEFER`, `R26-EXT=REVIEWED|BLOCKED`, `R26-ROLLBACK=TESTED|BLOCKED`. All currently **BLOCKED**.

## Sources checked 2026-11-16

- https://www.postgresql.org/docs/16/sql-alterdefaultprivileges.html
- https://www.postgresql.org/docs/16/ddl-priv.html
- https://www.postgresql.org/docs/16/role-membership.html
- https://www.postgresql.org/docs/16/release-16-16.html
- https://github.com/AbdullahZaher/vibress/blob/b52ca3f4c0a740d7ff6b1ad784d9e3100b34e899/packages/database/src/runtime-role.ts
