# Wave 1 — Implementation and Security Report (M00–M02)

> **STATUS: IN PROGRESS — GATE DECISION: NO-GO.**
> This report records work executed on branch `feat/wave1-platform-kernel-tenant-isolation`
> cut from `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`, with the unmerged
> roadmap pinned at PR #151 head `c9997a9353a229a4287256f5ba3b94d718e3a5d9`.
> Nothing here authorizes public application hosting, tenant onboarding or production.

## 1. Executive status

| Item | Status |
| --- | --- |
| M00 baseline | **PARTIAL** — baseline, ownership map and ADR blockers recorded; docs validator and compatibility fixture pinning remain |
| M01 kernel | **PARTIAL** — public contracts, registry, reference action/route/module exist; persisted registry and a bootable reference app remain |
| M02 tenancy/security | **PARTIAL** — verified scope, default-deny policy, tenant unit of work, additive RLS migration, least-privilege role and real PostgreSQL deny matrix exist; R26 function inventory, owner-role proof, views policy and cross-installation proof remain |
| Independent security review | **NOT PERFORMED** |
| Gate | **NO-GO** |

Deliberately **not** claimed: Wave 1 passed; ADRs accepted; production safe; CMS
remains fully compatible (subset only); no public or external tenant access.

## 2. Scope and pinned baseline

See [BASELINE-AND-OWNERSHIP-M00.md](BASELINE-AND-OWNERSHIP-M00.md). Summary:

- Host base: `5183f34f` on `main`; roadmap input: PR #151 (draft) `c9997a93`.
- Studio reference: `eda4c52e` (read-only; nothing in the Studio repo was modified).
- No existing tag, migration, audit record or issue status was rewritten.
- Migration `0054` is additive and appended to the journal; `0053` and earlier are untouched.

## 3. Implemented code (real, compiled, tested)

| Area | Path | What it does |
| --- | --- | --- |
| Kernel identity | `packages/platform-kernel/src/identity.ts` | Branded Application/Tenant/Principal/Publication ids; `pub_default` rejected except for the legacy publication type; identifiers validated |
| Kernel contracts | `packages/platform-kernel/src/contracts.ts` | Request context, policy decision, domain event, action/route/module/application contracts with a scoped transaction port |
| Definition helpers | `packages/platform-kernel/src/application.ts` | `defineAction`/`defineRoute`/`defineModule`/`defineApplication`, route and action validation, kernel range check |
| Registry | `packages/platform-kernel/src/registry.ts` | In-memory application registry, duplicate protection, action/route resolution with path params |
| Verified scope | `packages/tenancy/src/scope.ts` | `verifyTenantScope`, `resolveVerifiedScope`, `assertVerifiedScope`; scope can only be produced by verification |
| Policy | `packages/tenancy/src/policy.ts` | Default-deny engine, deny precedence, exact/namespace/global permissions, cross-tenant denial |
| Unit of work | `packages/tenancy/src/unit-of-work.ts` | Single-connection transaction, transaction-local context set and read back, nested scope-switch rejection, rollback-only marking, error-probe before `COMMIT` |
| Schema | `packages/database/src/schema/platform-kernel.ts` | Application/installation/tenant tables and a tenant-owned CRM customers table with a composite `(tenant_id, application_id)` FK |
| Migration | `packages/database/migrations/0054_platform_tenant_rls.sql` | Additive tables and indexes, `ENABLE` + `FORCE` RLS, fail-closed `USING` and `WITH CHECK` policy |
| Runtime role | `packages/database/src/platform-runtime-role.ts` | Non-owner `NOBYPASSRLS` role: DML only on tenant table, no CREATE, no TRUNCATE/REFERENCES/TRIGGER, no registry access, role-level EXECUTE revoked |
| Boundary test | `tests/architecture/platform-boundaries.test.ts` | Kernel must not import outside itself; tenancy may import only the kernel plus Node/relative |
| Platform test config | `vitest.platform.config.ts` | Isolated node-environment run without the CMS global setup |

No placeholder handlers, no skipped tests, no lowered thresholds. `packages/platform-kernel`
and `packages/tenancy` are workspace packages at `1.2.0` and are **private**, matching
the existing SDK reality rather than implying a published release.

## 4. Security design and measured behavior

The contract and measured PostgreSQL matrix are in
[ADR-PLAT-003](adr/ADR-PLAT-003-tenant-transaction-rls.md). Key properties:

- No tenant read/write without a verified scope; pooled `getDb()` is not used by the
  new path, and the legacy path is unchanged and still ungoverned (documented risk).
- Context is applied with `set_config(..., true)` on the **same** connection and read
  back; mismatch aborts. Raw `set_config`/`SET` through the scoped handle is rejected.
- Nested scope switches mark the outer transaction rollback-only and always trigger
  `ROLLBACK`, even when the caller swallows the error.
- A swallowed PostgreSQL error is detected with a probe query before `COMMIT`.
- RLS policy fails closed when `vibress.application_id`/`vibress.tenant_id` are
  missing or empty and is applied to both `USING` and `WITH CHECK`.
- Role is non-owner, `NOBYPASSRLS`, denied `CREATE`, `TRUNCATE`, registry access and
  CMS tables.

### Measured residual: function EXECUTE via `PUBLIC` (R26)

PostgreSQL grants `EXECUTE` on new functions to `PUBLIC`. A role-specific
`REVOKE ... FROM <role>` does not remove that effective grant. The integration test
`still executes owner-owned public functions through PUBLIC (R26 open)` proves the
platform runtime role **can** execute an owner-created function in `public`. This is
recorded as an open blocker, not accepted behavior. Closing it requires a full
function/`SECURITY DEFINER` inventory and a reviewed migration; it was not performed
blindly because it changes shared database policy.

### Measured limitation: superuser owner

The dev migration role `vibress` is a **superuser**, so `FORCE ROW LEVEL SECURITY`
is not exercised against the owner. Production must use a non-superuser owner and
prove owner reads fail closed without context. Open blocker.

## 5. Tests and evidence (executed, with results)

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --config vitest.platform.config.ts` (unit + boundary + PostgreSQL integration) | **6 files / 56 tests passed** |
| `pnpm exec vitest run --config vitest.platform.config.ts packages/platform-kernel/src packages/tenancy/src tests/architecture` | **5 files / 39 tests passed** |
| `DATABASE_URL=postgresql://vibress:vibress@127.0.0.1:5433/vibress pnpm exec vitest run --config vitest.platform.config.ts tests/integration/platform-tenant-isolation.test.ts` | **1 file / 17 tests passed** against PostgreSQL 16 |
| `pnpm exec tsc -p packages/platform-kernel/tsconfig.json --noEmit` | passed |
| `pnpm exec tsc -p packages/tenancy/tsconfig.json --noEmit` | passed |
| `pnpm exec tsc -p packages/database/tsconfig.json --noEmit` | passed |
| `pnpm exec eslint packages/platform-kernel packages/tenancy tests/architecture tests/integration/platform-tenant-isolation.test.ts packages/database/src/platform-runtime-role.ts packages/database/src/schema/platform-kernel.ts` | passed, no output |
| `pnpm exec nx run-many --target=typecheck --all --skip-nx-cache` | **73 projects succeeded**, 42.8 s |
| CMS compatibility subset (`runtime-multi-publication-isolation`, `content-database`, `transactions`, `studio-persistence-roundtrip`, `outbox`) | **5 files / 79 tests passed** in 14.45 s, including migration + seed global setup |
| Pre-existing `tests/integration/platform-packages.test.ts` under the root config | **26 tests passed** (runs under root aliases, not the platform config) |

The PostgreSQL proof applies migration `0054`, provisions the runtime role, inserts
two tenants and two customers through the owner, then reconnects **as the runtime
role** for every assertion. It cleans up its rows, role and owned objects in
`afterAll`.

## 6. Migration, data and rollback

- `0054_platform_tenant_rls.sql` only creates new tables/indexes and enables RLS on
  `platform_crm_customers`. It does not alter existing CMS tables.
- Journal entry `idx 54` appended; no earlier migration or checksum modified.
- Rollback: dropping the four new tables and the policy returns the database to the
  pre-0054 shape; no CMS data depends on them. No destructive command was executed
  against shared or production data.
- The runtime role provisioner is **not** wired into `migrate.ts`; it is invoked
  explicitly (in tests) so no existing deployment silently gains or loses grants.

## 7. Compatibility

- Kernel/tenancy packages are additive and not imported by existing apps.
- `packages/database/src/index.ts` only adds exports; existing exports unchanged.
- The legacy runtime role, pooled `getDb()` and transaction runner are untouched.
- CMS compatibility evidence is limited to the subset in section 8; the full
  integration and E2E suites were not run in this pass.

## 8. Compatibility run result

Command (executed on this branch, repository-default Vitest config, so the standard
global setup applied migrations through `0054` and seeded both CMS publications):

```
DATABASE_URL=postgresql://vibress:vibress@127.0.0.1:5433/vibress \
REDIS_URL=redis://127.0.0.1:6380 \
pnpm exec vitest run --config vitest.config.ts \
  tests/integration/runtime-multi-publication-isolation.test.ts \
  tests/integration/content-database.test.ts \
  tests/integration/transactions.test.ts \
  tests/integration/studio-persistence-roundtrip.test.ts \
  tests/integration/outbox.test.ts
```

Result: **5 files / 79 tests passed, duration 14.45 s.** This covers multi-publication
isolation, content persistence, the legacy transaction runner, Studio persistence over
real HTTP + PostgreSQL (including stale-revision 409 handling) and the transactional
outbox. The remaining integration files and the E2E suite were **not** run in this
pass, so this is a compatibility subset, not a full regression proof.

## 9. Open blockers and risk register deltas

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| R26 | `PUBLIC` function `EXECUTE` reachable by the platform role | Privileged owner code callable | Measured, open |
| — | Superuser migration owner in dev; `FORCE RLS` unproven for owners | Owner could bypass if misconfigured | Open |
| R35 | Views/materialized reports not covered by policy | Potential cross-tenant read if views are exposed | Open (excluded from contract) |
| R37 | Legacy runner still nests without savepoints | Old code can half-commit semantics | Unchanged, documented |
| ADR-PLAT-001 | Cross-installation proof with two databases | Installation isolation unproven | Open |
| — | No independent security review of this branch | Gate cannot pass | Open |
| — | A1–A8, G0 unsigned; owners unassigned | Program blocked for acceptance | Open |
| F-012 | Global RLS still not activated for CMS tables | Security review gate still conditional | Unchanged |

No finding was closed by documentation. No test was skipped to make the run green.

## 10. Gate decision

**NO-GO for Wave 1 exit and NO-GO for Wave 2 start.**

Passing evidence on this branch: kernel/tenancy unit and boundary tests, and a real
PostgreSQL tenant-isolation matrix through a least-privilege role. Missing evidence:
R26 remediation, non-superuser owner proof, views policy decision, cross-installation
negative tests, full CMS/Studio compatibility run, independent review, and named
human sign-offs. Wave 2 (M03) may not start under this gate.

## 11. Next steps (ordered)

1. Independent review of this branch and the three ADR proposals by a reviewer who is
   not the author; record findings as blocking or accepted with rationale.
2. R26: inventory functions, `SECURITY DEFINER` owners and `search_path`; produce a
   reviewed targeted-revocation migration with rollback; re-run the residual test
   expecting denial.
3. Provision a non-superuser owner role in the test fixture and prove owner reads
   fail closed with and without context.
4. Pin the two-publication CMS fixture (`pub_alpha`, `pub_beta`, `pub_default`) and
   run the full integration suite; record results against this branch SHA.
5. Decide the views/materialized-report contract (excluded for v1 unless reviewed).
6. Add two-database installation isolation test and Redis/S3 cross-install denial.
7. Only after the above: request human sign-off on ADR-PLAT-001/002/003 and the Wave 1
   gate. Do not start Wave 2 before that.

## Evidence index

- Baseline: [BASELINE-AND-OWNERSHIP-M00.md](BASELINE-AND-OWNERSHIP-M00.md)
- ADR-PLAT-001: [installation topology](adr/ADR-PLAT-001-installation-topology.md)
- ADR-PLAT-002: [identity vocabulary](adr/ADR-PLAT-002-identity-vocabulary.md)
- ADR-PLAT-003: [tenant transaction and RLS](adr/ADR-PLAT-003-tenant-transaction-rls.md)
- Program status: [PROGRAM-EXECUTION-STATUS.md](PROGRAM-EXECUTION-STATUS.md)
