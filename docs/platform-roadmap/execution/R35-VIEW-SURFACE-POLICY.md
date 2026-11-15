# R35 — Runtime view and materialized-view policy

> **Status: IMPLEMENTED at the runtime-contract boundary (2026-11-15).** The
> code and tests below are enforced on every provisioning and boot. This record
> does not clear the R35 residual for relations accessed outside the runtime
> contract, and it does not replace the independent review.

## Decision

The runtime privilege contract is the only path that grants a serving identity
database authority. Under R35:

1. **A declared `view` is accepted only when the database view is
   `security_invoker=true`.** Boot inspects `pg_class.reloptions`; a declared
   view without the option raises `view_not_security_invoker` and the runtime
   refuses to start. With the option set, PostgreSQL evaluates the view's
   underlying row-level security as the caller, so tenant policies apply.
2. **`materialized_view` is rejected by contract validation.** PostgreSQL 16
   has no caller-scoped execution for materialized views
   (`ALTER MATERIALIZED VIEW ... SET (security_invoker=true)` fails with
   `unrecognized parameter "security_invoker"` on the dev server, measured
   2026-11-15). Stored rows would be read without the caller's RLS, so the kind
   cannot be part of a runtime profile at all.
3. **Views owned or read outside the runtime contract remain out of scope.**
   The guard covers runtime profiles only. A view executed by the migration
   owner is still governed by the owner's role attributes and `FORCE RLS`, which
   is why the non-superuser owner work (ADR-PLAT-003, blocker 2) remains
   required.

A `security_invoker` view also requires the runtime role to hold privileges on
the underlying relations, so the contract must declare those relations as well.
The reference profile declares `platform_crm_customers` directly and no view.

## Evidence

- `packages/database/src/platform-runtime-privilege-contract.ts` — rejects
  `materialized_view` with the R35 reason.
- `packages/database/src/platform-runtime-role.ts` — `view_not_security_invoker`
  boot violation, read from `pg_class.reloptions` for every declared view.
- `tests/integration/platform-view-surface.test.ts` — **3/3 passed** against
  the dev PostgreSQL fixture with throwaway roles (removed afterwards):
  1. a materialized-view contract is rejected;
  2. a declared view without `security_invoker` fails boot with the specific
     violation code, and the leak is measured, not assumed: the runtime reads
     `platform_crm_customers` directly as 0 rows but reads the throwaway
     customer through the non-invoker view (dev owner is a superuser);
  3. after `ALTER VIEW ... SET (security_invoker = true)` boot passes, the same
     view returns 0 rows without tenant scope and exactly the scoped tenant's
     row with it.
- `tests/integration/platform-reference-app.test.ts` — the contract-validation
  test now also asserts the materialized-view rejection.
- Full platform suite: **15 files / 211 tests passed** (exit 0).

## Residual risk

| Residual | Status |
| --- | --- |
| Views owned or queried by the migration/owner identity | Open — covered by ADR-PLAT-003 blocker 2 (non-superuser owner); `FORCE RLS` still applies to a non-superuser owner |
| Views that use `SECURITY DEFINER` functions to read other tenants | Unchanged — R26 function-execute work governs owner-defined functions |
| Non-runtime identities (membership reader, deployment verifier) and views | Out of scope — those profiles are limited to fixed relations and deny everything else |
| Production owner remains a superuser in the dev fixture | Open deployment blocker, unchanged |

## Non-goals

- It does not add or alter any CMS/view object, migration or grant.
- It does not mark R35 fixed in the release gate; the release gate remains
  **NO-GO** until the owner-topology and independent-review items close.
- It does not authorize exposing views to tenants by default; a view still has
  to be declared, granted and marked `security_invoker` explicitly.
