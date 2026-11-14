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

The serving process (`apps/platform-reference/src/main.ts`) opens three pools
and requires three **distinct** connection strings. Startup fails before any
network bind if they are equal.

| Pool | Credential | Role | Lifetime |
| --- | --- | --- | --- |
| Owner | `DATABASE_URL` | migration/owner role (not superuser in production) | owner-only boot phase only; closed before `listen` |
| Runtime | `PLATFORM_RUNTIME_DATABASE_URL` | `vibress_platform_app` by default | serving process; RLS-bound DML on `platform_crm_customers` only |
| Reader | `PLATFORM_MEMBERSHIP_READER_DATABASE_URL` | `vibress_platform_reader` by default | serving process; `SELECT` on `platform_memberships` only |

Order inside `startReferenceApplication`:

1. `assertSafePlatformRuntimeRole(runtimePool)` — refuses a superuser,
   `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, table-owner, privileged-role member,
   or a role with registry/membership privileges.
2. `assertSafePlatformMembershipReaderRole(readerPool)` — refuses a reader that
   can do anything beyond `SELECT` on `platform_memberships`.
3. Resolve the owner identity and refuse if any two pools authenticate as the
   same role.
4. `registerApplicationInstallation` on the owner pool: `sync` the deployed
   manifest, `verifyDefinitions`, then `syncInstallation` for this
   installation id.
5. `ownerPool.end()`.
6. Build Fastify, bind the socket.

Consequence: **no owner credential survives into request handling.** Once the
socket is listening, the process cannot write registry rows, memberships or
tenants.

`GET /health` is public and is the readiness probe. Requests to other paths are
executed by the kernel route executor and require a bearer token and a valid
`x-tenant-id` where the route is tenant-scoped.

## 2. Environment variables

Names only; values are secrets and belong in the deployment secret store.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | owner/migration connection for boot registration |
| `PLATFORM_RUNTIME_DATABASE_URL` | yes | runtime role connection |
| `PLATFORM_MEMBERSHIP_READER_DATABASE_URL` | yes | membership reader connection |
| `PLATFORM_INSTALLATION_ID` | no (default `reference-installation`) | binds this deployment to the application |
| `PLATFORM_TENANT_ID` | no (default `reference-tenant`) | tenant seeded by the optional standalone bootstrap |
| `PLATFORM_BOOTSTRAP_PRINCIPALS` | no | JSON array seeded by the standalone bootstrap job only |
| `PLATFORM_REFERENCE_TOKENS` | yes for authenticated routes | static bearer-token directory (reference app only) |
| `PLATFORM_REFERENCE_HOST` / `PLATFORM_REFERENCE_PORT` | no (defaults `127.0.0.1:4100`) | listen address |
| `PLATFORM_REGISTRY_ACTOR` | required only for `created`/`updated` | operator identity written to the audit table |
| `PLATFORM_REGISTRY_UPDATE` | no | must be exactly `1` to permit a manifest change |
| `POSTGRES_PLATFORM_APP_USER` / `POSTGRES_PLATFORM_APP_PASSWORD` | provisioning only | runtime role name/password |
| `POSTGRES_PLATFORM_READER_USER` / `POSTGRES_PLATFORM_READER_PASSWORD` | provisioning only | reader role name/password |

Beyond `DATABASE_URL`, the provisioner reads only the four `POSTGRES_PLATFORM_*`
role variables.

## 3. First deployment sequence

Run each step with the owner/migration credential, not a runtime role.

1. **Apply migrations.** `pnpm db:migrate` (or `pnpm prod:migrate` in the
   container path). The deployment must reach migration `0057`, which creates
   `platform_application_registry_changes`. Booting before 0057 fails because
   `sync` writes its audit row in the same statement as the registration.
2. **Provision platform roles.** After migrations:

   ```bash
   DATABASE_URL=... \
   POSTGRES_PLATFORM_APP_USER=vibress_platform_app \
   POSTGRES_PLATFORM_APP_PASSWORD=... \
   POSTGRES_PLATFORM_READER_USER=vibress_platform_reader \
   POSTGRES_PLATFORM_READER_PASSWORD=... \
   pnpm platform:provision-roles
   ```

   The command is idempotent (existing non-superuser roles are altered), refuses
   to manage a superuser, refuses equal runtime/reader names, and re-verifies in
   `pg_roles` that neither role is `rolsuper` or `rolbypassrls` after
   provisioning. It does not print or store the passwords.
3. **Configure the three URLs and the registry actor.** On the first boot the
   registry row does not exist, so `sync` returns `created`; without
   `PLATFORM_REGISTRY_ACTOR` the boot fails with `RegistryActorRequiredError`
   and writes nothing.
4. **Start the service** and wait for `GET /health`.
5. **Verify the audit row** (read-only):

   ```sql
   SELECT change_kind, actor, previous_version, new_version,
          left(previous_digest, 12) AS prev, left(new_digest, 12) AS new,
          recorded_at
     FROM platform_application_registry_changes
    WHERE application_id = 'reference-crm'
    ORDER BY recorded_at, id;
   ```

   Exactly one `created` row with the operator actor and no previous digest is
   expected.

## 4. Routine redeploy (unchanged manifest)

Restart the service with the same code manifest. `sync` reloads the existing
row, compares digests, returns `unchanged`, and writes **no** audit row. An actor
is not required on this path. `verifyDefinitions` still runs and fails the boot
if the persisted digest differs from the deployed code.

`syncInstallation` is called on every boot. It is an atomic conditional upsert:
an existing installation keeps its `application_id`; a bind to a different
application changes no row and fails with `InstallationMismatchError`.

## 5. Deliberate manifest change (drift procedure)

A code change that alters the serialized manifest (routes, permissions, version)
is **refused by default** with `ApplicationRegistrationDriftError`, which reports
both digests. This is intentional: changing a registered application is a
deployment decision, not a side effect.

To accept a reviewed change:

1. Confirm the deployed image is the intended release and note both digests from
   the error message.
2. Set `PLATFORM_REGISTRY_UPDATE=1` **and** a non-empty `PLATFORM_REGISTRY_ACTOR`
   identifying the operator or change ticket.
3. Boot once. The update is a compare-and-swap on the previously observed
   digest; the same SQL statement inserts one `updated` audit row containing the
   actor, previous/new digest and previous/new version. If another process won
   the race and the digest already equals the deployed one, `sync` returns
   `unchanged` and writes nothing.
4. Review the audit row before removing `PLATFORM_REGISTRY_UPDATE`. Leaving it
   set is a standing authorization for any future manifest change; treat it as a
   temporary flag.

What the audit table proves and does not prove:

- It records **who** accepted each create/update, **when**, and **which
  digests/versions** were involved.
- It does not record a reason or approval reference. Put the change ticket in
  the `actor` value or in the deployment record.
- Rows cannot be cascaded away: the foreign key to `platform_applications` is
  `ON DELETE RESTRICT`, so an application with history cannot be deleted.
- `unchanged` boots and refused drift write nothing, so the table is not a boot
  log.

## 6. Failure modes and operator action

| Symptom | Cause | Action |
| --- | --- | --- |
| `RegistryActorRequiredError` | first boot or accepted update without actor | set `PLATFORM_REGISTRY_ACTOR`; nothing was written |
| `ApplicationRegistrationDriftError` | deployed manifest differs from persisted digest | deploy matching code, or run the documented update procedure |
| `InstallationMismatchError` | installation id already bound to another application | use the installation id belonging to this application; do not rebind implicitly |
| `ApplicationRegistrationMissingError` | deployed application has no persisted registration | `sync` did not complete; check actor/migration state and rerun boot |
| `UnexpectedApplicationRegistrationError` | registry contains an application absent from deployed code | deploy the missing application or perform a reviewed registry cleanup; boot stays closed |
| `ApplicationRegistrationIntegrityError` | stored manifest malformed or digest does not recompute | treat as data corruption/tampering; do not bypass, investigate the row and restore from a trusted migration/deploy |
| `InstallationApplicationMissingError` | installation bound before its application registration committed | ordering defect; boot registration always syncs first |
| role assertion `identity_superuser` / `identity_bypass_rls` / `identity_createrole` | wrong credential for runtime or reader URL | point the URL at the provisioned role; never use the owner here |
| `membership_read_missing` | reader lacks table-level `SELECT` on `platform_memberships`, or migrations are absent | re-run `pnpm platform:provision-roles` after migrations |
| `membership_write_privilege` | reader can write the membership directory | re-provision; the reader must be SELECT-only |
| `DATABASE_URL and PLATFORM_RUNTIME_DATABASE_URL both authenticate as ...` | URLs not distinct | fix configuration; the process refuses to start |
| SQLSTATE `42P01` on `platform_application_registry_changes` | migration `0057` not applied | apply migrations before boot |
| Fastify `EADDRINUSE` | port already bound | stop the old process; verify only one writer owns registration |

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
- **Schema:** migration `0057` is additive (new table, index, FK). This runbook
  does not authorize dropping it or deleting audit rows.
- **Roles:** re-running the provisioner narrows privileges; it never drops a
  role. Dropping platform roles is a destructive, separately approved action.

## 9. Reference-app Playwright harness

`playwright.platform-reference.config.ts` starts a real reference-app process on
`127.0.0.1:7791` and runs `tests/e2e-platform/reference-app.spec.ts` through
Playwright's API request context (no browser binary, no staging secrets):

```bash
DATABASE_URL=... pnpm test:e2e:platform-reference
```

- Requires a database that already has migrations through `0057`; the harness
  fails with an explicit message otherwise.
- Each run uses a unique application id, installation id, two tenants, two
  platform roles and three bearer tokens. The staff principal can create/list in
  tenant A, a member principal can only read tenant A, and a separate principal
  reads tenant B.
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
