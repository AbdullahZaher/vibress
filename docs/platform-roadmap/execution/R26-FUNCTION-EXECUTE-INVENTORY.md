# R26 — Function EXECUTE Inventory (read-only)

> **Status: INVENTORY COMPLETE ON THE DEV FIXTURE. The proposed revocation is
> NOT APPROVED AND NOT APPLIED.** Production data was not touched. No grant was
> changed by this task; this document and the proposal only describe what was
> measured. Re-measured 2026-11-14T19:12:39.618Z with identical totals. The
> exact approval request is
> [R26-REVOCATION-APPROVAL-REQUEST.md](R26-REVOCATION-APPROVAL-REQUEST.md).

## 1. Why this exists

PostgreSQL grants `EXECUTE` on every new function to `PUBLIC`. A role-specific
`REVOKE ... FROM <role>` therefore does **not** remove the effective privilege.
`provisionPlatformRuntimeRole` revokes only the role-specific grant, so the Wave 1
test [still executes owner-owned public functions through PUBLIC](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md)
records the residual instead of claiming it fixed.

## 2. How it was measured

Reproducible, read-only:

```
node scripts/audit-function-privileges.mjs "postgresql://vibress:vibress@127.0.0.1:5433/vibress"
```

The script sets `default_transaction_read_only = on` before querying, then reports
public-schema functions (signature, owner, `prosecdef`, `proconfig`, ACL, extension
membership, effective `PUBLIC` execute), `pg_default_acl`, and non-system roles.

## 3. Measured result

Environment: database `vibress`, PostgreSQL 16.15, migrations through `0054`.

| Metric | Value |
| --- | --- |
| Functions in `public` | 33 |
| `SECURITY DEFINER` functions | **0** |
| Extension-owned functions (`pg_trgm`) | 31 |
| Non-extension functions | 2 |
| Functions with effective `PUBLIC` EXECUTE | **33** |
| `SECURITY DEFINER` **and** `PUBLIC` EXECUTE | **0** |
| `pg_default_acl` entries | **0** |
| Non-system roles | 1 (`vibress`, superuser) |

The only non-extension functions are trigger functions:

| Function | Kind | Owner | ACL | PUBLIC EXECUTE |
| --- | --- | --- | --- | --- |
| `prevent_comment_moderation_events_mutation()` | trigger | `vibress` | `{=X/vibress,vibress=X/vibress}` | yes |
| `vibress_plugin_storage_append_only()` | trigger | `vibress` | `{=X/vibress,vibress=X/vibress}` | yes |

Interpretation: `{=X/...}` is the default `EXECUTE TO PUBLIC`; the two trigger
functions can be called directly by any role that can connect. They only run as
triggers in practice, so this is low impact **today**, but it is the same mechanism
the residual test exercises for future migration-created functions.

## 4. Findings

1. **No `SECURITY DEFINER` functions exist in `public`.** There is currently no
   owner-rights routine to abuse through the `PUBLIC` grant.
2. **Every function carries default `PUBLIC` EXECUTE**, including the two trigger
   functions. No per-function revocation exists.
3. **No default-privilege policy is installed** (`pg_default_acl` is empty), so
   nothing constrains functions created by future migrations.
4. **The fixture has no application runtime role** — only the superuser. Any
   revocation must be validated against a realistic role set before production.
5. Extension functions are recreated by extension upgrades; revoking `PUBLIC` on
   them is not durable and is not proposed.
6. **Revoking `PUBLIC` alone does not close R26 for the legacy runtime role.**
   `provisionRuntimeRole` (api/worker, `POSTGRES_APP_USER` default
   `vibress_app`) runs `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` and
   `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO vibress_app` on
   every migration run. Those are explicit grants, not `PUBLIC`; the next
   migration recreates them. The platform role (`vibress_platform_app`) is
   different: it revokes role-level EXECUTE and depends on `PUBLIC`, so 0055
   would deny it. Closing the legacy path needs a separate decision plus a
   `provisionRuntimeRole` code companion (Scope B in the approval request).

## 5. Proposed migration (NOT APPLIED)

File: [proposals/0055_revoke_public_execute.sql](proposals/0055_revoke_public_execute.sql).
It is deliberately **outside** `packages/database/migrations/` and is not in the
journal, so no migration runner can apply it by accident.

Scope:

- `REVOKE EXECUTE` on the two trigger functions from `PUBLIC`;
- `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` for the
  migration owner, so future functions are closed by default;
- explicit re-grants only where a real caller needs them;
- two fail-closed `DO` blocks: abort if any other non-extension function is still
  `PUBLIC`-executable or if the default ACL did not take effect.

Companion rollback is included in the same file, commented as a rollback section.
The file does not revoke the legacy role's explicit grants; that is Scope B in
the [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) and needs a code
companion so the next migration does not restore them.

## 6. Before this can be applied (blocking)

1. Run the script against a **production-shaped** database with the real role set
   (`vibress_app`, `vibress_platform_app`, plugin roles, reporting roles) — the
   dev fixture has none.
2. Identify every legitimate direct caller of the two trigger functions and of any
   future default-revoked function; trigger definitions need EXECUTE at
   `CREATE TRIGGER`, not at trigger run time.
3. Get DB/security owner approval for the default-privilege change; it is a
   shared-database policy change. Decide Scope A only or Scope A + B.
4. Decide the extension-upgrade mitigation: `ALTER DEFAULT PRIVILEGES` applies
   to functions an extension script creates later, which could affect trigram
   operators after an extension upgrade. This is documented, not tested.
5. Apply with the migration owner (not the runtime role), then re-run
   `scripts/audit-function-privileges.mjs` and expect 31 `PUBLIC`-executable
   functions, all extension-owned, plus one default-ACL entry.
6. **Flip the residual test in the same change.** `still executes owner-owned
   public functions through PUBLIC (R26 open)` asserts success today; after
   application it must assert SQLSTATE `42501`. Leaving it unchanged fails the
   suite; deleting it would hide the finding.
7. Keep the rollback ready; the change is reversible (`GRANT ... TO PUBLIC`).

## 7. Accepted residual

The 31 `pg_trgm` functions remain executable by `PUBLIC`. They compute similarity
over caller-supplied text and expose no table data. Revoking them would be undone by
a future `ALTER EXTENSION pg_trgm UPDATE`, so it is documented rather than enforced.
This is a recorded decision, not a certification.

## 8. What this task did not do

- No grant was changed, in dev or elsewhere.
- No code change was made to `provisionRuntimeRole` or
  `provisionPlatformRuntimeRole`; Scope B is only described.
- No production inventory was possible from this environment.
- No `SECURITY DEFINER` search-path review was required because none exist here;
  the script reports `proconfig` so a future one is visible.
