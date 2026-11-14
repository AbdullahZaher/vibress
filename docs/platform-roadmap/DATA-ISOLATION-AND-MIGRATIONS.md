# Application Isolation, PostgreSQL RLS and Migration Authority Contract

> **Target design for architecture review; NOT implemented by this documentation PR.** Sources: [existing pooled connection](../../packages/database/src/connection.ts), [transaction runner](../../packages/database/src/transaction/transaction-runner.ts), [runtime role](../../packages/database/src/runtime-role.ts), [current security report](../../SECURITY-REVIEW.md).

## 1. Distinct boundaries, deployment first

Recommended v1: **one application per installation/runtime**. Each installation has independently scoped database credentials, Redis/queue namespace, object-storage prefix/bucket access, secrets, runtime identity, ingress/domain and backup. A customer may run multiple isolated *tenants* within that app when the app explicitly supports tenant isolation. Full multi-application shared-process runtime is out of v1 and requires a dedicated threat model, namespace/pool/network separation and separate certification.

Tenant isolation inside an app uses **app ID + tenant ID + verified principal scope**, not `publication_id` or the incoming `x-publication-id` header alone. The legacy CMS resolver must remain backward-compatible and membership-validated, but application code must not inherit `pub_default`.

## 2. Mandatory read/write transaction port

**Existing limitation:** `getDb()` returns globally pooled Drizzle outside an `AsyncLocalStorage` transaction; `runInTransaction()` has no built-in verified tenant session variable. Merely enabling RLS on tables without controlling all query entry points will break old features or create accidental bypasses.

Define an **authorized tenant data unit-of-work** that:

1. Resolves and verifies app, tenant, actor and authorization from server-owned identities/memberships.
2. Opens a single database transaction under the runtime DML role.
3. Sets transaction-local app/tenant context using a parameterized command on **that exact transaction connection**; refuses empty/invalid claims.
4. Runs all tenant-owned SELECT/INSERT/UPDATE/DELETE through the **scoped transaction handle**, not generic `getDb()`/a second pool.
5. Requires policy checks for rows/fields/relations beyond database row isolation; commits or rolls back atomically.
6. Rejects any tenant-owned operation outside the scoped handle, including background jobs, generated routes, internal services and direct resource SDK calls.
7. Explicitly distinguishes deliberate audited system tasks (e.g. migrations, cross-tenant analytics) from user requests, with a narrow privileged actor and no web-request privilege escalation.

**Important limitation:** PostgreSQL custom session variables set with `SET LOCAL`/`set_config` are **not an authentication primitive** against code with arbitrary SQL access. They only improve isolation if application role SQL execution, credentials, queries and tenant context resolution remain trusted. Do not allow arbitrary SQL/extensions to set or spoof the context; test SQL injection and unsafe adapter paths separately.

### Illustrative interface, not shipped code

```ts
type VerifiedScope = {
  applicationId: ApplicationId
  tenantId: TenantId
  principal: VerifiedPrincipal
  authorization: AuthorizationSnapshot
}

await tenantUnitOfWork.run(scope, async (tx) => {
  // Unit of work sets transaction-local, validated context on tx's connection.
  await customerRepository.forTransaction(tx).getById(customerId)
})
```

The runtime layer owns `scope`; callers cannot create one using a bare tenant ID. Generated services receive only a scoped transaction handle. Validate transaction nesting and disallow switching tenants in nested units of work.

## 3. Physical schema and RLS policy contract

- **Topology-aware physical model:** on a dedicated app database/installation, the immutable application/installation identity is enforced via database credentials, metadata and deployment boundary; tenant-owned tables require a stable `tenant_id` or reviewed equivalent, scoped indexes and cross-tenant-safe composite foreign keys/unique constraints. An `application_id` column may be retained for provenance, but is **not automatically required on every row** when one application owns the database. A future shared-database multi-app topology **must separately prove app+tenant row isolation** before use.
- `ENABLE ROW LEVEL SECURITY`; use `FORCE ROW LEVEL SECURITY` when table ownership requires it; normal runtime is not an owner and has `NOBYPASSRLS`.
- Policies fail closed if application/tenant context is missing; `USING` applies to reads/update/delete and `WITH CHECK` enforces insert/update target ownership.
- Define explicit policies for shared/global catalog tables vs tenant-owned rows; **do not** indiscriminately enable RLS on auth/migration/system metadata without a migration/maintenance strategy.
- Database-per-installation already isolates apps at credential/data boundaries; tenant RLS is an additional guard *within* an installation.
- Foreign keys to cross-tenant models must be evaluated for existence disclosures and checked at API policy layer; never use an unscoped relation resolver or shared cache key.
- Run pool-reuse and mixed-tenant concurrency tests, including transaction rollback, idle client reconnect and prepared statements.

## 4. Privilege and migration authority separation

| Actor | Permitted | Prohibited |
| --- | --- | --- |
| Application runtime DML role | Approved SELECT/INSERT/UPDATE/DELETE and scoped functions only | Table ownership, schema CREATE/ALTER/DROP, BYPASSRLS, arbitrary function EXECUTE |
| Migration owner (one-shot job) | Review-approved schema changes on correct installation | Long-lived HTTP and normal worker execution |
| Plugin storage provisioner | Operator-approved, namespace-limited physical models and bounded migrations | Global `public` DDL or arbitrary SQL from a plugin/agent |
| Platform operator service | Audited deployment/maintenance actions through constrained APIs | Reuse as normal user transaction identity |
| Untrusted extension | **None in v1**; future isolated capability RPC only | DB credentials, arbitrary filesystem/network, privileged ESM |

Existing `provisionRuntimeRole` grants `CREATE ON SCHEMA public` and `EXECUTE ON ALL FUNCTIONS IN SCHEMA public`; migrate these carefully using measured production inventory, backwards compatibility, targeted grants, restrictions on `search_path`, tested rollback and plugin storage staging. Do not revoke credentials from existing live installations before verifying the replacement provisioner.

## 5. Schema compiler security and safe upgrades

Canonical IR enters through authenticated resource creation/modification controls. Validate field names, types, relation depth, index bounds, default expressions, reserved identifiers, namespaces and collisions; construct SQL with safe identifier escaping/parameter binding as applicable. **No user-supplied raw SQL** in managed application resource definitions; plugin physical schema changes must satisfy signed/operator-authorized plan. Ensure schema registry versions and migration checksums cannot be silently altered.

Use deterministic diff and plan previews, drift checks against live database, advisory locks and bounded lock/statement timeout, schema snapshots and repeatable backfill tests. The normal runtime cannot execute migration plans. Destructive/narrowing changes require explicit approval, backup/restore rehearsal, compatibility window, and either tested rollback (reversible) or forward-fix/runbook. Document RPO/RTO under failure; never promise zero data loss for arbitrary schema downgrades.

## 6. Minimum negative acceptance matrix

- Tenant A/B and application A/B (separate installs): list/detail/create/update/delete, relation and field access, search and exports.
- Missing/spoofed scope, different connection, nested transaction tenant switch, pooled connection reuse, worker retry under wrong tenant.
- Runtime role `CREATE/ALTER/DROP/TRUNCATE` denied; `BYPASSRLS` denied; attempted unsafe function/search_path/SQL context manipulation.
- Shared caches, object storage, signed URLs, webhook delivery, SSR caches, analytics and audit record ownership.
- Attempted schema declaration attack: conflicting identifier, malicious default, schema drift, unsanctioned DDL and stuck migration rollback.
- Legacy CMS data and plugin storage remain accessible only under correct legacy compatibility rights after the phased transition.

**Data lifecycle:** tenant offboarding, export/deletion, backup retention, cache/search/queue residues and legitimate audit/financial holds are separately specified in [Data Lifecycle and Operations](DATA-LIFECYCLE-AND-OPERATIONS.md). No instant erasure of immutable backups is promised.

**Gate:** M02 may be considered ready only after real PostgreSQL integration tests under the same deployable runtime role succeed. Documentation acceptance by itself does not enable public tenant hosting.
