# M03-S03 Disposable PG16 Operator and Recovery Runbook

**Restricted scope:** four ephemeral local PostgreSQL 16 databases (fixtures A–D) with names prefixed vibress_s03_. No production credentials, DB migration, deployment or role change is permitted.

## Actual disposable fixture inventory

The integration test provisions **four** randomly suffixed databases, not two:

| Fixture | Database name pattern | Purpose |
| --- | --- | --- |
| A | `vibress_s03_a_<hex-id>` | authorization, expiry, catalog drift, privileges |
| B | `vibress_s03_b_<hex-id>` | advisory lock contention |
| C | `vibress_s03_c_<hex-id>` | concurrent same-plan execution and journal |
| D | `vibress_s03_d_<hex-id>` | failed journal INSERT and retry |

Each fixture has separate `s03_author_<letter>_<hex-id>`, `s03_approver_<letter>_<hex-id>`, `s03_operator_<letter>_<hex-id>` and `s03_runtime_<letter>_<hex-id>` principals. Setup requires a **disposable PostgreSQL 16 superuser** only at `127.0.0.1:5433/vibress` with known test-only login. On teardown, close all connections, terminate only fixture backends and drop only the matching disposable databases and roles; query catalogs to verify removal. A failed cleanup remains a failure, never silently PASS.

## Preparations
1. Provision the distinct app installation database and non-superuser migration owner, unrelated app runtime login, independent plan author and approver. Prove effective grants, no runtime schema/database CREATE, table ownership, BYPASSRLS or inherited privileged role membership. Runtime must not read registry or approval tables.
2. An authorized provisioner records the authoritative installation/application/environment/database/owner/runtime binding and exact Schema Manifest v1 in the dedicated schema registry. The author stores the exact original manifest and canonical plan as TEXT. An independent actor approves exactly one operation with planned operator role, environment, expiry and revocation state.
3. Confirm the existing application-owned physical table's complete column set and row counts; no tenant-owned execution, unsafe defaults, unreviewed constraints or relation rewrites are supported. Do not use the old broad legacy CMS runtime role.
4. Execute only from the isolated database operator process; never load privileged credentials in API, worker, Fastify handlers or plugins.

## CLI syntax (illustrative; never paste real secrets into logs)

~~~bash
VIBRESS_SCHEMA_EXECUTOR_DISPOSABLE_CONFIRM=I_CONFIRM_DISPOSABLE \
SCHEMA_MIGRATION_OPERATOR_DATABASE_URL='postgresql://<operator>:<secret>@127.0.0.1:5433/vibress_s03_<fixture>' \
pnpm exec tsx packages/database/src/schema-operator-cli.ts <installation-id> <approved-plan-digest>
~~~

The CLI refuses production, nonloopback hosts, the default CMS database and missing disposable confirmation. It never accepts raw SQL. Explicit test admin provisioning and role cleanup occur only in the disposable integration test.

## Recovery matrix

| Observed outcome | Safe action |
| --- | --- |
| Old registry and catalog, no completed journal | Verify active approval and retry under lock |
| New registry/catalog, matching completed journal | Return ALREADY_APPLIED; do not rerun ALTER |
| Approval missing, expired or revoked | Refuse; obtain separate reviewed approval |
| Contended lock | Roll back; use new connection and retry within approval validity |
| Drifted column, extra constraint, RLS or owner mismatch | Halt; independent DBA reconciliation |
| Incomplete/conflicting journal or checksum | Halt; no automatic forward execution |
| COMMIT indeterminate or ROLLBACK failure | Destroy connection, read catalog and journal independently; forward-fix/recovery plan |
| Tenant-owned table or CREATE_RESOURCE | Unsupported; requires reviewed RLS/grant/namespace implementation |

Always sanitize audit output: no credentials, raw tenant records or untrusted SQL errors. A DB superuser can bypass all software checks; provenance and role administration must be independently reviewed. No automatic data-destructive rollback or production release is authorized.
