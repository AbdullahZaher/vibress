# Platform boot, registry and deployment runbook (W1-T09 #27)

> **Scope.** Operator runbook for the Wave 1 reference application and the
> persisted application registry. It documents the code as merged on
> `feat/wave1-platform-kernel-tenant-isolation`; it does not authorize grant
> changes, does not apply
> [proposal 0055](proposals/0055_revoke_public_execute.sql), and does not change
> the status of any ADR or sign-off gate. R26 remains open; see
> [the approval request](R26-REVOCATION-APPROVAL-REQUEST.md).
>
> **Status of this document:** prepared as W1-T09 evidence. Following it is not
> a substitute for the human approvals tracked in
> [PROGRAM-EXECUTION-STATUS.md](PROGRAM-EXECUTION-STATUS.md).

## 1. What the boot actually does

Owner authority and request serving are **two executables**, not two phases of
one process. The long-lived serving process (`apps/platform-reference/src/main.ts`)
never receives `DATABASE_URL`; if the variable is present it exits with an error
before opening a pool.

The serving process opens three pools and requires three **distinct** connection
strings. Startup fails before any network bind if they are equal.

| Pool | Credential | Role | Lifetime |
| --- | --- | --- | --- |
| Runtime | `PLATFORM_RUNTIME_DATABASE_URL` | `vibress_platform_app` by default | serving process; RLS-bound DML on `platform_crm_customers` only |
| Reader | `PLATFORM_MEMBERSHIP_READER_DATABASE_URL` | `vibress_platform_reader` by default | serving process; `SELECT` on `platform_memberships` only |
| Verifier | `PLATFORM_DEPLOYMENT_VERIFIER_DATABASE_URL` | `vibress_platform_verifier` by default | boot proof only; `SELECT` on `platform_installations` and `platform_application_registrations`; the pool is closed before `listen` |

Order inside `startReferenceApplication`:

1. `assertSafePlatformRuntimeRole(runtimePool, { profile: "runtime",
   privilegeContract })` — refuses a superuser, `BYPASSRLS`, `CREATEROLE`,
   `CREATEDB`, `REPLICATION`, **any** SET-able role membership (privileged,
   ordinary, indirect or `NOINHERIT`), schema/database CREATE, ownership,
   registry/membership privileges and SECURITY DEFINER EXECUTE. It then verifies
   **effective** privilege against the versioned runtime privilege contract:
   relations, columns, sequences, schemas and executable functions outside the
   contract fail boot (`unexpected_relation_privilege`,
   `unexpected_column_privilege`, `unexpected_sequence_privilege`,
   `unexpected_schema_privilege`, `unexpected_function_execute`). A missing or
   invalid contract fails boot as well; there is no implicit allowlist.
2. `assertSafePlatformMembershipReaderRole(readerPool)` — refuses a reader that
   can do anything beyond `SELECT` on `platform_memberships`, including column
   grants, ownership, sequence or function privileges, or any role membership.
3. `assertSafePlatformDeploymentVerifierRole(verifierPool)` — refuses a
   verifier with any privilege beyond table-level `SELECT` on the two registry
   tables.
4. Refuse boot if any two pools authenticate as the same role.
5. `verifyDeploymentIdentity` (read-only) on the verifier pool: the installation
   id must exist, be bound to this application, match `PLATFORM_ENVIRONMENT` and
   `PLATFORM_ARTIFACT_DIGEST`, and the persisted manifest digest must equal the
   deployed manifest digest.
6. `verifierPool.end()`.
7. Build Fastify, bind the socket.

Consequence: **no owner credential or provisioning capability exists in the
request-serving process.** Registry writes can only be performed by the separate
provisioning executable with `DATABASE_URL`; the serving process can only read
its own pinned installation through the verifier role and cannot create,
repair or update it.

`GET /health` is public and is the readiness probe. Requests to other paths are
executed by the kernel route executor and require a bearer token and a valid
`x-tenant-id` where the route is tenant-scoped.

## 2. Environment variables

Names only; values are secrets and belong in the deployment secret store.

### Serving process (`apps/platform-reference/src/main.ts`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **forbidden** | presence makes the serving process exit; owner authority belongs to provisioning |
| `PLATFORM_RUNTIME_DATABASE_URL` | yes | runtime role connection |
| `PLATFORM_MEMBERSHIP_READER_DATABASE_URL` | yes | membership reader connection |
| `PLATFORM_DEPLOYMENT_VERIFIER_DATABASE_URL` | yes | read-only deployment verifier connection |
| `PLATFORM_ENVIRONMENT` | yes | environment pinned in the installation row (e.g. `production`) |
| `PLATFORM_ARTIFACT_DIGEST` | yes | artifact digest assigned by the deployment pipeline; must equal the provisioned value |
| `PLATFORM_INSTALLATION_ID` | no (default `reference-installation`) | binds this deployment to the application |
| `PLATFORM_REFERENCE_TOKENS` | yes for authenticated routes | static bearer-token directory (reference app only) |
| `PLATFORM_REFERENCE_HOST` / `PLATFORM_REFERENCE_PORT` | no (defaults `127.0.0.1:4100`) | listen address |

The three connection strings must be distinct and are deleted from
`process.env` after the pools are constructed.

### Operator provisioning (`scripts/provision-platform-roles.ts`, `scripts/provision-platform-reference.ts`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | owner/migration connection; never set for the serving process |
| `POSTGRES_PLATFORM_APP_USER` / `POSTGRES_PLATFORM_APP_PASSWORD` | role provisioning | runtime role name/password |
| `POSTGRES_PLATFORM_READER_USER` / `POSTGRES_PLATFORM_READER_PASSWORD` | role provisioning | reader role name/password |
| `POSTGRES_PLATFORM_VERIFIER_USER` / `POSTGRES_PLATFORM_VERIFIER_PASSWORD` | role provisioning | deployment verifier role name/password |
| `PLATFORM_ENVIRONMENT` | provisioning | environment stored in the installation row |
| `PLATFORM_ARTIFACT_DIGEST` | provisioning | digest assigned by the deployment pipeline |
| `PLATFORM_REGISTRY_ACTOR` | yes for registry `created`/`updated`, and for installation create/update | operator identity written to both audit tables |
| `PLATFORM_CHANGE_REASON` | yes for `platform:provision-reference` | non-empty reason recorded with a created/updated installation |
| `PLATFORM_REGISTRY_UPDATE` | no | must be exactly `1` to permit a manifest change |
| `PLATFORM_INSTALLATION_UPDATE` | no | must be exactly `1` to permit an installation change; both expected-state values are then mandatory |
| `PLATFORM_EXPECTED_ENVIRONMENT` / `PLATFORM_EXPECTED_ARTIFACT_DIGEST` | required for an installation update | exact previously observed state; the update is a compare-and-swap and is rejected when absent, blank or stale. Use the literal `null` only to expect that no artifact was pinned |
| `PLATFORM_CHANGE_REFERENCE` | no | deployment/ticket reference recorded with the installation change |
| `PLATFORM_INSTALLATION_ID` | no (default `reference-installation`) | installation to provision |
| `PLATFORM_TENANT_ID` / `PLATFORM_BOOTSTRAP_PRINCIPALS` | no | standalone bootstrap job only |

## 3. First deployment sequence

Run each step with the owner/migration credential, not a runtime role.

1. **Apply migrations.** `pnpm db:migrate` (or `pnpm prod:migrate` in the
   container path). The deployment must reach migration `0058`, which creates
   `platform_installation_changes`. Provisioning before 0057 fails because
   `sync` writes its audit row in the same statement as the registration;
   provisioning before 0058 fails because installation create/update writes the
   installation audit row in the same statement as the row mutation.
2. **Provision platform roles.** After migrations:

   ```bash
   DATABASE_URL=... \
   POSTGRES_PLATFORM_APP_USER=vibress_platform_app \
   POSTGRES_PLATFORM_APP_PASSWORD=... \
   POSTGRES_PLATFORM_READER_USER=vibress_platform_reader \
   POSTGRES_PLATFORM_READER_PASSWORD=... \
   POSTGRES_PLATFORM_VERIFIER_USER=vibress_platform_verifier \
   POSTGRES_PLATFORM_VERIFIER_PASSWORD=... \
   pnpm platform:provision-roles
   ```

   The command is idempotent (existing non-superuser roles are altered), refuses
   to manage a superuser, refuses equal role names, and re-verifies in
   `pg_roles` that no role is `rolsuper` or `rolbypassrls` after provisioning.
   It does not print or store the passwords.
3. **Provision the installation with owner authority.** On the first
   provisioning run the registry row does not exist, so `sync` returns
   `created`; without `PLATFORM_REGISTRY_ACTOR` or `PLATFORM_CHANGE_REASON` the
   command fails before writing anything.

   ```bash
   DATABASE_URL=... \
   PLATFORM_ENVIRONMENT=production \
   PLATFORM_ARTIFACT_DIGEST=<digest from the build pipeline> \
   PLATFORM_REGISTRY_ACTOR=release-bot/change-123 \
   PLATFORM_CHANGE_REASON="first deployment" \
   PLATFORM_CHANGE_REFERENCE=change-123 \
   pnpm platform:provision-reference
   ```

   This runs `sync`, `verifyDefinitions`, the conditional installation bind and
   a read-only identity proof in one operator-only executable. `sync`, the
   installation mutation and both audit rows share a **single transaction on a
   single checked-out connection**; any failure rolls the manifest, installation
   and both audit streams back together. The command never runs in the serving
   process.
4. **Start the service** with the three least-privilege URLs plus
   `PLATFORM_ENVIRONMENT` and the same `PLATFORM_ARTIFACT_DIGEST`, and wait for
   `GET /health`.
5. **Verify the audit rows** (read-only):

   ```sql
   SELECT change_kind, actor, previous_version, new_version,
          left(previous_digest, 12) AS prev, left(new_digest, 12) AS new,
          recorded_at
     FROM platform_application_registry_changes
    WHERE application_id = 'reference-crm'
    ORDER BY recorded_at, id;

   SELECT change_kind, actor, reason, deployment_reference,
          previous_environment, new_environment,
          left(previous_artifact_digest, 12) AS prev,
          left(new_artifact_digest, 12) AS new,
          recorded_at
     FROM platform_installation_changes
    WHERE installation_id = 'reference-installation'
    ORDER BY recorded_at, id;
   ```

   Exactly one `created` row per table with the operator actor and no previous
   values is expected.

## 4. Routine redeploy (unchanged manifest)

Restart serving with the same environment and artifact digest. The verifier
re-reads the installation and registration and fails the boot without writing
if the application id, environment, artifact digest or persisted manifest digest
differs from the deployed code.

Routine provisioning is a separate operator step. `sync` reloads the existing
row, compares digests, returns `unchanged`, and writes **no** registry audit row.
The installation path loads the row and compares application id, environment
and artifact digest: an identical row is returned without a write and without an
installation audit row. Creation and update are separate store operations:

- `registerInstallation` is a single `INSERT ... ON CONFLICT DO NOTHING` with a
  data-modifying CTE that writes the `created` audit row in the same statement.
  A conflicting id bound to another application or different values yields
  `InstallationMismatchError` / `InstallationUpdateRequiredError` and writes
  nothing.
- `updateInstallation` requires an actor, a non-empty reason and **both**
  expected-state values, and performs a compare-and-swap
  (`environment = expected AND artifact_digest IS NOT DISTINCT FROM expected`).
  A missing, blank or stale expectation changes no row and yields
  `InstallationChangeInputError` / `InstallationMismatchError`. A successful
  update writes its `updated` audit row in the same statement.

The serving process never calls `sync` or any registry/installation write; it
only verifies what the operator provisioned.

## 5. Deliberate manifest change (drift procedure)

A code change that alters the serialized manifest (routes, permissions, version)
is **refused by default** with `ApplicationRegistrationDriftError`, which reports
both digests. This is intentional: changing a registered application is a
deployment decision, not a side effect.

To accept a reviewed change:

1. Confirm the deployed image is the intended release and note both digests from
   the error message.
2. Set `PLATFORM_REGISTRY_UPDATE=1` **and** a non-empty `PLATFORM_REGISTRY_ACTOR`
   identifying the operator or change ticket in the **provisioning** environment.
3. Run `pnpm platform:provision-reference` once with the new artifact digest.
   The update is a compare-and-swap on the previously observed digest; the same
   SQL statement inserts one `updated` audit row containing the actor,
   previous/new digest and previous/new version. If another process won the race
   and the digest already equals the deployed one, `sync` returns `unchanged` and
   writes nothing.
4. Review the audit row before removing `PLATFORM_REGISTRY_UPDATE`. Leaving it
   set is a standing authorization for any future manifest change; treat it as a
   temporary flag. The serving process has no update flag and refuses to boot on
   any mismatch.

### Changing the installation (environment or artifact)

A manifest change and an installation change are separate decisions. An
existing installation is **not** updated implicitly, even when the same command
carries a new artifact digest: without `PLATFORM_INSTALLATION_UPDATE=1` the
command fails with `InstallationUpdateRequiredError` and writes nothing.

1. Read the current row and record its exact `environment` and
   `artifact_digest` (the latter may be none).
2. Set `PLATFORM_INSTALLATION_UPDATE=1`,
   `PLATFORM_EXPECTED_ENVIRONMENT` and `PLATFORM_EXPECTED_ARTIFACT_DIGEST`
   (leave the digest variable empty when the pinned value is none), plus a
   non-empty `PLATFORM_CHANGE_REASON` and optionally
   `PLATFORM_CHANGE_REFERENCE`.
3. Run `pnpm platform:provision-reference` once. The update is a
   compare-and-swap: if another deployment changed the row after step 1, it
   fails with `InstallationMismatchError` and changes nothing.
4. Verify the new `updated` row in `platform_installation_changes`. Remove
   `PLATFORM_INSTALLATION_UPDATE` afterwards; it is not intended as a standing
   flag.

What the audit tables prove and do not prove:

- Together they record **who** accepted each registry or installation create/update,
  **when**, **which** digests/versions/environments were involved, and for
  installations the operator's **reason** and optional deployment reference.
- They do not record an approval decision or a second-person authorization.
- They do not prove that the artifact digest corresponds to signed code; the
  digest is still supplied by the deployment pipeline.
- Rows cannot be cascaded away: both foreign keys are `ON DELETE RESTRICT`, so
  an application or installation with history cannot be deleted.
- `unchanged` boots and refused drift write nothing, so the tables are not a
  boot log.

## 6. Failure modes and operator action

| Symptom | Cause | Action |
| --- | --- | --- |
| `RegistryActorRequiredError` | first provisioning or accepted update without actor | set `PLATFORM_REGISTRY_ACTOR`; nothing was written |
| `ApplicationRegistrationDriftError` | deployed manifest differs from persisted digest | deploy matching code, or run the documented update procedure |
| `InstallationMismatchError` | installation id bound to another application, or a compare-and-swap guard did not match | use the installation id belonging to this application; do not rebind implicitly. For an update, re-read the current environment/artifact and retry with the exact observed state |
| `InstallationUpdateRequiredError` | the installation exists with different values but `PLATFORM_INSTALLATION_UPDATE=1` was not set | nothing was written; perform the documented installation update with both expected-state values and a reason |
| `InstallationChangeInputError` | an update was requested without an expected environment, without an expected artifact digest, with a blank environment, or without a reason | supply the exact previously observed state and a non-empty reason; nothing was written |
| `ApplicationRegistrationMissingError` | deployed application has no persisted registration | provisioning did not complete; check actor/migration state and rerun it |
| `UnexpectedApplicationRegistrationError` | registry contains an application absent from deployed code | deploy the missing application or perform a reviewed registry cleanup; boot stays closed |
| `ApplicationRegistrationIntegrityError` | stored manifest malformed or digest does not recompute | treat as data corruption/tampering; do not bypass, investigate the row and restore from a trusted migration/deploy |
| `InstallationApplicationMissingError` | installation bound before its application registration committed | ordering defect; provisioning always syncs first |
| `DeploymentVerificationError` (installation, application, environment, artifact or manifest mismatch) | the serving process was started with values that do not match the provisioned installation | correct `PLATFORM_ENVIRONMENT`/`PLATFORM_ARTIFACT_DIGEST`/installation id, or provision the intended artifact; boot is refused read-only and nothing is repaired |
| role assertion `identity_superuser` / `identity_bypass_rls` / `identity_createrole` / `privileged_role_membership` | wrong credential for runtime, reader or verifier URL, or an unexpected privileged membership | point the URL at the dedicated role and remove the membership; never use the owner here |
| `unexpected_role_membership` | the login is a SET-able member of any other role, including indirect or `NOINHERIT` grants | remove the membership; dedicated platform logins must have none |
| `membership_read_missing` | reader lacks table-level `SELECT` on `platform_memberships`, or migrations are absent | re-run `pnpm platform:provision-roles` after migrations |
| `membership_write_privilege` | reader can write the membership directory | re-provision; the reader must be SELECT-only |
| `unexpected_relation_privilege` | the **verifier** holds a write, column-only or non-registry privilege; on the **runtime** login it means effective authority (direct, inherited or via `PUBLIC`) on a relation outside the privilege contract, including a view or foreign table | re-provision; the verifier must be table-level SELECT on the two registry tables only, and the runtime must match the versioned contract exactly |
| `unexpected_column_privilege` / `unexpected_sequence_privilege` / `unexpected_schema_privilege` / `unexpected_function_execute` | the runtime login has effective column, sequence, schema `USAGE` or non-trigger function `EXECUTE` authority outside the privilege contract | re-provision the runtime role; if the new authority is intentional, version the contract first — there is no bypass flag |
| `privilege_contract_missing` / `privilege_contract_invalid` | the serving process was started without a runtime privilege contract, or the supplied contract fails validation | pass the deployed contract from `@vibress/database`; boot stays closed |
| `DATABASE_URL` present in the serving environment | owner credential leaked into the long-lived process | remove it; run `pnpm platform:provision-reference` as the separate operator job |
| connection URLs not distinct | two pools share a role | use three distinct least-privilege credentials |
| SQLSTATE `42P01` on `platform_application_registry_changes` or `platform_installation_changes` | migration `0057` or `0058` not applied | apply migrations before provisioning |
| Fastify `EADDRINUSE` | port already bound | stop the old process; verify only one serving process per installation |

## 7. Standalone bootstrap job (optional)

`apps/platform-reference/src/bootstrap.ts` is an owner-only job that syncs the
registry, seeds one tenant and up to N memberships, verifies each membership
through `PlatformMembershipResolver`, and exits. Use it for fixtures or initial
principal seeding. It runs on the owner credential and must not be deployed as a
long-running serving process; the serving path is `main.ts`.

## 8. Rollback

- **Code rollback to a manifest that is still registered:** boots as
  `unchanged`; preferred.
- **Rollback to a manifest that differs from the registered digest:** boot is
  refused. Do not disable the check. Either roll forward, or perform a reviewed
  `PLATFORM_REGISTRY_UPDATE=1` boot with an actor so the rollback is recorded as
  an `updated` change. The previous digest remains in the audit row.
- **Schema:** migrations `0057` and `0058` are additive (new tables, indexes,
  FKs). This runbook does not authorize dropping them or deleting audit rows.
- **Roles:** re-running the provisioner narrows privileges; it never drops a
  role. Dropping platform roles is a destructive, separately approved action.

## 9. Reference-app Playwright harness

`playwright.platform-reference.config.ts` starts a real reference-app process on
`127.0.0.1:7791` and runs `tests/e2e-platform/reference-app.spec.ts` through
Playwright's API request context (no browser binary, no staging secrets):

```bash
DATABASE_URL=... pnpm test:e2e:platform-reference
```

- Requires a database that already has migrations through `0058`; the harness
  fails with an explicit message otherwise.
- Each run uses a unique application id, installation id, two tenants, three
  platform roles (runtime, reader, verifier) and three bearer tokens. The staff
  principal can create/list in tenant A, a member principal can only read tenant
  A, and a separate principal reads tenant B.
- The global teardown (and the harness's own shutdown path) deletes only that
  run's CRM/membership/tenant/installation/registry/audit rows and drops only its
  generated roles. Observed after a run: no `reference-e2e-%` application, no
  `reference_e2e_%` role, `pg_default_acl` back to 0.
- The suite is an HTTP-level E2E proof of the serving process, not a browser or
  CMS compatibility proof. The broader CMS Playwright suites still require
  staging secrets.

## 10. Evidence for this runbook (dev fixture, 2026-11-14)

- `scripts/provision-platform-roles.ts` was executed against
  `127.0.0.1:5433/vibress` with throwaway roles (`w1t09_rt_probe`,
  `w1t09_rd_probe`).
- Runtime probe: `rolsuper = f`, `rolbypassrls = f`; `SELECT` on
  `platform_application_registrations`, `platform_application_registry_changes`,
  `platform_memberships` and `platform_installations` all returned
  `permission denied`; `CREATE TABLE public.…` returned `permission denied for
  schema public`.
- Reader probe: `SELECT count(*) FROM platform_memberships` succeeded (0 rows);
  `INSERT` into it returned `permission denied`; registry select returned
  `permission denied`.
- Cleanup: `DROP OWNED BY` then `DROP ROLE` for both probes; `pg_roles` shows no
  `w1t09_%` roles and `pg_default_acl` is back to 0 entries.
- The script typechecks under the workspace compiler options and passes ESLint.
- The Playwright reference-app suite passed **8/8** against the same fixture and
  removed every row and role it created.
- No grant was changed for R26; proposal 0055 remains unapplied.

## 11. P0-A/P0-B/P1 remediation evidence (2026-11-14)

Measured on the working tree on top of `b62ffdf5` against PostgreSQL 16
(`127.0.0.1:5433/vibress`):

- `pnpm exec vitest run --config vitest.platform.config.ts` — **11 files /
  154 tests passed**, including **49** in `platform-reference-app.test.ts`.
- Serving-process owner-authority absence:
  - child-process start with `DATABASE_URL` set exits **1** with "must not
    receive DATABASE_URL";
  - start with three equal connection URLs exits **1** with "must be distinct";
  - `startReferenceApplication` starts and accepts traffic without any owner
    pool, and the installation/registration rows are byte-for-byte unchanged
    (including `created_at`, `registered_at` and `updated_at`).
- Pinned read-only verification: matching installation boots; environment,
  artifact, application-id and manifest-digest drift each raise
  `DeploymentVerificationError` before serving and leave the installation row
  unchanged. The verifier role is refused writes (`42501` on
  INSERT/UPDATE/DELETE/TRUNCATE) and any read outside the two registry tables.
- Unexpected-membership closure: real-PostgreSQL tests reject a `NOINHERIT`
  membership in an ordinary table-owning role, an indirect membership through a
  middle role, and a reader with a `NOINHERIT` membership; runtime and reader
  logins must have **no** role memberships other than themselves.
- Provisioning isolation: `provisionReferenceApplication` requires an actor and
  an artifact digest, applies compare-and-swap guards, and is never imported by
  `server.ts`/`start.ts` (architecture boundary test). A mismatched guard throws
  `InstallationMismatchError` and leaves the row unchanged.
- `pnpm test:e2e:platform-reference` (with `DATABASE_URL` for the operator
  harness) — **8/8 passed**.
- `pnpm test:unit` — **362 files / 2585 tests passed**, exit 0.
- `pnpm test:integration` — **46 files / 558 tests passed**, exit 0, sequential.
- `nx run-many --target=typecheck --all` — **74/74 projects**.
- `tsc -p packages/database --noEmit` and `tsc -p apps/platform-reference
  --noEmit` — passed; ESLint on all changed files — clean.
- CI has not run on this uncommitted content.
