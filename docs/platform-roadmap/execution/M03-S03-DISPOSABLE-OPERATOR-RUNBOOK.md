# M03-S03 Disposable PG16 Operator and Recovery Runbook

**Restricted scope:** eight ephemeral local PostgreSQL 16 databases (operator fixtures A–H), plus the separate Agent04 per-case fault fixtures E–Y, all randomly suffixed `vibress_s03_` databases. These independent test-file labels may overlap but names are unique to each run. No production credentials, DB migration, deployment or role change is permitted.

## Actual disposable fixture inventory

The primary operator integration test provisions **eight** randomly suffixed databases (A–H), not the original four:

| Fixture | Database name pattern | Purpose |
| --- | --- | --- |
| A | `vibress_s03_a_<hex-id>` | authorization, expiry, catalog drift, privileges |
| B | `vibress_s03_b_<hex-id>` | advisory lock contention |
| C | `vibress_s03_c_<hex-id>` | concurrent same-plan execution and journal |
| D | `vibress_s03_d_<hex-id>` | failed journal INSERT and retry |
| E | `vibress_s03_e_<hex-id>` | authenticated actor, forged identity, dual grants, SET ROLE, misgranted INSERT lock inversion |
| F | `vibress_s03_f_<hex-id>` | revocation committed before authorization |
| G | `vibress_s03_g_<hex-id>` | operator lock before concurrent revocation |
| H | `vibress_s03_h_<hex-id>` | journal rollback, replay and post-revocation denial |

Each fixture has separate `s03_author_<letter>_<hex-id>`, `s03_approver_<letter>_<hex-id>`, `s03_operator_<letter>_<hex-id>` and `s03_runtime_<letter>_<hex-id>` principals. Setup requires a **disposable PostgreSQL 16 superuser** only at `127.0.0.1:5433/vibress` with known test-only login. On teardown, close all connections, terminate only fixture backends and drop only the matching disposable databases and roles; query catalogs to verify removal. A failed cleanup remains a failure, never silently PASS.

## Preparations
1. Provision the distinct app installation database and non-superuser migration owner, unrelated app runtime login, independent plan author and approver. Prove effective grants, no runtime schema/database CREATE, table ownership, BYPASSRLS or inherited privileged role membership. Runtime must not read registry or approval tables.
2. An authorized provisioner registers distinct individually authenticated PostgreSQL LOGIN principals in the 0060 actor roster and records the authoritative installation/application/environment/database/owner/runtime binding and exact Schema Manifest v1 in the dedicated schema registry. The author stores the exact original manifest and canonical plan as TEXT. An independent actor approves exactly one operation with planned operator role, environment, expiry and revocation state.
3. Confirm the existing application-owned physical table's complete column set and row counts; no tenant-owned execution, unsafe defaults, unreviewed constraints or relation rewrites are supported. Do not use the old broad legacy CMS runtime role.
4. Execute only from the isolated database operator process; never load privileged credentials in API, worker, Fastify handlers or plugins.

## Agent 04 expanded fault laboratories (not part of original four)

The separate `platform-schema-migration-fault-injection.test.ts` file creates **one fresh fixture per case**, keys **E–Y**, with the same `vibress_s03_<letter>_<random-id>` naming convention and four distinct roles each. The primary operator integration file now creates eight labs A–H. Separate random test-run IDs prevent collisions with the Agent04 fault file. Tests require separate disposable databases; they are not authorized to reuse an application production/staging database. Each test's before/after SQL stage or termination mechanism is named in its `it(...)` title, and the [Agent 04 evidence report](M03-S03-AG04-FAULT-RECOVERY-REPORT.md) retains failed and passing attempts.

**Reproducible setup (disposable development lab ONLY):**

~~~bash
# Requires Docker, pnpm@11.22.0 and Node.js v24.22.3.
test "$(node --version)" = "v24.22.3"
pnpm install --frozen-lockfile
pnpm --filter @vibress/plugin-sdk build
docker compose -f compose.dev.yml up -d --wait postgres

# Fail closed unless the connection is exactly the test-only loopback fixture.
DATABASE_URL='postgresql://vibress:vibress@127.0.0.1:5433/vibress' \
pnpm exec vitest run --no-file-parallelism \
  tests/integration/platform-schema-migration-fault-injection.test.ts

docker compose -f compose.dev.yml down --volumes --remove-orphans
~~~

The test verifies server version is PostgreSQL **16.x**, that the fixture admin is a superuser **only inside disposable PostgreSQL**, and that the target URL has the precise expected database, username, password, port and loopback host. No production operator DSN is accepted. No production secrets enter CI. **Do not execute the Compose teardown on a shared Compose project or resource namespace.**

**Explicit cleanup:** Before `afterAll` finishes, it checks `pg_database` and `pg_roles` for the **exact random names created by the suite**. Any surviving fixture marks the run failed. The CI job subsequently removes the dedicated Compose services/volumes. The parent SIGKILL test explicitly waits for process termination and the wire proxy closes its own localhost listener. If cleanup fails, inspect/terminate only the exact test-owned resources; do not use wildcard DROP on unknown databases/roles.

**COMMIT uncertainty:** The test-only `pg-wire-proxy.ts` recognizes the PostgreSQL protocol `CommandComplete` for COMMIT, drops it before reaching the client and closes the TCP socket; the independent `read-only-reconcile.ts` compares registry, journal, full manifest, live physical columns and the seeded row checksum under a fresh `REPEATABLE READ READ ONLY` snapshot. `COMMITTED` means only idempotent `ALREADY_APPLIED`; `ROLLED_BACK` requires fresh authorization; any mixed state returns `HALT_UNRECONCILABLE`. Neither file is imported into runtime.

**Version baseline:** Node.js **v24.22.3** is the verified security-patched 24.x release dated 2026-11-11 (https://nodejs.org/en/blog/release/v24.22.3). The reviewed pre-fix integration used v24.22.2; the new CI run must record `node --version` and `current_setting('server_version_num')`. Only the supported Node24 line is updated; the unrelated Node25 Web/SPA development Dockerfiles were left untouched and need a separate compatibility review.

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
