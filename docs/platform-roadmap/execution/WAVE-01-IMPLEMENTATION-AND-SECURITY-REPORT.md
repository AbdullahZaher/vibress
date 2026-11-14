# Wave 1 — Implementation and Security Report (M00–M02)

> **STATUS: IN PROGRESS — GATE DECISION: NO-GO.**
> This report records work executed on branch `feat/wave1-platform-kernel-tenant-isolation`
> cut from `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`, with the unmerged
> roadmap pinned at PR #151 head `c9997a9353a229a4287256f5ba3b94d718e3a5d9`.
> Measured evidence in §5 is current for the W1-T09 remediation increment on
> 2026-11-14 (uncommitted working tree on top of `fd64eb0a0499c20987483fa210f1d45556f8fa7b`,
> which already contains the W1-T01/W1-T03 increment). The W1-T02, W1-T04,
> W1-T08 and W1-T09 increments in this working tree are not yet committed. W1-T05 is
> preparation only: the read-only inventory was re-run and an approval request
> plus a hardened proposal exist, but **no grant was applied**.
> Nothing here authorizes public application hosting, tenant onboarding or production.

## 1. Executive status

| Item | Status |
| --- | --- |
| M00 baseline | **PARTIAL** — baseline, ownership map, ADR blockers, docs-link validator and CI wiring recorded, legacy docs links cleaned and a digest-pinned CMS/Studio fixture pack added; named owners remain |
| M01 kernel | **IMPLEMENTED, UNREVIEWED** — public contracts, in-memory registry, persisted registry with manifest digests, atomic installation binding (conflicting binds mutate nothing), hardened runtime-role boot verification (both identities, role membership, DDL authority, ownership, registry ACLs, SECURITY DEFINER EXECUTE), kernel route execution adapter, and a bootable standalone reference app whose owner-only registration phase is closed before the socket binds and whose membership reads use a dedicated SELECT-only reader role; independent review and sign-off remain |
| M02 tenancy/security | **PARTIAL** — verified scope, default-deny policy, tenant unit of work with scope-mutation and role-switch detection, async-escape rejection, connection destruction on unknown session state and a pre-commit role identity probe, additive RLS migration, least-privilege role, real PostgreSQL deny matrix, non-superuser owner proof and two-database installation boundary exist; R26 revocation approval, deployment owner change, views policy and Redis/S3 boundary remain |
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
| Persisted registry | `packages/database/src/platform-application-registry.ts` | Idempotent sync, drift refusal without an explicit update, race-safe CAS update, integrity check on load, two-way deployed/persisted verification, atomic installation binding (guarded upsert; a conflicting bind changes no row, concurrent conflicts have one winner, unregistered applications create nothing) |
| Membership directory | `packages/database/src/platform-application-registry.ts`, `platform-membership-reader.ts` | `PlatformMembershipResolver` reads the operator-owned membership directory before a verified scope exists; the runtime role is denied the table and serving reads use a dedicated reader role with table-level SELECT on `platform_memberships` only |
| Membership reader role | `packages/database/src/platform-membership-reader.ts` | Provisioner and boot assertion for the non-owner reader: SELECT on `platform_memberships`, no privilege on registry, tenant, CMS or other relations, sequences or SECURITY DEFINER functions; unsafe readers refuse boot |
| Route executor | `packages/tenancy/src/executor.ts` | Route resolution, route-kind authentication, membership + policy authorization, verified scope, tenant unit of work, input parsing, stable error mapping |
| Registry migration | `packages/database/migrations/0056_platform_application_registry.sql` | Additive `platform_application_registrations` (digest check) and `platform_memberships` tables |
| Registry change audit | `packages/database/migrations/0057_platform_registry_change_audit.sql`, `packages/database/src/platform-application-registry.ts` | Append-only `platform_application_registry_changes` (FK `ON DELETE RESTRICT`, shape/format checks); `sync` writes the `created`/`updated` row in the same SQL statement as the mutation, requires an actor for mutations, and writes nothing for `unchanged` or refused drift; `listChanges` reads the history |
| Operator scripts | `scripts/provision-platform-roles.ts`, `scripts/start-platform-reference-e2e.ts` | Idempotent platform-role provisioning with post-provision attribute verification; reference-app E2E lifecycle over real PostgreSQL with per-run roles and cleanup |
| Reference app | `apps/platform-reference` | Bootable Fastify app: owner-only registration phase (manifest sync/verify, installation binding) whose pool is closed before listening, runtime and reader safety assertions at boot, bearer-token principal directory, real CRM read/write actions over the tenant unit of work, operator bootstrap script |
| Verified scope | `packages/tenancy/src/scope.ts` | `verifyTenantScope`, `resolveVerifiedScope`, `assertVerifiedScope`; scope can only be produced by verification |
| Policy | `packages/tenancy/src/policy.ts` | Default-deny engine, deny precedence, exact/namespace/global permissions, cross-tenant denial |
| Unit of work | `packages/tenancy/src/unit-of-work.ts` | Single-connection transaction, transaction-local context set and read back, nested scope-switch rejection, rollback-only marking, error/identity probe before `COMMIT`, rejection of role switching and post-settlement queries, connection destruction when `ROLLBACK`/`COMMIT` fails, the transaction is aborted with work in flight, or the role changed |
| Schema | `packages/database/src/schema/platform-kernel.ts` | Application/installation/tenant tables and a tenant-owned CRM customers table with a composite `(tenant_id, application_id)` FK |
| Migration | `packages/database/migrations/0054_platform_tenant_rls.sql` | Additive tables and indexes, `ENABLE` + `FORCE` RLS, fail-closed `USING` and `WITH CHECK` policy |
| Runtime role | `packages/database/src/platform-runtime-role.ts` | Non-owner `NOBYPASSRLS` role: DML only on tenant table, no CREATE, no TRUNCATE/REFERENCES/TRIGGER, no registry access, role-level EXECUTE revoked; boot assertion fails closed on unsafe `current_user`/`session_user`, privileged membership/SET ROLE, schema/database CREATE, ownership, registry table/column ACLs and executable SECURITY DEFINER functions |
| Boundary test | `tests/architecture/platform-boundaries.test.ts` | Kernel must not import outside itself; tenancy may import only the kernel plus Node/relative; relative imports that escape a package root are violations; a missing or empty source directory fails instead of passing silently |
| Installation isolation test | `tests/integration/platform-installation-isolation.test.ts` | Two databases, each with its own non-superuser owner and runtime role, `CONNECT` revoked from `PUBLIC`, independent tenant rows |
| Platform test config | `vitest.platform.config.ts` | Isolated node-environment run without the CMS global setup |
| Reference app integration test | `tests/integration/platform-reference-app.test.ts` | Real PostgreSQL, runtime and reader roles, and RLS through HTTP: registry drift/integrity, conflicting installation binds that mutate nothing, unregistered-application refusal, one-winner conflict races, auth deny matrix, tenant-isolated create/list, registry and membership tables unreachable by the runtime role, six real-role privilege refusals, owner pool closed before listen, reader denied writes and every other relation, unsafe-reader boot refusal |

No placeholder handlers, no skipped tests, no lowered thresholds. `packages/platform-kernel`
and `packages/tenancy` are workspace packages at `1.2.0` and are **private**, matching
the existing SDK reality rather than implying a published release.

## 4. Security design and measured behavior

The contract and measured PostgreSQL matrix are in
[ADR-PLAT-003](adr/ADR-PLAT-003-tenant-transaction-rls.md). Key properties:

- No tenant read/write without a verified scope; pooled `getDb()` is not used by the
  new path, and the legacy path is unchanged and still ungoverned (documented risk).
- Context is applied with `set_config(..., true)` on the **same** connection and read
  back; mismatch aborts. Raw `set_config`/`SET` through the scoped handle is rejected
  after SQL comments are stripped, including `pg_catalog.set_config`, quoted GUC names,
  `SET SESSION`/`SET LOCAL` and `RESET ALL`; a detected attempt also marks the
  transaction rollback-only so it cannot commit.
- Database role switching through the scoped handle is rejected after the same comment
  stripping: `SET [LOCAL|SESSION] ROLE`, `SET [LOCAL|SESSION] AUTHORIZATION`,
  `RESET ROLE`, `RESET SESSION AUTHORIZATION` and
  `set_config('role'|'session_authorization', ...)`. Independently of pattern matching,
  the pre-commit probe re-reads `current_user` and `session_user` and compares them with
  the values captured at `BEGIN`; a mismatch aborts and **destroys** the connection,
  because role changes survive `ROLLBACK`.
- Unawaited work cannot outlive the transaction. The scoped handle is sealed as soon as
  the awaited callback settles: queries from an escaped continuation are rejected, and a
  query still in flight at settlement fails the unit of work closed and **destroys** the
  connection (ROLLBACK would only queue behind the escaped query), so no other tenant
  can inherit it.
- A connection is destroyed instead of returned to the pool whenever its session state
  is unknown: `ROLLBACK` failed, `COMMIT` failed, or the transaction aborted with work
  still in flight.
- The serving process verifies its runtime credentials at boot: the role must be a
  non-superuser, must not have `BYPASSRLS`, must not own tenant or registry tables, and
  must differ from the owner used for registry writes.
- Owner credentials are confined to the registration phase. The owner pool runs manifest
  sync, registry verification and installation binding, is closed before the socket
  binds, and is not reachable from request handling. Membership lookups run on a
  separate reader role that holds table-level `SELECT` on `platform_memberships` and no
  privilege on any other relation, sequence or SECURITY DEFINER function. An unsafe
  reader refuses boot before the owner phase runs.
- Nested scope switches mark the outer transaction rollback-only and always trigger
  `ROLLBACK`, even when the caller swallows the error.
- A swallowed PostgreSQL error is detected with a probe query before `COMMIT`.
- RLS policy fails closed when `vibress.application_id`/`vibress.tenant_id` are
  missing or empty and is applied to both `USING` and `WITH CHECK`.
- Role is non-owner, `NOBYPASSRLS`, denied `CREATE`, `TRUNCATE`, registry access and
  CMS tables.
- Persisted registry tables are operator-owned. The runtime role has no privileges on
  `platform_application_registrations` or `platform_memberships`; the integration test
  asserts both fail with SQLSTATE `42501`. The reader role can select memberships but
  is denied writes (`42501`) and is denied `platform_applications`,
  `platform_installations`, `platform_tenants`, `platform_application_registrations`
  and the tenant CRM table.
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

The read-only inventory is now done and was re-measured on
2026-11-14T19:12:39.618Z with identical totals: 33 public functions, **0
`SECURITY DEFINER`**, 31 extension-owned `pg_trgm`, 2 trigger functions, all with
default `PUBLIC` EXECUTE, and no `pg_default_acl` policy. A targeted revocation
and default-privilege change is [proposed but not applied](R26-FUNCTION-EXECUTE-INVENTORY.md).
The exact [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) separates Scope A
(`PUBLIC` revocation, proposal 0055) from Scope B (the legacy `vibress_app` role's
explicit `GRANT EXECUTE ON ALL FUNCTIONS` and function default grant, re-created by
`provisionRuntimeRole` on every migration). **Scope A alone would not close R26 for
that legacy role.** Applying either scope is a shared-database policy change that
requires a production-shaped inventory, DB owner approval, and flipping the
residual test to expect `42501` in the same change. Two read-only regression
guards assert no `SECURITY DEFINER` function is reachable via `PUBLIC` and no
runtime role owns functions.

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
| `pnpm exec vitest run --config vitest.platform.config.ts` (unit + boundary + PostgreSQL integration) | **11 files / 140 tests passed** (current W1-T09 tree) |
| `… tests/integration/platform-reference-app.test.ts` | **36 tests passed**: manifest sync/drift/CAS/integrity, registry change audit (created/updated attributed atomically, unchanged/refused writes nothing, actor required, audit history blocks application deletion), conflicting installation bind mutating nothing, unregistered-application refusal, one-winner concurrent bind, HTTP auth deny matrix, runtime role verified non-superuser/no-bypassrls/non-owner, tenant-isolated create/list, runtime role denied registry and membership tables (`42501`), six runtime-role refusals (privileged membership, schema CREATE, registry SELECT, function ownership, SECURITY DEFINER EXECUTE, unsafe `session_user` after SET ROLE), owner pool closed before listen, reader SELECT on memberships and denied writes/other relations (`42501`), three unsafe-reader refusals and an unsafe-reader boot refusal |
| `… tests/integration/platform-installation-isolation.test.ts` | **8 tests passed**: cross-database `CONNECT` denied `42501`, same tenant id independent |
| `pnpm exec vitest run --config vitest.platform.config.ts packages/platform-kernel/src packages/tenancy/src tests/architecture` | **7 files / 70 tests passed** |
| `DATABASE_URL=postgresql://vibress:vibress@127.0.0.1:5433/vibress pnpm exec vitest run --config vitest.platform.config.ts tests/integration/platform-tenant-isolation.test.ts` | **1 file / 24 tests passed** against PostgreSQL 16 (22 deny-matrix tests + 2 W1-T04 escape/role-switch tests) |
| `pnpm exec tsc -p packages/platform-kernel/tsconfig.json --noEmit` | passed |
| `pnpm exec tsc -p packages/tenancy/tsconfig.json --noEmit` | passed |
| `pnpm exec tsc -p packages/database/tsconfig.json --noEmit` | passed |
| `pnpm exec nx run-many --target=typecheck --projects=@vibress/tenancy,@vibress/database,@vibress/platform-reference --skip-nx-cache` | **3 projects succeeded**, 4.5 s |
| `pnpm exec eslint packages/platform-kernel packages/tenancy tests/architecture tests/integration/platform-tenant-isolation.test.ts packages/database/src/platform-runtime-role.ts packages/database/src/schema/platform-kernel.ts` | passed, no output |
| `pnpm exec eslint` on the new registry store, executor, reference app and reference-app integration test | passed, no output |
| `pnpm exec nx run-many --target=typecheck --all --skip-nx-cache` | **74 projects succeeded**, 42.7 s |
| CMS compatibility subset (`runtime-multi-publication-isolation`, `content-database`, `transactions`, `studio-persistence-roundtrip`, `outbox`) | **5 files / 79 tests passed** in 14.45 s, including migration + seed global setup |
| `pnpm exec vitest run tests/unit/cms-studio-fixture-pack.test.ts` | **4 tests passed** — pinned digest, drift refusal, deterministic encoding |
| `pnpm exec vitest run tests/integration/platform-cms-studio-fixture-pack.test.ts` | **3 tests passed** over HTTP + PostgreSQL — per-publication pinned documents, non-disclosing cross-publication read/write, Studio round-trip and pinned restore |
| **Unit/boundary/component suite** (`pnpm test:unit`, `vitest.unit.config.ts`) | **362 files / 2584 tests passed**, exit 0, 208.17 s |
| **Full integration suite** (`vitest.config.ts tests/integration`, also via `pnpm test:integration`) | **46 files / 542 tests passed**, exit 0, 95.35 s wall (59.92 s of test execution), run sequentially |
| `pnpm docs:validate-links` (docs validator, program docs) | **87 relative links across 12 files resolve** |
| `node scripts/validate-docs-links.mjs docs` (full tree) | **659 relative links across 300 files resolve** |
| `DATABASE_URL=… pnpm test:e2e:platform-reference` (Playwright, API request context) | **8 tests passed**: public health, missing/unknown principal 401, missing tenant 400, member-on-staff 403, invalid input 400, tenant-scoped create/list, cross-tenant 403, second tenant empty through RLS; harness created and dropped its roles and rows |
| `pnpm platform:provision-roles` against the dev fixture (throwaway roles) | Provisioned, then verified runtime role denied registry/membership/installation tables and `CREATE`; reader SELECT-only on memberships; both dropped, `pg_default_acl` back to 0 |
| Pre-existing `tests/integration/platform-packages.test.ts` under the root config | **26 tests passed** (runs under root aliases, not the platform config) |
| `node scripts/audit-function-privileges.mjs <url>` (read-only session) | 33 public functions, 0 `SECURITY DEFINER`, 33 `PUBLIC` EXECUTE, 0 default-ACL entries |
| `tsc` (workspace options) + ESLint on the W1-T09 scripts, Playwright config and spec | passed, no output |

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
- `0057_platform_registry_change_audit.sql` only adds the append-only change-audit
  table and its index, with an `ON DELETE RESTRICT` FK to the application row. No
  existing table or row is rewritten.
- Journal entries `idx 54`, `idx 55` and `idx 56` (migration `0057`) appended; no earlier
  migration or checksum modified.
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
  branch (section 8). The reference-app Playwright suite **was** run locally on the dev fixture
  (8 API-level tests, no staging secrets); the broader CMS Playwright
  E2E/acceptance suites were **not** run because they require staging secrets.

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

Result: **45 files / 530 tests passed, exit 0, duration 89.94 s**, including migration
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

The reference-app Playwright suite was run separately (`pnpm test:e2e:platform-reference`,
**8/8 passed**) against a real PostgreSQL-backed reference app; the broader CMS
Playwright E2E/acceptance suites were **not** run (they require staging secrets), so
this is a full integration result plus a reference-app network proof, not a full CMS
browser proof.

**Run-isolation caveat (observed, not a defect):** one intermediate run reported
**2 failures in `setup.test.ts`** (legacy-backfill classification saw an empty
database) while taking 274 s instead of ~120 s. That run overlapped a second
integration suite started earlier against the same PostgreSQL database; the two
suites truncated the shared `users`/`installation` tables under each other. Two
subsequent sequential runs passed (45 files / 518 tests at that commit; 45 files /
521 tests after the review-remediation commit; 45 files / 530 tests after the
W1-T01/W1-T03 increment; 45 files / 537 tests after W1-T02; 45 files / 539 tests
after W1-T04; 46 files / 542 tests after W1-T08). Integration suites must
not run concurrently against the shared dev database; the failure was environmental,
and no test assertions were changed.

**Tooling finding (fixed):** `pnpm test:integration` previously ran nothing —
`nx run-many --target=test:integration --all` reported "No tasks were run" because no
project exposes that target, while CI invoked `pnpm vitest run --no-file-parallelism`
directly. The script now runs `vitest run --no-file-parallelism tests/integration`
and was verified end to end: **45 files / 539 tests passed, exit 0**
(re-verified at W1-T08: **46 files / 542 tests passed, exit 0, 95.35 s**).

**Documentation validator (added, wired into CI):** `scripts/validate-docs-links.mjs`
checks that relative Markdown links resolve, skipping external URLs, `mailto:`,
`file:` and in-page anchors, and ignoring fenced code blocks and inline code spans.
`pnpm docs:validate-links` gates the active program docs (`docs/platform-roadmap`):
**40 links across 8 files resolve**. A full `node scripts/validate-docs-links.mjs docs`
audit initially reported **76 pre-existing broken links** in legacy `docs/reports`,
`docs/audits`, `docs/09-studio`, `docs/archive` and `docs/deployment` files (mostly
absolute `/vibress/...` paths). W1-T08 rewrote all 76 to relative targets (every
target already existed; no content was changed) and the validator now also resolves
the historical `/vibress/<path>` prefix against the repository root, so the full docs
tree validates: **612 links across 296 files resolve**.

**CI wiring:** `.github/workflows/ci.yml` now runs `pnpm docs:validate-links` and splits
the former single test step into `pnpm test:unit` and `pnpm test:integration`. The
no-op `test:unit` Nx script was also replaced: `vitest.unit.config.ts` merges the root
config and excludes only `tests/integration/**`, so unit, boundary, component and
integration tests each run exactly once (no duplicated suite, no lost coverage).
Measured on this branch: **362 files / 2584 tests** (unit, 208.17 s) + **46 files /
542 tests** (integration, 95.35 s), both exit 0.

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
script. The only kernel contract change is the additive `ActionContext.pathParameters`,
so route templates now reach handlers.

**Wave 1 review remediation (branch commit after the initial M01 evidence):** registry
sync now uses compare-and-swap so concurrent registrations cannot overwrite a digest that
moved, and installations are bound to one application (`syncInstallation` /
`verifyInstallation`, `InstallationMismatchError`). The reference app asserts its runtime
role at boot — non-superuser, no `BYPASSRLS`, no tenant/registry table ownership, and
different from the owner used for registry writes — via
`assertSafePlatformRuntimeRole`. Tenant scope-mutation detection strips SQL comments and
covers schema-qualified `set_config`, quoted GUCs, `SET SESSION`/`SET LOCAL` and
`RESET ALL`, marking the transaction rollback-only on detection. The architecture
boundary test now rejects relative imports that escape a package root and fails when a
source directory is missing or empty. Evidence after remediation: **11 files / 113
tests** in the platform suite, including **17** PostgreSQL/HTTP tests in
`platform-reference-app.test.ts`; registry and membership tables are unreachable by the
runtime role (`42501`).

**W1-T01 / W1-T03 remediation (current increment):** `assertSafePlatformRuntimeRole`
now inspects both `current_user` and `session_user` and fails closed on superuser,
BYPASSRLS, CREATEROLE, CREATEDB and REPLICATION attributes; membership in any such
role (SET ROLE escalation); CREATE on the public schema or database; database, schema,
table and function ownership; any table or column privilege on the five
registry/membership tables; TRUNCATE/REFERENCES/TRIGGER on the tenant table; and
EXECUTE on non-extension SECURITY DEFINER functions. Violations are returned as
structured codes. Installation binding is now a guarded upsert: a conflicting bind
returns zero rows and mutates nothing, concurrent conflicts have exactly one winner,
and an unregistered application fails with `InstallationApplicationMissingError`
without creating an application row. Evidence: platform suite **11 files / 122 tests**
(26 in `platform-reference-app.test.ts`, including nine new negative tests), unit
**361 files / 2574 tests**, integration **45 files / 530 tests**, workspace typecheck
74/74, targeted ESLint clean. Residuals: the artifact digest remains caller-supplied
(there is no provenance source yet), and `sync()` still updates the application name
before refusing manifest drift.

**W1-T02 remediation (previous increment):** the serving process no longer keeps owner
credentials after boot. `startReferenceApplication` verifies the runtime and reader
connections, runs manifest sync, two-way registry verification and installation binding
through the owner pool, then closes that pool **before** binding the socket. Requests
resolve memberships through a dedicated reader role provisioned with table-level
`SELECT` on `platform_memberships` only; registry provisioning revokes table, sequence
and function grants first. The reader boot assertion applies the runtime identity,
ownership and SECURITY DEFINER checks plus a reader profile: missing membership SELECT,
any membership write (including column-level), any privilege on another relation,
sequence or column, and any relation ownership all fail closed. Evidence: platform suite
**11 files / 129 tests** (33 in `platform-reference-app.test.ts`, including seven new
tests), unit **361 files / 2574 tests**, integration **45 files / 537 tests**, workspace
typecheck 74/74, targeted ESLint clean. The HTTP tests still pass while serving from the
reader pool, and the owner pool rejects queries after boot.

**W1-T04 remediation (current increment):** the tenant unit of work now enforces a
transaction trust boundary. The scoped handle is sealed when the awaited callback
settles, so a continuation that escaped the callback cannot query; a query still in
flight at settlement fails the unit of work and the connection is destroyed rather than
pooled or rolled back behind the escaped query. `SET [LOCAL|SESSION] ROLE`, `SET [LOCAL|SESSION] AUTHORIZATION`, `RESET ROLE`,
`RESET SESSION AUTHORIZATION` and `set_config('role'|'session_authorization', ...)` are
rejected and mark the transaction rollback-only after comment stripping. The pre-commit
probe re-reads `current_user`/`session_user` and compares them with the identity
captured at `BEGIN`; a change that evaded inspection aborts and destroys the connection,
because role changes survive `ROLLBACK`. A failed `ROLLBACK` or `COMMIT` also destroys
the connection. Evidence: platform suite **11 files / 137 tests** (six new unit tests,
two new real-PostgreSQL tests; tenant-isolation file **24/24**), unit **361 files /
2580 tests**, integration **45 files / 539 tests**, workspace typecheck 74/74, targeted
ESLint clean. The legacy `runInTransaction` nesting behavior is deliberately unchanged
(R37); the hardening applies to the scoped platform path.

**W1-T08 remediation (current increment):** CMS/Studio compatibility is now pinned
instead of implied. `tests/fixtures/cms-studio/fixture-pack.ts` holds a versioned pack
(two publications, staff templates, canonical Studio documents including a
`studio-card`, RTL Arabic content and inline linebreaks) whose SHA-256 digest is a
checked-in constant; `loadCmsStudioFixturePack()` fails closed on digest drift, missing
publications, duplicate keys, invalid documents, or a document the host editor cannot
safely rewrite. `provision.ts` seeds the pack into two run-scoped publications with
strict per-publication `owner` memberships (role looked up by key), and its teardown
removes revisions, content, memberships, publications, role bindings and users.
`tests/integration/platform-cms-studio-fixture-pack.test.ts` proves over real HTTP +
PostgreSQL that each publication serves its pinned document unchanged, a Studio save
round-trips and is restored to the pinned document, a cross-publication read/write is a
non-disclosing 404 identical to a random id, and a publication-header switch is
`PUBLICATION_ACCESS_DENIED`. The pack unit suite verifies the digest, drift refusal and
deterministic encoding. W1-T08 also rewrote the 76 legacy `/vibress/...` documentation
links to relative paths (all targets already existed) and produced the docs-only
[F-012 CMS RLS decision record](F-012-CMS-RLS-DECISION.md): option B (application-level
publication isolation for self-hosted v1, hard-gated multi-tenant hosting) is
**proposed, not accepted**; no RLS, grant or migration was changed. Evidence: fixture
unit **4 tests**; fixture integration **3 tests**; full docs link validation **612
links across 296 files**; `pnpm docs:validate-links` **40/8**; workspace typecheck
**74/74** (42.7 s); targeted ESLint clean.

**W1-T05 preparation (docs-only; no grant applied):** the R26 audit was re-run on
2026-11-14T19:12:39.618Z with the same totals (33 functions, 0 `SECURITY
DEFINER`, 31 extension-owned, 2 trigger functions, 33 `PUBLIC`-executable, 0
default ACLs, only the superuser role). The
[approval request](R26-REVOCATION-APPROVAL-REQUEST.md) states the exact decisions
for the DB and security owners: Scope A (proposal 0055: revoke `PUBLIC` on the two
trigger functions, install an owner default-function ACL revoke) and Scope B
(stop the legacy `vibress_app` role's explicit and default function grants, with
a `provisionRuntimeRole` code companion). Scope A alone would not close R26 for
the legacy role. Proposal 0055 was hardened with fail-closed verification blocks,
post-apply audit expectations, an extension-upgrade risk note and rollback; it
remains outside the migration journal. The residual test must be flipped to
expect `42501` in the same change that applies the revoke. No grant, migration,
audit record or runtime-provisioning code was changed. Docs links validate at
**659/300** (full tree) and **87/12** (platform-roadmap).

**W1-T09 increment (2026-11-14, uncommitted):** the registry change audit is
implemented with migration `0057`; `sync` now writes a `created`/`updated` audit
row in the same SQL statement as the mutation, requires an actor for mutations,
and writes nothing for `unchanged` or refused drift. Real-PostgreSQL tests prove
attribution, atomicity, the no-actor refusal and that audit history blocks
application deletion. The operator surface gained
`pnpm platform:provision-roles` (idempotent, refuses superuser targets, verifies
the provisioned attributes) and a
[boot/registry/deployment runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md). A dedicated
Playwright config and real-PostgreSQL lifecycle harness run the reference app over
HTTP: **8/8 passed** (public health, 401/400/403 deny paths, tenant-scoped
create/list, cross-tenant denial, second tenant empty through RLS), after which the
harness dropped its per-run roles and rows (`pg_default_acl` back to 0). The
[R40 version-identity decision record](R40-VERSION-IDENTITY-DECISION.md) and the
[ownership assignment request](OWNERSHIP-ASSIGNMENT-REQUEST.md) are prepared;
neither changes a tag, ADR status or gate. Current evidence: reference suite
**36 tests**, installation **8 tests**, tenant **24 tests**, platform config
**11 files / 140 tests**, full docs links **659/300** and **87/12**.

## 9. Open blockers and risk register deltas

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| R26 | `PUBLIC` function `EXECUTE` reachable by the platform role; legacy `vibress_app` additionally holds explicit function EXECUTE | Owner code callable without a reviewed grant | Inventoried and re-measured 2026-11-14; [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) prepared, revocation **not applied**; Scope B legacy grant open |
| — | Deployment owner (`vibress`) is a superuser, which bypasses `FORCE RLS` | Owner could bypass if left as-is | Test proven; deployment change open |
| R35 | Views/materialized reports not covered by policy | Potential cross-tenant read if views are exposed | Open (excluded from contract) |
| R37 | Legacy `runInTransaction` still nests without savepoints (the scoped tenant unit of work is hardened) | Old CMS code can half-commit semantics | Unchanged by design; documented |
| ADR-PLAT-001 | Redis key ACL/instance and object-storage boundary untested | Queue/object isolation unproven | Open (database boundary proven) |
| — | Owner credentials are present in the serving process environment for the one-shot registration phase (W1-T02) | A compromise during boot could reach operator tables | Bounded: the owner pool closes before listen and serving uses reader/runtime pools only; deployment must scope owner credentials to a boot step (runbook W1-T09) |
| — | Installation `artifact_digest` is caller-supplied; no CI/artifact provenance is verified | Digest can be absent or stale; it is not a security boundary | Open |
| — | Application name upsert ran before the drift decision | A refused boot could still rename an application | **Fixed (W1-T09)** — the name upsert runs only after a committed mutation or an observed `unchanged` state; refused drift writes nothing |
| — | No independent security review of this branch | Gate cannot pass | Open |
| — | 76 pre-existing broken links in legacy docs outside `docs/platform-roadmap` | Docs rot | **Resolved (W1-T08)** — rewritten to relative targets; full-docs validator passes 612 links / 296 files |
| — | Split CI test steps not yet exercised on GitHub Actions itself | Local unit + integration equivalents pass; runner ordering/services unproven | Pending first pipeline run |
| — | Broader CMS Playwright E2E/acceptance suites not run (staging secrets) | CMS browser-level regression unproven | Open; reference-app Playwright **8/8 passed** locally (W1-T09) |
| — | Reference app authenticates with an operator-configured static bearer-token directory | Not a production identity provider; no rotation or revocation API | Reference only; replace before shared deployment |
| — | Membership directory is not RLS-protected (it is read before a scope exists) | Auth infrastructure must read all memberships; tenant runtime role is denied the table | By design; needs a reviewed auth-service access model |
| — | No application/tenant provisioning API; platform-role provisioning is a CLI and tenant/membership seeding remains SQL/bootstrap | Operator workflow is manual | Provisioning CLI added; API open |
| — | Deployed manifest drift requires an explicit `allowUpdate` deployment action | A forgotten update fails boot (fail-closed), not silently | By design; documented in the [boot/registry runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md) (W1-T09) |
| — | Registry changes had no operator/digest audit | Drift was detected but not attributed | **Addressed (W1-T09)** — `platform_application_registry_changes` records actor, previous/new digest and version atomically with each create/update; `unchanged` writes nothing |
| — | Public actions cannot access the database at all | Public route surface limited to principal/tenant-independent handlers | By design until a reviewed unscoped-read contract exists |
| — | A1–A8, G0 unsigned; owners unassigned | Program blocked for acceptance | Open |
| F-012 | Global RLS still not activated for CMS tables | Security review gate still conditional | Open — [CMS disposition proposed](F-012-CMS-RLS-DECISION.md) (option B), not accepted; no RLS/grant change made |

No finding was closed by documentation. No test was skipped to make the run green.

## 10. Gate decision

**NO-GO for Wave 1 exit and NO-GO for Wave 2 start.**

Passing evidence on this branch: kernel/tenancy unit and boundary tests, a real
PostgreSQL tenant-isolation matrix through a least-privilege role, `FORCE RLS`
against a non-superuser owner, a two-database installation boundary, a persisted
registry with drift/integrity refusal, side-effect-free installation binding, hardened
runtime-role privilege assertions, a bootable reference app serving tenant-isolated
reads and writes through the kernel executor, an owner-free serving process with a
SELECT-only membership reader, a hardened tenant transaction trust boundary (async
escape, role-switch rejection, connection destruction), a digest-pinned two-publication
CMS/Studio compatibility pack proven over HTTP + PostgreSQL, a fully validating docs
tree, and the full `tests/integration` suite.
Missing evidence:
R26 revocation approval/application,
non-superuser owner in the deployment topology, views policy decision, F-012
disposition acceptance, Redis/S3 cross-installation denial, broader CMS Playwright
E2E/acceptance run, independent review, and named human sign-offs. Wave 2 (M03) may not start under
this gate.

## 11. Next steps (ordered)

1. Independent review of this branch and the three ADR proposals by a reviewer who is
   not the author; record findings as blocking or accepted with rationale.
2. R26: run the inventory against a production-shaped role set; answer
   [the approval request](R26-REVOCATION-APPROVAL-REQUEST.md) for Scope A
   ([proposals/0055_revoke_public_execute.sql](proposals/0055_revoke_public_execute.sql))
   and Scope B; then apply as the migration owner, flip the residual test to
   expect `42501`, re-run the audit and keep the documented rollback ready.
3. Change the deployment owner from the superuser `vibress` role to a non-superuser
   owner and re-run the owner RLS proof there.
4. Replace the reference app's static token directory with a real identity provider.
   Role provisioning, manifest sync/drift, audit review and owner-credential scoping
   are documented in the [boot/registry runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md).
5. Run the broader CMS Playwright E2E/acceptance suites against staging (requires
   secrets); the reference-app Playwright suite (8/8) and the full Vitest integration
   suite already pass on this branch.
6. Decide the views/materialized-report contract (excluded for v1 unless reviewed).
7. Accept or reject the [F-012 CMS RLS disposition](F-012-CMS-RLS-DECISION.md) with the
   security review owner and DB owner; acceptance does not activate RLS, and any
   multi-tenant hosting still requires the option-A RLS project first.
8. Add Redis/S3 cross-installation denial tests (database boundary is already
   proven); confirm queue keys and objects cannot cross installations.
9. Only after the above: request human sign-off on ADR-PLAT-001/002/003 and the Wave 1
   gate. Do not start Wave 2 before that.

## Evidence index

- Baseline: [BASELINE-AND-OWNERSHIP-M00.md](BASELINE-AND-OWNERSHIP-M00.md)
- ADR-PLAT-001: [installation topology](adr/ADR-PLAT-001-installation-topology.md)
- ADR-PLAT-002: [identity vocabulary](adr/ADR-PLAT-002-identity-vocabulary.md)
- ADR-PLAT-003: [tenant transaction and RLS](adr/ADR-PLAT-003-tenant-transaction-rls.md)
- R26: [function EXECUTE inventory](R26-FUNCTION-EXECUTE-INVENTORY.md), [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) and [proposed revocation](proposals/0055_revoke_public_execute.sql)
- F-012: [CMS RLS decision record](F-012-CMS-RLS-DECISION.md)
- Program status: [PROGRAM-EXECUTION-STATUS.md](PROGRAM-EXECUTION-STATUS.md)
