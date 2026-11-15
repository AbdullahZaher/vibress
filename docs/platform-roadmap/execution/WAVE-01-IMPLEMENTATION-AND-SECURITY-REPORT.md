# Wave 1 — Implementation and Security Report (M00–M02)

> **STATUS: IN PROGRESS — GATE DECISION: NO-GO.**
> This report records work executed on branch `feat/wave1-platform-kernel-tenant-isolation`
> cut from `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`, with the unmerged
> roadmap pinned at PR #151 head `c9997a9353a229a4287256f5ba3b94d718e3a5d9`.
> Measured evidence in §6 is current for the **P2 remediation increment**
> (commit `054ac8e6`), which defines the runtime function contract by exact
> signature and makes provisioning destroy a connection whose transaction state
> is unknown. It sits on top of the final remediation increment (`0f64936a`,
> CI run 43641264614 green) on top of `6b31320d` (PR #166). That earlier
> increment added the versioned runtime privilege contract, atomic
> provisioning, mandatory installation CAS with audit `0058`, the removal of
> privileged provisioning authority from the request-serving process and pinned
> read-only boot verification. W1-T05 remains preparation only: the read-only
> inventory was re-run and an approval request plus a hardened proposal exist,
> but **no grant was applied**.
> Nothing here authorizes public application hosting, tenant onboarding or production.

## 1. Executive status

| Item | Status |
| --- | --- |
| M00 baseline | **PARTIAL** — baseline, ownership map, ADR blockers, docs-link validator and CI wiring recorded, legacy docs links cleaned and a digest-pinned CMS/Studio fixture pack added; named owners remain |
| M01 kernel | **IMPLEMENTED, UNREVIEWED** — public contracts, in-memory registry, persisted registry with manifest digests, separate installation create/update with mandatory compare-and-swap and an append-only installation audit, a **versioned runtime privilege contract enforced on effective database authority, with function grants keyed by exact `schema.name(identity arguments)` signature**, **atomic provisioning on one connection and one transaction that destroys the connection whenever the transaction state is unknown**, a **separate operator provisioning executable** (owner credentials) and a **request-serving process that refuses `DATABASE_URL` and holds no provisioning authority**, pinned read-only boot verification through a dedicated SELECT-only verifier role, hardened runtime-role boot verification (both identities, **all SET-able role memberships**, DDL authority, ownership, registry ACLs, SECURITY DEFINER EXECUTE, contract-scoped relations/columns/sequences/schemas/functions), kernel route execution adapter, and a bootable standalone reference app using a dedicated SELECT-only membership reader; independent review and sign-off remain |
| M02 tenancy/security | **PARTIAL** — verified scope, default-deny policy, tenant unit of work with scope-mutation and role-switch detection, async-escape rejection, connection destruction on unknown session state and a pre-commit role identity probe, additive RLS migration, least-privilege role, real PostgreSQL deny matrix, non-superuser owner proof and two-database installation boundary exist; R26 revocation approval, deployment owner change, views policy, Redis/S3 boundary, production IdP and independent review remain |
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
- Migration `0056` (persisted registry and membership directory), `0057`
  (registry change audit) and `0058` (installation change audit) are additive and
  appended; `0055` stays reserved for the unapplied R26 proposal file.
- Current reviewed baseline: `b62ffdf5` (PR #166 head), then the remediation
  increments `6b31320d` and `0f64936a`, and the P2 increment `054ac8e6`. The P2
  increment changes no schema and no grant: it makes the runtime function
  contract exact by signature and hardens provisioning connection handling.
  Documentation updates follow the code SHA.

## 3. Implemented code (real, compiled, tested)

| Area | Path | What it does |
| --- | --- | --- |
| Kernel identity | `packages/platform-kernel/src/identity.ts` | Branded Application/Tenant/Principal/Publication ids; `pub_default` rejected except for the legacy publication type; identifiers validated |
| Kernel contracts | `packages/platform-kernel/src/contracts.ts` | Request context, policy decision, domain event, action/route/module/application contracts with a scoped transaction port |
| Definition helpers | `packages/platform-kernel/src/application.ts` | `defineAction`/`defineRoute`/`defineModule`/`defineApplication`, route and action validation, kernel range check |
| Registry | `packages/platform-kernel/src/registry.ts` | In-memory application registry, duplicate protection, action/route resolution with path params |
| Application manifest | `packages/platform-kernel/src/manifest.ts` | Serializable manifest (no handler code), canonical SHA-256 digest, strict parser for manifests read back from storage |
| Persisted registry | `packages/database/src/platform-application-registry.ts` | Idempotent sync, drift refusal without an explicit update, race-safe CAS update, integrity check on load, two-way deployed/persisted verification, and separate installation create/update operations: `registerInstallation` is one `INSERT ... ON CONFLICT DO NOTHING` with its `created` audit CTE; `updateInstallation` requires actor, non-empty reason, expected environment and expected artifact digest (mandatory CAS, `IS NOT DISTINCT FROM`) and writes its `updated` audit row in the same statement. Identical rows write nothing; conflicting application, missing/stale expectation or missing expected state writes nothing |
| Operator provisioning | `apps/platform-reference/src/registration.ts`, `scripts/provision-platform-reference.ts` | Owner-only executable: requires owner `DATABASE_URL`, environment, artifact digest, actor and change reason; runs `sync`, `verifyDefinitions`, the create/update installation mutation and the read-only identity proof in **one transaction on one checked-out connection**; an update additionally requires both expected-state values. The connection is destroyed (`release(true)`) when `BEGIN` failed, when `ROLLBACK` failed, or when a `COMMIT` was attempted and rejected, so an unknown transaction state never returns to the pool; a successful commit or a successful rollback returns a reusable connection. Never imported by the serving sources (architecture test) |
| Runtime privilege contract | `packages/database/src/platform-runtime-privilege-contract.ts` | Versioned, extensible allowlist (schema USAGE, relation grants by kind, sequence grants, function grants) with structural validation and unique keys. Contract version `2` identifies a function by schema, name and the exact `pg_get_function_identity_arguments` value, so overloads are separate entries and an unauthorized overload cannot inherit authority from an authorized name. The reference CRM profile is one instance, not a hardcoded policy. Runtime boot and provisioning verify **effective** authority (direct, inherited, `PUBLIC`) for relations, columns, sequences, schemas and executable functions outside the contract; a declared signature with no definition fails as `contract_function_missing`, and provisioning grants only the catalog-resolved signature |
| Deployment verifier | `packages/database/src/platform-deployment-verifier.ts`, `packages/database/src/platform-deployment-verification.ts` | Dedicated `NOBYPASSRLS` login with table-level `SELECT` on `platform_installations` and `platform_application_registrations` only; `verifyDeploymentIdentity` re-reads the installation and registration and fails closed on installation id, application id, environment, artifact digest or manifest digest mismatch. Read-only: it never creates, repairs or updates |
| Serving entrypoint | `apps/platform-reference/src/main.ts`, `start.ts`, `server.ts` | Refuses to run with `DATABASE_URL`; requires three **distinct** runtime/reader/verifier URLs plus environment and artifact digest; deletes the connection strings from the environment after constructing pools; asserts all three roles; closes the verifier pool after the boot proof; builds Fastify with no owner pool or registry authority |
| Membership directory | `packages/database/src/platform-application-registry.ts`, `platform-membership-reader.ts` | `PlatformMembershipResolver` reads the operator-owned membership directory before a verified scope exists; the runtime role is denied the table and serving reads use a dedicated reader role with table-level SELECT on `platform_memberships` only |
| Membership reader role | `packages/database/src/platform-membership-reader.ts` | Provisioner and boot assertion for the non-owner reader: SELECT on `platform_memberships`, no privilege on registry, tenant, CMS or other relations, sequences or SECURITY DEFINER functions; unsafe readers refuse boot |
| Route executor | `packages/tenancy/src/executor.ts` | Route resolution, route-kind authentication, membership + policy authorization, verified scope, tenant unit of work, input parsing, stable error mapping |
| Registry migration | `packages/database/migrations/0056_platform_application_registry.sql` | Additive `platform_application_registrations` (digest check) and `platform_memberships` tables |
| Registry change audit | `packages/database/migrations/0057_platform_registry_change_audit.sql`, `packages/database/migrations/0058_platform_installation_audit.sql`, `packages/database/src/platform-application-registry.ts` | Append-only `platform_application_registry_changes` and `platform_installation_changes` (both FKs `ON DELETE RESTRICT`, shape/format checks). Registry `created`/`updated` rows are written in the same SQL statement as the mutation. Installation mutations likewise write `created`/`updated` rows atomically with actor, reason, optional deployment reference, and previous/new environment and artifact digest. `unchanged` and refused mutations write nothing; `listChanges`/`listInstallationChanges` read the history |
| Operator scripts | `scripts/provision-platform-roles.ts`, `scripts/provision-platform-reference.ts`, `scripts/start-platform-reference-e2e.ts` | Idempotent provisioning of three distinct non-owner roles (runtime, reader, verifier) with post-provision attribute verification; separate installation/manifest provisioning executable; reference-app E2E lifecycle over real PostgreSQL with per-run roles and cleanup |
| Reference app | `apps/platform-reference` | Bootable Fastify app: runtime, reader and verifier safety assertions at boot, pinned read-only deployment verification, bearer-token principal directory, real CRM read/write actions over the tenant unit of work, operator provisioning and bootstrap scripts; the request server never receives owner credentials |
| Verified scope | `packages/tenancy/src/scope.ts` | `verifyTenantScope`, `resolveVerifiedScope`, `assertVerifiedScope`; scope can only be produced by verification |
| Policy | `packages/tenancy/src/policy.ts` | Default-deny engine, deny precedence, exact/namespace/global permissions, cross-tenant denial |
| Unit of work | `packages/tenancy/src/unit-of-work.ts` | Single-connection transaction, transaction-local context set and read back, nested scope-switch rejection, rollback-only marking, error/identity probe before `COMMIT`, rejection of role switching and post-settlement queries, connection destruction when `ROLLBACK`/`COMMIT` fails, the transaction is aborted with work in flight, or the role changed |
| Schema | `packages/database/src/schema/platform-kernel.ts` | Application/installation/tenant tables and a tenant-owned CRM customers table with a composite `(tenant_id, application_id)` FK |
| Migration | `packages/database/migrations/0054_platform_tenant_rls.sql` | Additive tables and indexes, `ENABLE` + `FORCE` RLS, fail-closed `USING` and `WITH CHECK` policy |
| Runtime role | `packages/database/src/platform-runtime-role.ts` | Non-owner `NOBYPASSRLS` role: DML only on tenant table, no CREATE, no TRUNCATE/REFERENCES/TRIGGER, no registry access, role-level EXECUTE revoked; boot assertion fails closed on unsafe `current_user`/`session_user`, **any SET-able role membership** (privileged, ordinary, indirect or `NOINHERIT`), schema/database CREATE, ownership, registry table/column ACLs and executable SECURITY DEFINER functions. It then enforces the versioned privilege contract on **effective** privileges: unexpected relation/view/foreign-table, column, sequence, schema or function authority fails, and provisioning revokes pre-existing grants outside the contract before re-granting |
| Boundary test | `tests/architecture/platform-boundaries.test.ts` | Kernel must not import outside itself; tenancy may import only the kernel plus Node/relative; relative imports that escape a package root are violations; a missing or empty source directory fails instead of passing silently; request-serving sources must not import the provisioning module or reference owner pools/registry stores |
| Deployment verification test | `tests/integration/platform-reference-app.test.ts` | Matching installation boots; environment/artifact/application-id/manifest drift fails before serving without mutation; the verifier is SELECT-only on the two registry tables and denied every other relation/write; the reader and verifier reject unexpected (including indirect/NOINHERIT) memberships; CAS-guarded provisioning leaves rows unchanged on mismatch; contract negatives reject unrelated table SELECT/UPDATE, column grants, `PUBLIC` grants, sequences, views (including an owner-context view), inherited role privileges, function `EXECUTE` and schema `USAGE`; re-provisioning revokes a pre-existing unrelated grant; function-identity tests cover an exact authorized signature, two explicit overloads, an unauthorized overload, an overload added after provisioning, `PUBLIC` EXECUTE on an unrelated function, an explicit grant on an unauthorized overload, SECURITY DEFINER, a refused non-existent signature, a signature change and a removed definition |
| Installation audit test | `tests/integration/platform-reference-app.test.ts` | Installation creation and update write attributed audit rows; registration/update are idempotent; missing actor/reason/expected state and wrong-application updates are refused without mutation; concurrent CAS updates have one winner and two audit rows |
| Provisioning connection safety test | `tests/integration/platform-reference-app.test.ts` | A successful commit returns a reusable pooled connection; a manifest registry failure rolls back and a retry succeeds; `BEGIN` failure, `ROLLBACK` failure, backend loss and an unknown `COMMIT` outcome each release the connection with `true` (destroy) and leave rows unchanged; the unknown-outcome case asserts only that the connection is never reused |
| Installation isolation test | `tests/integration/platform-installation-isolation.test.ts` | Two databases, each with its own non-superuser owner and runtime role, `CONNECT` revoked from `PUBLIC`, independent tenant rows |
| Platform test config | `vitest.platform.config.ts` | Isolated node-environment run without the CMS global setup |
| Reference app integration test | `tests/integration/platform-reference-app.test.ts` | Real PostgreSQL, runtime/reader/verifier roles, and RLS through HTTP: registry drift/integrity, conflicting installation binds that mutate nothing, one-winner conflict races, CAS-guarded operator updates, auth deny matrix, tenant-isolated create/list, registry/membership/installation tables unreachable by the runtime role, ten real-role privilege/membership refusals, owner-free serving start with byte-identical registry/installation rows, pinned environment/artifact/application/manifest drift failures before serving, verifier SELECT-only and denied writes/other relations, reader denied writes and every other relation, unsafe-reader boot refusal, and child-process refusal of `DATABASE_URL` / non-distinct credentials |

### Atomic provisioning tests

`provisionReferenceApplication` is exercised on one real PostgreSQL database:

- **Critical CAS rollback:** a manifest update and an installation update are issued together with a stale expected artifact digest. The command fails with `InstallationMismatchError`, and a before/after snapshot proves the registration digest/version, installation environment/artifact, installation audit count and registry audit count are all unchanged.
- **Audit failure rollback:** a temporary trigger forces the installation audit insert to fail. The command fails, no installation row or audit row exists, and the registration/registry audit snapshot is unchanged.
- **Idempotent retry:** provisioning the same deployment twice writes no second audit row and leaves the snapshot identical.
- **Concurrency:** two updates started from the same observed state produce exactly one CAS winner and two audit rows (create + one update); the loser's transaction writes nothing.
- **Connection safety:** a test fault-injection pool records the `release` argument. A successful commit returns the client to the pool; a manifest registry failure rolls back and a retry succeeds on a working pool; a failed `BEGIN`, a failed `ROLLBACK`, a terminated backend and a rejected `COMMIT` after the server may have committed all release with `true` (destroy). The terminated-backend case registers a transport-error listener for the simulated backend loss; the error the implementation handles is still the rejected awaited query.

No placeholder handlers, no skipped tests, no lowered thresholds. `packages/platform-kernel`
and `packages/tenancy` are workspace packages at `1.2.0` and are **private**, matching
the existing SDK reality rather than implying a published release.

## 4. Finding-by-finding remediation status

| Finding | Severity | Required outcome | Implemented evidence | Status |
| --- | --- | --- | --- | --- |
| P0-A — privileged DB/provisioning authority inside the long-lived server | P0 | Separate operator provisioning executable; server runs without `DATABASE_URL`; fail closed on bad installation/application/environment/artifact; privileged authority absent, not merely disconnected | `main.ts` refuses `DATABASE_URL`; `start.ts` has no owner pool and only runtime/reader/verifier; `registration.ts` + `provision-platform-reference.ts` are the operator-only path; architecture test rejects provisioning imports in serving sources; child-process tests exit 1 on `DATABASE_URL` and non-distinct URLs; read-only start leaves rows byte-identical | **Fixed in code; unreviewed** |
| P0-B — SET ROLE / inherited privilege closure | P0 | Reject full membership closure (direct, indirect, `NOINHERIT`), ownership, ACLs, column grants, SECURITY DEFINER, CREATE/TRUNCATE/REFERENCES; explicit no-unexpected-membership allowlist; reject before serving | `assertSafePlatformRuntimeRole`/reader/verifier inspect `current_user` and `session_user` with `pg_has_role(..., 'MEMBER')`; any non-self role yields `unexpected_role_membership`; real-PostgreSQL tests cover NOINHERIT, indirect and reader NOINHERIT memberships plus ownership/ACL/DEFINER negatives | **Fixed in code; unreviewed** |
| P1 — separate installation provisioning from runtime verification | P1 | Operator provisioning (CAS, audit); read-only verification that never creates/repairs; matching boot, conflicting app, env drift, artifact mismatch, concurrency, unauthorized update, read-only verification, audit accuracy | `provisionReferenceApplication` requires owner/actor/digest and applies CAS; `verifyDeploymentIdentity` is SELECT-only through the verifier; tests cover matching boot, environment/artifact/application/manifest drift without mutation, one-winner concurrent bind, CAS refusal leaving the row unchanged, unauthorized manifest update refusal, and registry audit attribution | **Fixed in code; unreviewed** |
| P1 — no unexpected effective database authority (runtime allowlist) | P1 | A versioned, extensible runtime privilege contract; boot and provisioning fail on any table, view, materialized view, foreign table, column, sequence, schema or function authority outside it, including authority inherited from `PUBLIC` or roles; no hardcoded CRM policy | `platform-runtime-privilege-contract.ts` (validated, versioned) plus effective-privilege inspection in `assertSafePlatformRuntimeRole`/`provisionPlatformRuntimeRole`; ten real-PostgreSQL negatives (unrelated CMS table SELECT and UPDATE, column grant, `PUBLIC` grant, sequence, view, owner-context view, inherited role privilege, function `EXECUTE`, schema `USAGE`) and a provisioning test that revokes a pre-existing unrelated grant | **Fixed in code; unreviewed** |
| P1 — provisioning transaction escape | P1 | One transaction on one connection; a failure after the manifest write must roll back manifest, installation and both audit streams; no independent pool queries inside the transaction | `provisionReferenceApplication` checks out one client, uses `BEGIN`/`COMMIT`/`ROLLBACK` and passes it to the store, `verifyDeploymentIdentity` and the installation mutations. Four integration tests: stale-CAS rollback (all snapshots identical), forced audit-insert failure (no rows), idempotent retry, and one-winner concurrent updates | **Fixed in code; unreviewed** |
| P1 — implicit installation updates / missing audit | P1 | Separate create and update; updates must prove the previous environment and artifact digest, name the operator, give a reason, and write an immutable transactional audit row | `registerInstallation`/`updateInstallation` split; mandatory CAS (`IS NOT DISTINCT FROM`), `InstallationChangeInputError` for missing/blank expected state or reason, `InstallationUpdateRequiredError` without the update flag; migration `0058` `platform_installation_changes` written in the same statement as the mutation | **Fixed in code; unreviewed** |
| P2 — runtime function authority matched by name, so an overload silently inherited it | P2 | Function authority must identify schema, name and exact argument signature; an unauthorized overload, a late-added overload, `PUBLIC` or explicit grants, SECURITY DEFINER and a changed or removed signature must fail; the contract must distinguish authorized from unauthorized overloads and leave applications without executable functions compatible | Contract version `2` with `identityArguments` from `pg_get_function_identity_arguments`, validated and unique per signature; provisioning resolves the catalog signature, grants only it and refuses a missing definition; boot adds `contract_function_missing`. Eleven real-PostgreSQL tests cover exact signature, two explicit overloads, unauthorized overload, overload added after provisioning, `PUBLIC` EXECUTE, explicit grant on an unauthorized overload, SECURITY DEFINER, refused non-existent signature, signature change and removed definition, plus contract-validation negatives | **Fixed in code; unreviewed** |
| P2 — provisioning swallowed a failed `ROLLBACK` and always returned the connection | P2 | `BEGIN` before mutations on one connection; `COMMIT` only after verification; `ROLLBACK` on failure; discard the connection when `BEGIN`, `ROLLBACK` or `COMMIT` outcome is unknown; no unsafe pooled reuse; successful rollback returns a reusable connection; keep CAS, concurrency and audit guarantees | `provisionReferenceApplication` tracks `beginSucceeded`, `commitAttempted` and `destroyConnection` and calls `client.release(true)` on any unknown state; six tests use a fault-injection pool that records the release argument (successful commit reuse, rollback + retry, `BEGIN` failure, `ROLLBACK` failure, terminated backend, unknown `COMMIT` outcome) | **Fixed in code; unreviewed** |
| R26 — `PUBLIC` function EXECUTE | P0 | Apply an approved revocation and verify | Read-only inventory + [approval request](R26-REVOCATION-APPROVAL-REQUEST.md); proposal 0055 remains unapplied | **Blocked: owner approval required** |
| F-012 — CMS tables not RLS-protected | P1 | Owner decision | [Decision record](F-012-CMS-RLS-DECISION.md) proposes option B; nothing changed | **Open: owner decision required** |
| Production-shaped Redis/S3/queue/secrets isolation | P1 | Cross-installation denial proof | No production-shaped infrastructure authorized | **Blocked: infrastructure authorization** |
| Production identity provider | P1 | Replace static bearer directory | Reference-only token directory remains | **Blocked: IdP/secret authorization** |

A prepared but unapplied migration does not close R26; no items in this table are
claimed as accepted, signed or independently reviewed.

## 5. Security design and measured behavior

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
- **Privileged provisioning authority is absent from the request-serving process.**
  Owner/migration credentials are used only by `scripts/provision-platform-reference.ts`
  (`pnpm platform:provision-reference`) and the role/tenant bootstraps. The serving
  entrypoint (`main.ts`) exits if `DATABASE_URL` is present, requires three distinct
  least-privilege URLs, and `start.ts`/`server.ts` accept no owner pool or registry
  store. A source-boundary test rejects imports of the provisioning module or owner
  identifiers from the serving sources. Starting and serving therefore cannot create,
  repair or update a registry row or installation.
- Boot verification is **pinned and read-only**: the runtime, membership reader and
  deployment verifier roles are asserted first (three distinct identities), then
  `verifyDeploymentIdentity` reads the installation and registration through the
  verifier role and fails closed on installation id, application id, environment,
  artifact digest or manifest digest mismatch. The verifier pool is closed before the
  socket binds and nothing is mutated on any path. Real-PostgreSQL tests compare the
  installation and registration rows before and after a successful and a refused boot
  and find them byte-identical (including timestamps).
- The runtime assertion rejects **any** SET-able role membership, not only privileged
  ones: ordinary, indirect (through a middle role) and `NOINHERIT` grants all produce
  `unexpected_role_membership`; membership in a superuser/BYPASSRLS/CREATEROLE/
  CREATEDB/REPLICATION role produces `privileged_role_membership`. This closes the
  "activate a different role later" path even when the membership is not currently
  inherited. The reader and verifier apply the same closure.
- Membership lookups run on a separate reader role that holds table-level `SELECT` on
  `platform_memberships` and no privilege on any other relation, sequence or SECURITY
  DEFINER function. An unsafe reader refuses boot.
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
  digest; serving boot refuses **any** mismatch and offers no update path. Only the
  operator provisioning executable can accept a manifest update (explicit flag plus
  actor, CAS on the observed digest); `load` recomputes the digest so a tampered row
  fails closed.
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

## 6. Tests and evidence (executed, with results)

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --config vitest.platform.config.ts` (unit + boundary + PostgreSQL integration, **P2 remediation tree**) | **11 files / 191 tests passed**, 8.65 s, exit 0, no unhandled errors |
| `… tests/integration/platform-reference-app.test.ts` (**P2 remediation tree**) | **86 tests passed**: all prior registry/CAS/audit/HTTP/RLS evidence plus owner-free start with byte-identical installation and registration rows including timestamps; pinned environment/artifact/application-id/manifest drift each raise `DeploymentVerificationError` before serving with the row unchanged; verifier SELECT-only on the two registry tables and denied writes (`42501`) and every other relation; runtime/reader/verifier reject privileged, ordinary, indirect and `NOINHERIT` memberships; child-process start exits 1 with `DATABASE_URL` set and with three equal connection URLs; architecture test rejects provisioning imports in serving sources; contract/provisioning tests (ten real-PostgreSQL negatives plus a pre-existing-grant revocation) and **11 signature-identity tests** (exact signature authorized; two explicit overloads authorized; unauthorized overload, `PUBLIC` EXECUTE on an unrelated function, explicit grant on an unauthorized overload, SECURITY DEFINER, late-added overload, changed signature and removed definition refused; provisioning refuses a non-existent signature; contract version/identity validation); 4 prior atomic-provisioning tests plus **6 connection-safety tests** (successful commit reuse, rollback + retry, failed `BEGIN`, failed `ROLLBACK`, terminated backend, unknown `COMMIT` outcome) |
| `… tests/architecture/platform-boundaries.test.ts` | **6 tests passed**, including the serving-process provisioning-authority boundary |
| `pnpm exec tsc -p packages/database/tsconfig.json --noEmit` + `pnpm exec tsc -p apps/platform-reference/tsconfig.json --noEmit` (**P2 remediation tree**) | both passed |
| `pnpm exec eslint` on all changed sources, scripts and tests (**P2 remediation tree**) | passed, no output |
| `DATABASE_URL=… pnpm test:e2e:platform-reference` (**P2 remediation tree**) | **8/8 passed**, 3.4 s |
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
| **Unit/boundary/component suite** (`pnpm test:unit`, `vitest.unit.config.ts`, **P2 remediation tree**) | **362 files / 2585 tests passed**, exit 0, 279.12 s |
| **Full integration suite** (`pnpm test:integration`, sequential, **P2 remediation tree**) | **44/46 files and 583/595 tests passed**; 12 tests in 2 files failed on `getaddrinfo ENOTFOUND site-a-<runId>.localhost` because this host no longer resolves wildcard `*.localhost`. The identical 12 tests fail at the committed baseline `c34e159d` with the P2 changes stashed (working-tree diff hash `c5f6ae74…` verified before and after), and the changed files are platform-only. **Not claimed as PASS**; the failure is environmental and unrelated to the P2 code |
| Workspace typecheck (`pnpm exec nx run-many --target=typecheck --all --skip-nx-cache`, **P2 remediation tree**) | **74/74 projects succeeded**, 1 m 16 s |
| `pnpm docs:validate-links` (docs validator, program docs) | **89 relative links across 12 files resolve** |
| `node scripts/validate-docs-links.mjs docs` (full tree) | **661 relative links across 300 files resolve** |
| `node scripts/audit-function-privileges.mjs` (read-only, **P2 remediation tree**) | Re-measured 2026-11-15: 33 public functions, 0 `SECURITY DEFINER`, 31 extension-owned, 33 with `PUBLIC` EXECUTE, 0 default-ACL entries, one superuser role (`vibress`) |
| `DATABASE_URL=… pnpm test:e2e:platform-reference` (Playwright, API request context) | **8 tests passed**: public health, missing/unknown principal 401, missing tenant 400, member-on-staff 403, invalid input 400, tenant-scoped create/list, cross-tenant 403, second tenant empty through RLS; harness created and dropped its roles and rows |
| `pnpm platform:provision-roles` against the dev fixture (throwaway roles) | Provisioned, then verified runtime role denied registry/membership/installation tables and `CREATE`; reader SELECT-only on memberships; both dropped, `pg_default_acl` back to 0 |
| Pre-existing `tests/integration/platform-packages.test.ts` under the root config | **26 tests passed** (runs under root aliases, not the platform config) |
| `node scripts/audit-function-privileges.mjs <url>` (read-only session) | 33 public functions, 0 `SECURITY DEFINER`, 33 `PUBLIC` EXECUTE, 0 default-ACL entries |
| `tsc` (workspace options) + ESLint on the W1-T09 scripts, Playwright config and spec | passed, no output |

Rows labelled **P2 remediation tree** were measured on the working tree committed
as `054ac8e6` on top of `0f64936a`. Platform suite (11 files / 191 tests),
unit suite (362 files / 2585 tests), workspace typecheck (74/74), reference-app
Playwright (8/8), targeted typecheck/ESLint and both docs link validators passed
on that tree. The full integration suite was **not green in this environment**:
44/46 files and 583/595 tests passed, and the 12 failures were reproduced
unchanged at baseline `c34e159d` (see the row above), so they are not a
regression and are not reported as a pass. CI run
[43641264614](https://github.com/AbdullahZaher/vibress/actions/runs/43641264614)
on `0f64936a` passed build, container-scan and e2e; a run on `054ac8e6` is the
required next CI step, and the earlier green run is not reused as proof of the
P2 code.

The prior tree (`0f64936a`) had also passed the full integration suite
(46 files / 578 tests) when wildcard `*.localhost` resolution was available on
this host.

The full unit run exposed one test-suite hygiene defect: the Playwright
`tests/e2e-platform/reference-app.spec.ts` was discovered by Vitest without its
harness state and failed collection. `vitest.config.ts` now excludes
`tests/e2e-platform/**`; the spec still runs through
`playwright.platform-reference.config.ts` (8/8). No test was disabled or deleted.

The PostgreSQL proof applies migration `0054`, provisions the runtime role, inserts
two tenants and two customers through the owner, then reconnects **as the runtime
role** for every assertion. A second non-superuser owner role owns a probe table with
`FORCE RLS` to prove owner fail-closed behavior. It cleans up its rows, both roles,
its owned objects and the probe table in `afterAll`; the DATABASE was checked
afterwards for leftover `platform_%` roles and probe relations.

## 7. Migration, data and rollback

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

## 8. Compatibility

- Kernel/tenancy packages are additive and not imported by existing apps.
- `packages/database/src/index.ts` only adds exports; existing exports unchanged.
- The legacy runtime role, pooled `getDb()` and transaction runner are untouched.
- CMS compatibility evidence: the entire `tests/integration` suite passed on this
  branch (section 8). The reference-app Playwright suite **was** run locally on the dev fixture
  (8 API-level tests, no staging secrets); the broader CMS Playwright
  E2E/acceptance suites were **not** run because they require staging secrets.

## 9. Compatibility run result

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

**W1-T02 remediation (historical; superseded by P0-A/P1):** this increment first kept
owner credentials only during boot and closed the owner pool before binding the socket,
with membership reads on a dedicated reader role. That reduced exposure but still put
privileged provisioning authority inside the long-lived process. The current tree
removes the owner pool from `startReferenceApplication` entirely and moves all registry
writes to a separate operator executable; see the P0-A/P1 entry below.

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
neither changes a tag, ADR status or gate. Evidence at that increment: reference
suite **36 tests**, installation **8 tests**, tenant **24 tests**, platform config
**11 files / 140 tests**, full docs links **659/300** and **87/12**.

**P0-A/P0-B/P1 security remediation (2026-11-14, uncommitted, current tree):**

- **P0-A:** privileged provisioning authority is absent from the request-serving
  sources. `registration.ts` + `scripts/provision-platform-reference.ts` are the
  operator-only path (`DATABASE_URL`, environment, artifact digest, actor, optional
  CAS guards). `start.ts` accepts only runtime, reader and verifier pools;
  `main.ts` refuses `DATABASE_URL` and requires three distinct least-privilege URLs;
  `server.ts` has no registry option. An architecture boundary test rejects
  provisioning imports/owner identifiers in `server.ts`/`start.ts`. Two child-process
  tests prove exit 1 for `DATABASE_URL` and for non-distinct connection URLs.
- **P0-B:** runtime, reader and verifier assertions enumerate the **full** SET-able
  membership closure for `current_user` and `session_user`
  (`pg_has_role(..., 'MEMBER')`), so ordinary, indirect and `NOINHERIT` memberships
  fail with `unexpected_role_membership`; privileged target roles fail with
  `privileged_role_membership`. Ownership, schema CREATE, relation/sequence/column
  ACLs, TRUNCATE and SECURITY DEFINER EXECUTE remain fail-closed. Real-PostgreSQL
  negative tests cover each new case.
- **P1:** the serving boot is a read-only, pinned identity proof through a new
  `vibress_platform_verifier` role (`SELECT` on the two registry tables only):
  installation existence, application id, environment, artifact digest and manifest
  digest must match. Nothing is created or repaired; tests compare rows before/after
  a successful boot and before/after each refused boot and find them identical.
  Provisioning remains an atomic CAS upsert with an actor and audit row.
- Evidence: platform suite **11 files / 174 tests** (69 reference-app tests),
  Playwright **8/8**, full unit **362 files / 2585 tests**, full integration
  **46 files / 578 tests**, workspace typecheck **74/74**, ESLint clean on all changed
  files. No CI run exists for this content yet; these are local results.

**Wave 1 final remediation (2026-11-15, commit `0f64936a`, on top of `6b31320d`):**

- **Strict runtime privilege contract:** `PlatformRuntimePrivilegeContract` (version
  1) describes the only authority a runtime profile may hold — non-system schemas
  with `USAGE`, relations by kind (table, view, materialized view, foreign table)
  with explicit privileges, sequences, and owner-defined function `EXECUTE`. It is a
  generic mechanism; the reference CRM profile is one contract instance, not a
  hardcoded policy. Provisioning grants exactly the contract after revoking all
  prior authority in every non-system schema; boot inspects **effective** authority
  (including PUBLIC and inherited grants, `has_table_privilege`/`has_any_column_privilege`/
  `has_sequence_privilege`/`has_schema_privilege`/`has_function_privilege` for both
  `current_user` and `session_user`) and fails closed with
  `unexpected_relation_privilege`, `unexpected_column_privilege`,
  `unexpected_sequence_privilege`, `unexpected_schema_privilege` or
  `unexpected_function_execute`. A missing or invalid contract fails boot with
  `privilege_contract_missing`/`privilege_contract_invalid`. Real-PostgreSQL tests
  cover a pre-existing unexpected grant being revoked, views/foreign tables, column
  grants, matviews, sequences, schema `CREATE`, function `EXECUTE`, PUBLIC defaults
  and role membership.
- **Atomic provisioning:** `provisionReferenceApplication` checks out one client,
  opens one transaction, and performs manifest sync, definition verification,
  installation read, registration or CAS update, and the read-only deployment proof
  on that same client; any failure rolls back everything. The critical acceptance
  test updates a manifest, then intentionally fails installation CAS verification
  and verifies that the previously committed manifest, installation, registry-audit
  and installation-audit rows are byte-identical to the pre-run snapshot. Further
  tests force an audit-insert failure, retry idempotently, and prove a single winner
  under concurrency.
- **Mandatory CAS and installation audit:** `registerInstallation` (create) and
  `updateInstallation` (change) are separate operations. An update requires the
  actor, a reason, the new environment, and **both** the expected previous
  environment and expected previous artifact digest, and is applied in one statement
  guarded by them; missing, mismatched, wrong-application and unauthorized changes
  are rejected with no mutation. Migration `0058` adds
  `platform_installation_changes` (RESTRICT foreign keys, shape/actor/reason checks)
  and each create or update writes its audit row in the same statement as the
  mutation, so an accepted change is always attributable and the recorded
  before/after values are the database's own.
- Evidence: platform suite **11 files / 174 tests** (69 reference-app tests: 11 new
  contract/provisioning tests and 4 atomic-provisioning tests), Playwright
  **8/8** with verified teardown, full unit **362 files / 2585 tests**, full
  integration **46 files / 578 tests** (sequential, shared dev database), workspace
  typecheck **74/74**, eslint clean on all changed files, docs links **89/12** and
  **661/300**. CI run [43641264614](https://github.com/AbdullahZaher/vibress/actions/runs/43641264614)
  on `0f64936a` passed (build, container-scan, e2e; 2026-11-14T21:09:05Z–21:32:16Z).
  Artifact provenance remains unclaimed: the digest is still
  caller-supplied and no mechanism proves executable code matches it.

## 10. Open blockers and risk register deltas

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| R26 | `PUBLIC` function `EXECUTE` reachable by the platform role; legacy `vibress_app` additionally holds explicit function EXECUTE | Owner code callable without a reviewed grant | Inventoried and re-measured 2026-11-14; [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) prepared, revocation **not applied**; Scope B legacy grant open |
| — | Deployment owner (`vibress`) is a superuser, which bypasses `FORCE RLS` | Owner could bypass if left as-is | Test proven; deployment change open |
| R35 | Views/materialized reports not covered by policy | Potential cross-tenant read if views are exposed | Open (excluded from contract) |
| R37 | Legacy `runInTransaction` still nests without savepoints (the scoped tenant unit of work is hardened) | Old CMS code can half-commit semantics | Unchanged by design; documented |
| ADR-PLAT-001 | Redis key ACL/instance and object-storage boundary untested | Queue/object isolation unproven | Open (database boundary proven) |
| — | Owner credentials exist for the separate provisioning executable; the serving process has none | Provisioning is a high-value operator job and must run as its own controlled deployment step | **Fixed in code (P0-A)** — serving refuses `DATABASE_URL`; the deployment must still run `platform:provision-reference` as a separate job with least-time credentials |
| — | Installation `artifact_digest` is supplied by the deployment pipeline, not derived from a signed artifact | A wrong or stale digest is rejected at boot (pinned), but provenance itself is not cryptographically verified | Partially addressed (P1) — digest is required and pinned by provisioning and verification; CI provenance remains open |
| — | Application name upsert ran before the drift decision | A refused boot could still rename an application | **Fixed (W1-T09)** — the name upsert runs only after a committed mutation or an observed `unchanged` state; refused drift writes nothing |
| — | No independent security review of this branch | Gate cannot pass | Open |
| — | 76 pre-existing broken links in legacy docs outside `docs/platform-roadmap` | Docs rot | **Resolved (W1-T08)** — rewritten to relative targets; full-docs validator passes 612 links / 296 files |
| — | Split CI test steps not yet exercised on GitHub Actions itself | Local unit + integration equivalents pass; runner ordering/services unproven | Pending first pipeline run |
| — | Broader CMS Playwright E2E/acceptance suites not run (staging secrets) | CMS browser-level regression unproven | Open; reference-app Playwright **8/8 passed** locally (W1-T09) |
| — | This host no longer resolves wildcard `*.localhost` | Two LMS integration files (12 tests) cannot pass locally; same result at baseline `c34e159d` | Environment defect, not a code regression and not claimed as a pass; re-run the suite where wildcard `*.localhost` resolves (or map the run hosts) to restore the local full-suite signal |
| — | Reference app authenticates with an operator-configured static bearer-token directory | Not a production identity provider; no rotation or revocation API | Reference only; replace before shared deployment |
| — | Membership directory is not RLS-protected (it is read before a scope exists) | Auth infrastructure must read all memberships; tenant runtime role is denied the table | By design; needs a reviewed auth-service access model |
| — | No application/tenant provisioning API; platform-role provisioning is a CLI and tenant/membership seeding remains SQL/bootstrap | Operator workflow is manual | Provisioning CLI added; API open |
| — | Deployed manifest drift requires an explicit `allowUpdate` deployment action | A forgotten update fails boot (fail-closed), not silently | By design; documented in the [boot/registry runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md) (W1-T09) |
| — | Registry changes had no operator/digest audit | Drift was detected but not attributed | **Addressed (W1-T09)** — `platform_application_registry_changes` records actor, previous/new digest and version atomically with each create/update; `unchanged` writes nothing |
| — | Public actions cannot access the database at all | Public route surface limited to principal/tenant-independent handlers | By design until a reviewed unscoped-read contract exists |
| — | A1–A8, G0 unsigned; owners unassigned | Program blocked for acceptance | Open |
| F-012 | Global RLS still not activated for CMS tables | Security review gate still conditional | Open — [CMS disposition proposed](F-012-CMS-RLS-DECISION.md) (option B), not accepted; no RLS/grant change made |

No finding was closed by documentation. No test was skipped to make the run green.

## 11. Security remediation rubric (transparent, 6 dimensions)

Scores are for this increment only and are not a certification. A critical defect
(R26, F-012 or absent independent review) overrides any score.

| Dimension | Score | Basis |
| --- | --- | --- |
| Privilege separation (P0-A/P0-B, contract) | 8.7/10 | Owner authority removed from serving sources and refused at runtime; full SET-able membership closure proven with real PostgreSQL; the versioned runtime privilege contract constrains relations by kind, columns, sequences, schemas and function `EXECUTE` against effective authority including PUBLIC and inherited grants, and function grants are now keyed by exact signature so an overload cannot inherit authority from an authorized name. Deducted because provisioning and serving are not yet exercised as separate deployment units on a real orchestrator, and R26 `PUBLIC` function grants remain unrevoked. |
| Verification correctness (P1, atomicity, rollback) | 8.7/10 | Pinned, read-only checks cover application, installation, environment, artifact and manifest; installation changes require mandatory CAS on both expected values; the entire provisioning flow runs on one checked-out connection in one transaction, a forced CAS failure after a manifest update leaves manifest, installation and both audit streams unchanged, and a failed `BEGIN`, `ROLLBACK` or `COMMIT` outcome destroys the connection instead of returning it to the pool. Deducted because the artifact digest is still operator-supplied, not derived from CI provenance. |
| Test evidence | 8.7/10 | 191 platform tests (86 reference-app), full unit 2585, 8 Playwright tests, 74/74 typecheck and lint all green locally on the P2 tree, and CI run 43641264614 green on the prior implementation SHA `0f64936a`. Deducted because the full local integration suite was 44/46 files in this environment (12 unrelated LMS tests fail on `*.localhost` DNS, reproduced at baseline) and no local test or CI job can prove the production deployment topology. |
| Compatibility and maintainability | 8.5/10 | Additive schema/exports; full CMS/Studio unit and integration suites green; the change adds one verifier role, one operator CLI, one migration and one generic contract type. Deducted because browser-level CMS acceptance suites and CI remain outstanding. |
| Operational readiness | 6.5/10 | Runbook updated for two executables, three roles, mandatory CAS variables, both audit queries, signature-exact function grants and `contract_function_missing`. Missing: production-shaped Redis/S3/queue/secrets isolation, production IdP, non-superuser deployment owner, external secret-manager wiring. |
| Auditability and governance | 8.5/10 | Registry audit (0057) and installation audit (0058) rows are written in the same statement as each mutation, with actor, reason and observed before/after values; runbook, finding table and explicit non-claims. Deducted because ADRs and A1–A8/G0 remain unsigned and no independent reviewer has examined this increment. |
| **Average** | **8.3/10** | (8.7 + 8.7 + 8.7 + 8.5 + 6.5 + 8.5) / 6 = 8.27. **Target 9.0 not met; critical external blockers remain.** |

## 12. Certification and sign-off status

| Role | Name/status |
| --- | --- |
| Implementation author | Agent (this branch); not an independent auditor |
| Independent security reviewer | **NOT ASSIGNED / NOT PERFORMED** |
| Database/security owner for R26 | **NO APPROVAL RECORDED**; proposal 0055 unapplied |
| Deployment owner (non-superuser topology) | **NO CHANGE AUTHORIZED** |
| Release owner (R40) | **NO SIGNATURE** |
| ADR-PLAT-001/002/003 | **PROPOSED, NOT ACCEPTED** |
| A1–A8, G0–G7 | **UNSIGNED** |
| CI on the final source SHA | **PASS on `0f64936a`** — run [43641264614](https://github.com/AbdullahZaher/vibress/actions/runs/43641264614): build, container-scan and e2e succeeded. A run on the P2 SHA `054ac8e6` is pending and must be recorded before any gate decision |

The author does not sign off on this implementation, does not mark the gate
passed, and did not fabricate any signature or approval.

## 13. Gate decision

**NO-GO for Wave 1 exit and NO-GO for Wave 2 start.**

Passing evidence on this branch: kernel/tenancy unit and boundary tests, a real
PostgreSQL tenant-isolation matrix through a least-privilege role, `FORCE RLS`
against a non-superuser owner, a two-database installation boundary, a persisted
registry with drift/integrity refusal, side-effect-free installation binding, hardened
runtime-role privilege assertions tightened to a versioned effective-authority
contract with **signature-exact function authorization**, single-transaction
provisioning with a proven rollback on forced CAS failure and **connection
destruction on any unknown transaction state**, mandatory-CAS installation
updates with transactional audit `0058`, a bootable reference app serving tenant-isolated
reads and writes through the kernel executor, **a request-serving process with no
owner/provisioning authority at all** (it refuses `DATABASE_URL`), a SELECT-only
membership reader, a SELECT-only deployment verifier with pinned read-only boot
verification, full SET-able membership closure, a hardened tenant transaction trust
boundary (async escape, role-switch rejection, connection destruction), a
digest-pinned two-publication CMS/Studio compatibility pack proven over HTTP +
PostgreSQL, a fully validating docs tree, 44/46 integration files with the
remaining two proven to fail identically at baseline on host DNS, and a
green CI run ([43641264614](https://github.com/AbdullahZaher/vibress/actions/runs/43641264614))
on the prior implementation SHA `0f64936a`; CI on `054ac8e6` must pass before the
gate is reconsidered.

Missing evidence:
R26 revocation approval/application,
non-superuser owner in the deployment topology, views policy decision, F-012
disposition acceptance, Redis/S3 cross-installation denial, production identity
provider, broader CMS Playwright E2E/acceptance run, artifact provenance from CI,
a green CI run on the P2 SHA, independent review, and named human sign-offs.
Wave 2 (M03) may not start under
this gate, and a high rubric score cannot override these critical defects.

## 14. Next steps (ordered)

1. Independent review of the implementation SHA `054ac8e6` (and the three ADR
   proposals) by a reviewer who is not the author; record findings as blocking or
   accepted with rationale. CI and the local suites are green except the
   environment-bound LMS DNS tests, but they are not review.
2. R26: run the inventory against a production-shaped role set; answer
   [the approval request](R26-REVOCATION-APPROVAL-REQUEST.md) for Scope A
   ([proposals/0055_revoke_public_execute.sql](proposals/0055_revoke_public_execute.sql))
   and Scope B; then apply as the migration owner, flip the residual test to
   expect `42501`, re-run the audit and keep the documented rollback ready.
3. Change the deployment owner from the superuser `vibress` role to a non-superuser
   owner and re-run the owner RLS proof there.
4. Replace the reference app's static token directory with a real identity provider.
   Role provisioning, the separate provisioning executable, manifest sync/drift,
   pinned boot verification and audit review are documented in the
   [boot/registry runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md).
5. Run the broader CMS Playwright E2E/acceptance suites against staging (requires
   secrets); the reference-app Playwright suite (8/8) passes on the current tree.
   Re-run the full Vitest integration suite in an environment where wildcard
   `*.localhost` resolves; twelve unrelated LMS tests fail on that host DNS today
   and fail identically at baseline.
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
