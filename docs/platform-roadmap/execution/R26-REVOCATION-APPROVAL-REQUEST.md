# R26 — Revocation Approval Request

> **Status: PREPARED, NOT APPROVED, NOT APPLIED.** Date 2026-11-14, revised
> 2026-11-15 after the ineffective schema-scoped default-privilege statement was
> found and replaced (section 4), and re-measured read-only on 2026-11-15 at
> source HEAD `beaeeb71` (section 2). No grant, default ACL, migration journal or
> production database was changed by this request.
> [Proposal 0055](proposals/0055_revoke_public_execute.sql) remains outside
> `packages/database/migrations/` and outside the journal.
>
> This document exists so the database owner and the security review owner can
> approve or reject an exact change instead of a description of one.

## 1. Decisions requested

| Scope | Change | Decision needed |
| --- | --- | --- |
| **A (proposal 0055)** | Revoke `PUBLIC` EXECUTE on the two migration-created trigger functions; install a **global** `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` for the migration owner | Approve / reject |
| **B (not written as SQL)** | Stop the legacy runtime role (`vibress_app`, the api/worker role from `compose.prod.yml`) from holding `EXECUTE ON ALL FUNCTIONS` and from receiving future function EXECUTE by default; re-grant only reviewed callables | Approve / reject / defer |

Scope A and Scope B are separable. Scope A alone closes `PUBLIC` for the platform
runtime role (`vibress_platform_app`) but **does not close R26 for the legacy
runtime role**. That gap is measured below, not inferred.

## 2. Measured current state (dev fixture only)

Re-measured read-only on 2026-11-14 with:

```
node scripts/audit-function-privileges.mjs "postgresql://vibress:vibress@127.0.0.1:5433/vibress"
```

`generated_at` `2026-11-14T19:12:39.618Z`, PostgreSQL 16.15, migrations through
`0054`:

| Metric | Value |
| --- | --- |
| public functions | 33 |
| `SECURITY DEFINER` functions | 0 |
| extension-owned (`pg_trgm`) | 31 |
| non-extension functions | 2 (both trigger functions) |
| functions with effective `PUBLIC` EXECUTE | 33 |
| `pg_default_acl` entries | 0 |
| non-system roles | 1 (`vibress`, superuser, `BYPASSRLS`) |

This matches the [inventory](R26-FUNCTION-EXECUTE-INVENTORY.md) recorded earlier.

**Re-measured 2026-11-15 at source HEAD `beaeeb71`** (read-only,
`node scripts/audit-function-privileges.mjs` against the dev fixture): 33 public
functions, 0 `SECURITY DEFINER`, 31 extension-owned, 33 with effective `PUBLIC`
EXECUTE, **0 `pg_default_acl` entries**, and one login role (`vibress`,
superuser, `BYPASSRLS`). The branch has since added additive migrations `0056`–
`0058`; none adds a function, so the function inventory is unchanged. The
disposable-database proof (`platform-r26-revocation.test.ts`, 4/4) passed again
in this round. The dev fixture still has **no application runtime role**, so it
cannot answer which grants production roles actually need. No production-shaped
inventory was possible from this environment.

## 3. Why Scope A alone is not a complete R26 fix

Two provisioning paths exist and only one of them relies on `PUBLIC`:

| Identity | Function privilege source | After Scope A |
| --- | --- | --- |
| `vibress_platform_app` (reference/platform serving role) | `provisionPlatformRuntimeRole` revokes role-level EXECUTE and does not grant it back, so execution currently depends on the default `PUBLIC` grant | **Denied**; future functions are closed by the default ACL |
| `vibress_app` (api/worker, from `compose.prod.yml` and `POSTGRES_APP_USER`) | `provisionRuntimeRole` runs `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` and `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO vibress_app` ([runtime-role.ts](../../../packages/database/src/runtime-role.ts)) on **every** `runMigrations` | **Still allowed**, and the grant is re-created on the next migration |
| `vibress` (owner) | owner | Unchanged (owner always executes) |
| `pg_trgm` functions | `PUBLIC` default, intentionally not revoked | Unchanged (accepted residual R26-EXT) |

Consequence: a database-only revocation without Scope B would leave the legacy
runtime able to execute any owner-created function, and the next deployment
migration would restore both legacy grants. Scope B requires a code companion in
`provisionRuntimeRole`; applying only SQL would be undone.

Today this is low impact for the same reason the residual is low impact: there
are no `SECURITY DEFINER` functions, and the only non-extension functions are
triggers. Trigger execution does **not** check EXECUTE at run time; EXECUTE is
required when `CREATE TRIGGER` is issued. The risk is the mechanism, not a
currently exploitable routine.

## 4. Scope A — exact statements

See [proposals/0055_revoke_public_execute.sql](proposals/0055_revoke_public_execute.sql):

```sql
REVOKE EXECUTE ON FUNCTION public.prevent_comment_moderation_events_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vibress_plugin_storage_append_only() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_OWNER>
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

**Correction (2026-11-15):** the earlier draft used `... IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. That statement is ineffective and was
replaced after measurement:

- Schema-scoped default ACLs (`IN SCHEMA`) are applied on top of an **empty**
  baseline ACL (`aclchk.c`, `SetDefaultACL`: `def_acl = make_empty_acl()`),
  so a revoke from PUBLIC on that baseline is a no-op and PostgreSQL stores no
  `pg_default_acl` row.
- Measured on the PostgreSQL 16.15 dev container in a disposable database:
  after the schema-scoped statement, `pg_default_acl` had 0 rows and a function
  created by the owner was still executable by an unrelated role.
- Only a **global** default-privilege entry replaces the hard-wired default
  (PUBLIC EXECUTE) for functions created by that role. Measured: the global
  statement stores one row with `defaclnamespace = 0` and
  `defaclacl = {<owner>=X/<owner>}`, and owner-created functions in `public`
  and in another schema are then not executable by the caller role.
- The proposal's guard was also corrected: it previously required a
  schema-scoped row, so it could never pass and the transaction always aborted.
  It now requires the global row and fails closed if it is missing.

The behavior is pinned by
[tests/integration/platform-r26-revocation.test.ts](../../../tests/integration/platform-r26-revocation.test.ts),
which reads the proposal, substitutes the owner and applies it to a disposable
database. Nothing was applied to the shared dev database.

Not included:

- no revocation on the 31 `pg_trgm` functions (extension upgrades recreate them;
  recorded residual);
- no role-level `GRANT` (there is no reviewed caller today);
- no change to table, sequence or schema privileges;
- no migration-journal entry.

Expected effect: the two trigger functions become owner-execute-only; functions
created **by the migration owner** after the change are not `PUBLIC`-executable
until an explicit grant is added, in any schema (the entry is global);
`vibress_platform_app` (and any other role with no explicit grant) is denied
direct execution. Objects created by a different role — including a superuser
bootstrap — are **not** covered by the owner's default entry and remain
`PUBLIC`-executable until reviewed.

## 5. Scope B — legacy runtime companion (not prepared as SQL)

To close the legacy path, the approved change would need both:

1. remove `GRANT EXECUTE ON ALL FUNCTIONS` and the function default-privilege
   grant from `provisionRuntimeRole`; and
2. as the owner, `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM vibress_app`
   and `ALTER DEFAULT PRIVILEGES FOR ROLE <MIGRATION_OWNER> IN SCHEMA public
   REVOKE EXECUTE ON FUNCTIONS FROM vibress_app`, then re-grant only reviewed
   functions.

Caller evidence: the only direct callers of public-schema functions in this
repository are the two trigger definitions; no application code calls either
trigger function directly. Search ranking does call the extension function
`similarity(...)`, which today is reachable through the remaining `PUBLIC` grant
on `pg_trgm`; that is why Scope B should not revoke extension-function `PUBLIC`
at the same time.

Residual after Scope B: extension functions stay `PUBLIC` (accepted R26-EXT),
and trigger functions stay owner-only. Remaining question for the owner: whether
any out-of-repository operator or plugin calls a public-schema function directly.
No such caller is visible here.

## 6. Operational risk to decide on (Scope A)

`ALTER DEFAULT PRIVILEGES` applies to objects the migration owner creates after
the change, including functions an **extension script** creates during
`CREATE EXTENSION` or `ALTER EXTENSION UPDATE` when the owner runs the script.
The installed `pg_trgm` functions are unaffected because they already exist. A
future extension upgrade that creates new function objects could leave them
without `PUBLIC` EXECUTE; serving roles without an explicit grant could then
fail on trigram operators or `similarity(...)`.

Two further consequences of the corrected global form, both measured:

- The entry covers functions the owner creates in **every schema**, not only
  `public`. For this repository that is the intended strict default, but the
  owner should confirm no owner-created utility function in another schema is
  consumed through `PUBLIC`.
- The entry is keyed to the **creating role**. Functions created by a different
  role (for example a superuser bootstrap, or an operator running a one-off SQL
  script) keep the hard-wired `PUBLIC` EXECUTE. The fail-closed inventory guard
  in 0055 only runs when the proposal is applied; ongoing coverage requires the
  released audit (`scripts/audit-function-privileges.mjs`) in CI or a release
  checklist entry.

This was measured in a disposable database, not on shared infrastructure. The
extension-upgrade effect was **not** exercised; it is documented PostgreSQL
behavior, not a measured failure. Mitigations the owner can choose:

- re-check and explicitly grant EXECUTE after any extension upgrade; or
- prefer explicit per-function revokes plus a CI audit guard instead of default
  privileges (durable only if every new function is reviewed in the migration
  that creates it); or
- accept Scope A and add the extension-upgrade check to the deployment runbook
  (W1-T09).

## 7. Pre-conditions before application

1. Run the read-only audit against a production-shaped database with the real
   role set (`vibress`, `vibress_app`, `vibress_platform_app`, plugin and
   reporting roles) and attach the output to this request.
2. Confirm the migration owner role and that it is not the runtime role.
3. Identify every legitimate direct caller of the two trigger functions and of
   future functions; confirm trigger execution stays intact (it does not need
   runtime EXECUTE).
4. Decide Scope A only or Scope A + B, and the extension-upgrade mitigation.
5. Confirm a maintenance window if the owner requires one; the change is
   transactional and does not rewrite data.
6. Keep the rollback section of 0055 ready.

## 8. Application and verification (only after approval)

Order matters:

1. Apply 0055 as the migration owner, never as a runtime role.
2. Re-run `node scripts/audit-function-privileges.mjs "<production url>"` and
   expect `public_execute` to drop by 2 (31 remaining, all extension-owned) and
   one function entry to exist in `pg_default_acl` with `defaclnamespace = 0`
   (global) and no `PUBLIC` grantee. A schema-scoped entry would satisfy the
   audit count but not the effect; check the namespace.
3. **Update the residual test in the same change.** `still executes owner-owned
   public functions through PUBLIC (R26 open)` currently asserts success and must
   be changed to expect SQLSTATE `42501` for the platform role; leaving it
   unchanged makes the suite red by design, and deleting it would hide the
   finding.
4. Run `vitest.platform.config.ts`, the tenant-isolation integration test and the
   full integration suite sequentially against the dev fixture (after applying
   the same change there, if the owner authorizes it).
5. If Scope B is approved, deploy the `provisionRuntimeRole` code companion
   before or with the SQL, then re-run migrations and re-audit to prove the
   grants were not restored.
6. Record the applied statements, audit output and test results in the Wave 1
   report. Until then R26 stays open.

Read-only post-check queries (replace the role name):

```sql
-- Non-extension functions still executable by PUBLIC (expect 0)
SELECT p.oid::regprocedure AS signature
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND NOT EXISTS (
     SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
   AND EXISTS (
     SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE');

-- Default function ACLs for the owner in public (expect one revoke row)
SELECT pg_get_userbyid(defaclrole) AS owner,
       defaclobjtype, defaclacl
  FROM pg_default_acl
 WHERE defaclnamespace = 'public'::regnamespace;
```

## 9. Rollback

The rollback in 0055 restores `PUBLIC` on both trigger functions and grants the
owner default back to `PUBLIC` (which removes the stored global entry, restoring
the hard-wired default). It does not need a data restore and is safe to run if
the change causes an unexpected denial. Existing objects are unaffected either
way: they keep the ACL they were created with. If Scope B is applied, its
rollback must re-grant the legacy role's previous EXECUTE and default privilege
and revert the code companion; no rollback script for B is prepared yet.

## 10. What remains open if only Scope A is approved

| Item | State |
| --- | --- |
| R26 for `vibress_platform_app` | Closed by Scope A, pending production-shaped verification and the test change |
| R26 for `vibress_app` | **Open** — explicit and default function grants persist and are re-created by migrations |
| `pg_trgm` PUBLIC EXECUTE | Accepted residual R26-EXT; no table data exposed |
| Extension-upgrade default-ACL behavior | Risk documented in section 6; mitigation not selected |
| Owner-created functions outside `public` | Closed by the global entry; blast radius documented in section 6 |
| Functions created by a non-owner role | **Not covered** by the default entry; inventory guard and audit required |
| Production inventory | Not performed |

## 11. Sign-off (unsigned)

| Role | Name | Decision (A / B) | Date | Notes |
| --- | --- | --- | --- | --- |
| Database owner | — | — | — | |
| Security review owner | — | — | — | |
| Platform owner | — | — | — | |

No signature exists. `PROGRAM-EXECUTION-STATUS.md` and the Wave 1 report must
continue to say **not applied** until this table is filled and the verification
in section 8 is recorded.
