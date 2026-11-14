# Wave 1 — Implementation and Security Report (M00–M02)

> **STATUS: IN PROGRESS — GATE DECISION: NO-GO.**
> This report records work executed on branch `feat/wave1-platform-kernel-tenant-isolation`
> cut from `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`, with the unmerged
> roadmap pinned at PR #151 head `c9997a9353a229a4287256f5ba3b94d718e3a5d9`.
> Nothing here authorizes public application hosting, tenant onboarding or production.

## 1. Executive status

| Item | Status |
| --- | --- |
| M00 baseline | **PARTIAL** — baseline, ownership map, ADR blockers, docs-link validator and CI wiring recorded; compatibility fixture pinning and named owners remain |
| M01 kernel | **IMPLEMENTED, UNREVIEWED** — public contracts, in-memory registry, persisted registry with manifest digests, kernel route execution adapter and a bootable standalone reference app exist and are tested; independent review and sign-off remain |
| M02 tenancy/security | **PARTIAL** — verified scope, default-deny policy, tenant unit of work, additive RLS migration, least-privilege role, real PostgreSQL deny matrix, non-superuser owner proof and two-database installation boundary exist; R26 revocation approval, deployment owner change, views policy and Redis/S3 boundary remain |
| Independent security review | **NOT PERFORMED** |
| Gate | **NO-GO** |

Deliberately **not** claimed: Wave 1 passed; ADRs accepted; production safe; CMS
compatibility proven end-to-end (the full Vitest integration suite passes; Playwright
E2E/acceptance has not run); no public or external tenant access.

## 2. Scope and pinned baseline

See [BASELINE-AND-OWNERSHIP-M00.md](BASELINE-AND-OWNERSHIP-M00.md). Summary:

- Host base: `5183f34f` on `main`; roadmap input: PR #151 (draft) `c9997a93`.
- Studio reference: `eda4c52e` (read-only; nothing in the Studio repo was modified).
- No existing tag, migration, audit record or issue status was rewritten.
- Migration `0054` is additive and appended to the journal; `0053` and earlier are untouched.
- Migration `0056` (persisted registry and membership directory) is additive and
  appended; `0055` stays reserved for the unapplied R26 proposal file.

## 3. Implemented code (real, compiled, tested)

| Area | Path | What it does |
| --- | --- | --- |
| Kernel identity | `packages/platform-kernel/src/identity.ts` | Branded Application/Tenant/Principal/Publication ids; `pub_default` rejected except for the legacy publication type; identifiers validated |
| Kernel contracts | `packages/platform-kernel/src/contracts.ts` | Request context, policy decision, domain event, action/route/module/application contracts with a scoped transaction port |
| Definition helpers | `packages/platform-kernel/src/application.ts` | `defineAction`/`defineRoute`/`defineModule`/`defineApplication`, route and action validation, kernel range check |
| Registry | `packages/platform-kernel/src/registry.ts` | In-memory application registry, duplicate protection, action/route resolution with path params |
| Application manifest | `packages/platform-kernel/src/manifest.ts` | Serializable manifest (no handler code), canonical SHA-256 digest, strict parser for manifests read back from storage |
| Persisted registry | `packages/database/src/platform-application-registry.ts` | Idempotent sync, drift refusal without an explicit update, integrity check on load, two-way deployed/persisted verification |
| Membership directory | `packages/database/src/platform-application-registry.ts` | `PlatformMembershipResolver` reads the operator-owned membership directory before a verified scope exists (runtime role denied) |
| Route executor | `packages/tenancy/src/executor.ts` | Route resolution, route-kind authentication, membership + policy authorization, verified scope, tenant unit of work, input parsing, stable error mapping |
| Registry migration | `packages/database/migrations/0056_platform_application_registry.sql` | Additive `platform_application_registrations` (digest check) and `platform_memberships` tables |
| Reference app | `apps/platform-reference` | Bootable Fastify app: manifest sync/verify, bearer-token principal directory, real CRM read/write actions over the tenant unit of work, operator bootstrap script |
| Verified scope | `packages/tenancy/src/scope.ts` | `verifyTenantScope`, `resolveVerifiedScope`, `assertVerifiedScope`; scope can only be produced by verification |
| Policy | `packages/tenancy/src/policy.ts` | Default-deny engine, deny precedence, exact/namespace/global permissions, cross-tenant denial |
| Unit of work | `packages/tenancy/src/unit-of-work.ts` | Single-connection transaction, transaction-local context set and read back, nested scope-switch rejection, rollback-only marking, error-probe before `COMMIT` |
| Schema | `packages/database/src/schema/platform-kernel.ts` | Application/installation/tenant tables and a tenant-owned CRM customers table with a composite `(tenant_id, application_id)` FK |
| Migration | `packages/database/migrations/0054_platform_tenant_rls.sql` | Additive tables and indexes, `ENABLE` + `FORCE` RLS, fail-closed `USING` and `WITH CHECK` policy |
| Runtime role | `packages/database/src/platform-runtime-role.ts` | Non-owner `NOBYPASSRLS` role: DML only on tenant table, no CREATE, no TRUNCATE/REFERENCES/TRIGGER, no registry access, role-level EXECUTE revoked |
| Boundary test | `tests/architecture/platform-boundaries.test.ts` | Kernel must not import outside itself; tenancy may import only the kernel plus Node/relative |
| Installation isolation test | `tests/integration/platform-installation-isolation.test.ts` | Two databases, each with its own non-superuser owner and runtime role, `CONNECT` revoked from `PUBLIC`, independent tenant rows |
| Platform test config | `vitest.platform.config.ts` | Isolated node-environment run without the CMS global setup |
| Reference app integration test | `tests/integration/platform-reference-app.test.ts` | Real PostgreSQL, runtime role and RLS through HTTP: registry drift/integrity, auth deny matrix, tenant-isolated create/list, registry and membership tables unreachable by the runtime role |

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
- Persisted registry tables are operator-owned. The runtime role has no privileges on
  `platform_application_registrations` or `platform_memberships`; the integration test
  asserts both fail with SQLSTATE `42501`.
- Handler code is never persisted. A registration stores the manifest plus its SHA-256
  digest; boot refuses a drift unless the deployment passes an explicit update, and
  `load` recomputes the digest so a tampered row fails closed.
- Tenant authorization requires both the server-verified principal grant and the
  tenant membership grant (`scope.authorization.permissions`) before the policy engine
  and unit of work run.
- Public (unauthenticated) actions receive a transaction that throws on any query.
  They cannot borrow an unscoped connection, so accidentally reading tenant data fails
  closed instead of bypassing RLS.

### Measured residual: function EXECUTE via `PUBLIC` (R26)

PostgreSQL grants `EXECUTE` on new functions to `PUBLIC`. A role-specific
`REVOKE ... FROM <role>` does not remove that effective grant. The integration test
`still executes owner-owned public functions through PUBLIC (R26 open)` proves the
platform runtime role **can** execute an owner-created function in `public`.

The read-only inventory is now done: 33 public functions, **0 `SECURITY DEFINER`**,
31 extension-owned `pg_trgm`, 2 trigger functions, all with default `PUBLIC` EXECUTE,
and no `pg_default_acl` policy. A targeted revocation and default-privilege change is
[proposed but not applied](R26-FUNCTION-EXECUTE-INVENTORY.md) — applying it is a
shared-database policy change that requires a production-shaped inventory and DB owner
approval. Two read-only regression guards assert no `SECURITY DEFINER` function is
reachable via `PUBLIC` and no runtime role owns functions.

### Measured: `FORCE RLS` against a non-superuser owner

A dedicated non-superuser owner role now owns a probe table with `ENABLE` +
`FORCE` RLS. The owner sees **0 rows** without tenant context, gets SQLSTATE
`42501` under `SET LOCAL row_security = off`, sees only the matching tenant under
context, and can still run DDL on its own table. `FORCE RLS` is therefore effective
against the owner, not just against the runtime role.

Residual deployment requirement: the dev/Compose migration role `vibress` is a
**superuser**, which would bypass `FORCE RLS`. Production topology must use a
non-superuser owner and re-verify there. Open blocker.

## 5. Tests and evidence (executed, with results)

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --config vitest.platform.config.ts` (unit + boundary + PostgreSQL integration) | **11 files / 107 tests passed** |
| `… tests/integration/platform-reference-app.test.ts` | **14 tests passed**: manifest sync/drift/integrity, HTTP auth deny matrix, tenant-isolated create/list, runtime role denied registry and membership tables (`42501`) |
| `… tests/integration/platform-installation-isolation.test.ts` | **8 tests passed**: cross-database `CONNECT` denied `42501`, same tenant id independent |
| `pnpm exec vitest run --config vitest.platform.config.ts packages/platform-kernel/src packages/tenancy/src tests/architecture` | **7 files / 61 tests passed** |
| `DATABASE_URL=postgresql://vibress:vibress@127.0.0.1:5433/vibress pnpm exec vitest run --config vitest.platform.config.ts tests/integration/platform-tenant-isolation.test.ts` | **1 file / 22 tests passed** against PostgreSQL 16 |
| `pnpm exec tsc -p packages/platform-kernel/tsconfig.json --noEmit` | passed |
| `pnpm exec tsc -p packages/tenancy/tsconfig.json --noEmit` | passed |
| `pnpm exec tsc -p packages/database/tsconfig.json --noEmit` | passed |
| `pnpm exec eslint packages/platform-kernel packages/tenancy tests/architecture tests/integration/platform-tenant-isolation.test.ts packages/database/src/platform-runtime-role.ts packages/database/src/schema/platform-kernel.ts` | passed, no output |
| `pnpm exec eslint` on the new registry store, executor, reference app and reference-app integration test | passed, no output |
| `pnpm exec nx run-many --target=typecheck --all --skip-nx-cache` | **73 projects succeeded**, 42.8 s |
| CMS compatibility subset (`runtime-multi-publication-isolation`, `content-database`, `transactions`, `studio-persistence-roundtrip`, `outbox`) | **5 files / 79 tests passed** in 14.45 s, including migration + seed global setup |
| **Unit/boundary/component suite** (`pnpm test:unit`, `vitest.unit.config.ts`) | **361 files / 2571 tests passed**, exit 0, 429.73 s |
| **Full integration suite** (`vitest.config.ts tests/integration`, also via `pnpm test:integration`) | **45 files / 518 tests passed**, exit 0, 122.87 s (two consecutive clean runs) |
| `pnpm docs:validate-links` (new docs validator, program docs) | **25 relative links across 7 files resolve** |
| Pre-existing `tests/integration/platform-packages.test.ts` under the root config | **26 tests passed** (runs under root aliases, not the platform config) |
| `node scripts/audit-function-privileges.mjs <url>` (read-only session) | 33 public functions, 0 `SECURITY DEFINER`, 33 `PUBLIC` EXECUTE, 0 default-ACL entries |

The PostgreSQL proof applies migration `0054`, provisions the runtime role, inserts
two tenants and two customers through the owner, then reconnects **as the runtime
role** for every assertion. A second non-superuser owner role owns a probe table with
`FORCE RLS` to prove owner fail-closed behavior. It cleans up its rows, both roles,
its owned objects and the probe table in `afterAll`; the DATABASE was checked
afterwards for leftover `platform_%` roles and probe relations.

## 6. Migration, data and rollback

- `0054_platform_tenant_rls.sql` only creates new tables/indexes and enables RLS on
  `platform_crm_customers`. It does not alter existing CMS tables.
- `0056_platform_application_registry.sql` only creates the registry and membership
  tables plus an index; it does not alter `0054` objects or CMS tables. `0055` is not
  used, keeping the number reserved for the unapplied R26 revocation proposal.
- Journal entries `idx 54` and `idx 55` appended; no earlier migration or checksum modified.
- Rollback: dropping the six new tables and the policy returns the database to the
  pre-0054 shape; no CMS data depends on them. No destructive command was executed
  against shared or production data.
- The runtime role provisioner now also revokes the registry and membership tables when
  they exist; it is still **not** wired into `migrate.ts` and is invoked explicitly, so
  no existing deployment silently gains or loses grants.

## 7. Compatibility

- Kernel/tenancy packages are additive and not imported by existing apps.
- `packages/database/src/index.ts` only adds exports; existing exports unchanged.
- The legacy runtime role, pooled `getDb()` and transaction runner are untouched.
- CMS compatibility evidence: the entire `tests/integration` suite passed on this
  branch (section 8). The Playwright E2E/acceptance suites were **not** run in this
  pass because they require staging secrets.

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
outbox.

### Full integration suite

```
DATABASE_URL=postgresql://vibress:vibress@127.0.0.1:5433/vibress \
REDIS_URL=redis://127.0.0.1:6380 \
pnpm exec vitest run --config vitest.config.ts tests/integration
```

Result: **45 files / 518 tests passed, exit 0, duration 122.87 s**, including migration
and seed global setup. The run exposed two deterministic defects, both fixed before the
green result:

1. The root `vitest.config.ts` did not alias `@vibress/platform-kernel` or
   `@vibress/tenancy`, so the full suite could not collect
   `platform-tenant-isolation.test.ts`. Both aliases were added and the three
   platform integration files now declare `@vitest-environment node`, so the Wave 1
   proof runs inside the standard suite as well as under `vitest.platform.config.ts`.
2. `translations-management.test.ts` resolved its fixture role with
   `eq(roles.name, "owner")` while the seed writes `name: "Owner"` and
   `key: "owner"`. It only passed on a dev database that still held a legacy
   lowercase row; after any suite re-seeded `roles` the lookup returned nothing, the
   test user got no permissions and every authenticated request returned 403
   (29 failures in the full run). The lookup now uses `roles.key`, matching every
   other suite; the `auth-database` → `translations-management` pair then passed
   44/44 in isolation.

The Playwright E2E/acceptance suites were **not** run (they require staging secrets),
so this is a full integration result, not an end-to-end browser proof.

**Run-isolation caveat (observed, not a defect):** one intermediate run reported
**2 failures in `setup.test.ts`** (legacy-backfill classification saw an empty
database) while taking 274 s instead of ~120 s. That run overlapped a second
integration suite started earlier against the same PostgreSQL database; the two
suites truncated the shared `users`/`installation` tables under each other. Two
subsequent sequential runs passed 45 files / 518 tests each. Integration suites must
not run concurrently against the shared dev database; the failure was environmental,
and no test assertions were changed.

**Tooling finding (fixed):** `pnpm test:integration` previously ran nothing —
`nx run-many --target=test:integration --all` reported "No tasks were run" because no
project exposes that target, while CI invoked `pnpm vitest run --no-file-parallelism`
directly. The script now runs `vitest run --no-file-parallelism tests/integration`
and was verified end to end: **45 files / 518 tests passed, exit 0**.

**Documentation validator (added, wired into CI):** `scripts/validate-docs-links.mjs`
checks that relative Markdown links resolve, skipping external URLs, `mailto:`,
`file:` and in-page anchors, and ignoring fenced code blocks and inline code spans.
`pnpm docs:validate-links` gates the active program docs (`docs/platform-roadmap`):
**25 links across 7 files resolve**. A full `node scripts/validate-docs-links.mjs docs`
audit reports **76 pre-existing broken links** in legacy `docs/reports`,
`docs/audits`, `docs/09-studio`, `docs/archive` and `docs/deployment` files (mostly
absolute `/vibress/...` paths); repairing those is a separate cleanup, so the gate is
scoped and the debt is recorded rather than hidden.

**CI wiring:** `.github/workflows/ci.yml` now runs `pnpm docs:validate-links` and splits
the former single test step into `pnpm test:unit` and `pnpm test:integration`. The
no-op `test:unit` Nx script was also replaced: `vitest.unit.config.ts` merges the root
config and excludes only `tests/integration/**`, so unit, boundary, component and
integration tests each run exactly once (no duplicated suite, no lost coverage).
Measured on this branch: **361 files / 2571 tests** (unit) + **45 files / 518 tests**
(integration), both exit 0.

The split surfaced a real fixture-hygiene bug: `apps/api/src/__tests__/operations-api.test.ts`
mutated `site/title`, `email/smtpHost`, `code/headerCode` and `security/passwordHash`
for `pub_default` without restoring them, which broke
`packages/domains/settings/tests/settings-isolation.test.ts` when it ran later. The
suite now snapshots `pub_default` settings in `beforeAll` and restores them
transactionally in `afterAll`; the pair passes 33/33 and 2/2, and the full unit suite
is green.

**M01 completion (persisted registry, route executor, reference app):** the kernel now
serializes an application definition without handler code and digests it. The
`PostgresApplicationRegistryStore` refuses drift unless the deployment explicitly allows
an update, recomputes the digest on load, and verifies the persisted and deployed sets in
both directions. `RouteExecutor` resolves a route, enforces route-kind authentication,
requires both the principal and the tenant membership to grant the action, resolves a
verified scope, and runs the handler inside the tenant unit of work. Public actions run
with a transaction that throws on any query. `apps/platform-reference` boots Fastify on
the persisted registry with a real CRM read/write surface and an operator bootstrap
script. Evidence: **11 files / 107 tests** in the platform suite, including **14**
PostgreSQL/HTTP tests in `platform-reference-app.test.ts`; registry and membership tables
are unreachable by the runtime role (`42501`). The only kernel contract change is the
additive `ActionContext.pathParameters`, so route templates now reach handlers.

## 9. Open blockers and risk register deltas

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| R26 | `PUBLIC` function `EXECUTE` reachable by the platform role | Privileged owner code callable | Inventoried; revocation proposed, **not applied** |
| — | Deployment owner (`vibress`) is a superuser, which bypasses `FORCE RLS` | Owner could bypass if left as-is | Test proven; deployment change open |
| R35 | Views/materialized reports not covered by policy | Potential cross-tenant read if views are exposed | Open (excluded from contract) |
| R37 | Legacy runner still nests without savepoints | Old code can half-commit semantics | Unchanged, documented |
| ADR-PLAT-001 | Redis key ACL/instance and object-storage boundary untested | Queue/object isolation unproven | Open (database boundary proven) |
| — | No independent security review of this branch | Gate cannot pass | Open |
| — | 76 pre-existing broken links in legacy docs outside `docs/platform-roadmap` | Docs rot; scoped validator hides the rest | Recorded; cleanup not started |
| — | Split CI test steps not yet exercised on GitHub Actions itself | Local unit + integration equivalents pass; runner ordering/services unproven | Pending first pipeline run |
| — | Playwright E2E/acceptance suites not run (staging secrets) | Browser-level regression unproven | Open |
| — | Reference app authenticates with an operator-configured static bearer-token directory | Not a production identity provider; no rotation or revocation API | Reference only; replace before shared deployment |
| — | Membership directory is not RLS-protected (it is read before a scope exists) | Auth infrastructure must read all memberships; tenant runtime role is denied the table | By design; needs a reviewed auth-service access model |
| — | No application/tenant provisioning API; only the reference bootstrap script and SQL | Operator workflow is manual | Open |
| — | Deployed manifest drift requires an explicit `allowUpdate` deployment action | A forgotten update fails boot (fail-closed), not silently | By design; deployment runbook needed |
| — | Registry changes have no audit record of the operator or previous digest | Drift is detected but not attributed | Open |
| — | Public actions cannot access the database at all | Public route surface limited to principal/tenant-independent handlers | By design until a reviewed unscoped-read contract exists |
| — | A1–A8, G0 unsigned; owners unassigned | Program blocked for acceptance | Open |
| F-012 | Global RLS still not activated for CMS tables | Security review gate still conditional | Unchanged |

No finding was closed by documentation. No test was skipped to make the run green.

## 10. Gate decision

**NO-GO for Wave 1 exit and NO-GO for Wave 2 start.**

Passing evidence on this branch: kernel/tenancy unit and boundary tests, a real
PostgreSQL tenant-isolation matrix through a least-privilege role, `FORCE RLS`
against a non-superuser owner, a two-database installation boundary, a persisted
registry with drift/integrity refusal, a bootable reference app serving tenant-isolated
reads and writes through the kernel executor, and the full `tests/integration` suite.
Missing evidence:
R26 revocation approval/application, non-superuser owner in the deployment topology, views policy
decision, Redis/S3 cross-installation denial, Playwright E2E/acceptance run,
independent review, and named human sign-offs. Wave 2 (M03) may not start under
this gate.

## 11. Next steps (ordered)

1. Independent review of this branch and the three ADR proposals by a reviewer who is
   not the author; record findings as blocking or accepted with rationale.
2. R26: run the inventory against a production-shaped role set, get DB/security
   approval, then apply [proposals/0055_revoke_public_execute.sql](proposals/0055_revoke_public_execute.sql)
   and re-run the residual test expecting denial; keep the documented rollback ready.
3. Change the deployment owner from the superuser `vibress` role to a non-superuser
   owner and re-run the owner RLS proof there.
4. Replace the reference app's static token directory with a real identity provider,
   and wire manifest sync plus platform-runtime-role provisioning into the deployment
   runbook (including the explicit `allowUpdate` step for manifest changes).
5. Run the Playwright E2E/acceptance suites against staging (requires secrets) to
   complete end-to-end compatibility; the full Vitest integration suite already
   passes on this branch SHA.
6. Decide the views/materialized-report contract (excluded for v1 unless reviewed).
7. Add Redis/S3 cross-installation denial tests (database boundary is already
   proven); confirm queue keys and objects cannot cross installations.
8. Only after the above: request human sign-off on ADR-PLAT-001/002/003 and the Wave 1
   gate. Do not start Wave 2 before that.

## Evidence index

- Baseline: [BASELINE-AND-OWNERSHIP-M00.md](BASELINE-AND-OWNERSHIP-M00.md)
- ADR-PLAT-001: [installation topology](adr/ADR-PLAT-001-installation-topology.md)
- ADR-PLAT-002: [identity vocabulary](adr/ADR-PLAT-002-identity-vocabulary.md)
- ADR-PLAT-003: [tenant transaction and RLS](adr/ADR-PLAT-003-tenant-transaction-rls.md)
- R26: [function EXECUTE inventory](R26-FUNCTION-EXECUTE-INVENTORY.md) and [proposed revocation](proposals/0055_revoke_public_execute.sql)
- Program status: [PROGRAM-EXECUTION-STATUS.md](PROGRAM-EXECUTION-STATUS.md)
