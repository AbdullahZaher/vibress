# M03-S03 Engineering and Security Report

**Project:** Vibress Universal Platform | **Wave:** 2 | **Milestone:** M03-S03  
**Issue:** [#197](https://github.com/AbdullahZaher/vibress/issues/197) | **Parent:** [#155](https://github.com/AbdullahZaher/vibress/issues/155) | **Draft PR:** [#198](https://github.com/AbdullahZaher/vibress/pull/198)  
**Exact baseline:** 251bef39325476bcbbe84d80ed451851a079695a (merged M03-S02).  
**Candidate and CI:** obtain exact current PR HEAD and compare the GitHub synthetic merge tree at final handoff. Intermediate cancelled runs are not acceptance evidence.  
**Production:** NO-GO | **Merge:** NOT AUTHORIZED | **Independent Agent 06 assessment:** PENDING.

## A. Architecture, discovery and trust boundary

The accepted schema engine provides Canonical IR v1, Manifest v1, Plan v1, deterministic SHA-256 checksums, installation/application scope and fail-closed operation classification. It does not authorize DDL. The existing platform application registry stores code manifests and installation identity; it must not be conflated with the schema-manifest registry. Existing runtime privilege verifier and the platform CRM fixture provide Wave 1 role isolation. The older CMS runtime-role provisioner still grants public CREATE and broad EXECUTE and is **not an acceptable migration runtime identity**. The existing Drizzle migration system remains separate and unchanged except for an additive 0059 metadata-table migration.

### Boundary diagram

~~~text
Untrusted resource source / plan author
  -> Canonical IR v1 + deterministic Manifest/Change Plan v1
  -> separately provisioned canonical TEXT registry and independent approval
  -> isolated operator-only Node process (no API/worker/plugin link)
  -> dedicated PostgreSQL 16 non-superuser operator connection
  -> BEGIN SERIALIZABLE, bounded timeouts, installation advisory transaction lock
  -> authoritative installation and plan rehydration, authorization, journal check
  -> effective role + exact live catalog verification
  -> ONE optional scalar ADD COLUMN to an existing application-owned table
  -> postcondition and seeded row-count verification
  -> compare-and-swap manifest + journal INSERT, same transaction as DDL
  -> COMMIT or explicit ROLLBACK and manual indeterminate reconciliation
~~~

The installation topology remains one application per dedicated database, with runtime, owner and approver roles separate. The operator cannot be invoked from Fastify, an ordinary worker, a plugin hook or an HTTP request. The CLI refuses a production environment, an unconfirmed operation, a non-loopback host and any target database not matching the disposable vibress_s03_* prefix.

## B. Trusted manifest and plan provenance

Migration 0059 introduces operator-owned platform_schema_registry, platform_schema_plans, platform_schema_approvals and platform_schema_migration_journal. The schema registry references existing authoritative platform_installations and platform_applications. Plans store the exact prior manifest, canonical proposed plan, author and digest; approvals bind installation, plan digest, single operation, approver, intended operator role, environment, expiry and revocation.

Canonical Manifest and Change Plan representations use **TEXT**, not PostgreSQL JSONB: JSONB reorders keys and would break accepted byte/order-sensitive canonical rehydration. Only nonsigned journal evidence uses JSONB. No automatic grants to application, worker or PUBLIC are added by 0059. Registry/approval provisioning and grant inventory are the responsibility of the separately authorized owner, not a client or this executor.

rehydrateSchemaChangePlan rejects unknown versions, altered checksums, operation status/IDs, noncanonical order, changed plan fields, cross-installation reuse, Proxies, accessors, symbols, sparse arrays, nonplain prototypes and oversized data. It recreates the plan from the independently stored current manifest and canonical proposed IR, rather than trusting persisted status flags. A SHA-256 checksum proves consistency only; authority requires a separately stored authorized approval and narrow effective DB grants.

**Unresolved provenance gate:** authenticated human/DBA approver provisioning, tamper-evident failed-attempt audit, and DB-role grant policy across fresh/upgraded deployments need independent approval. An authorized DB superuser or privileged approval-writer compromise is outside the data-parser's threat model.

## C. PG16 SQL rendering and catalog checks

**Supported:** exactly one PLANNED optional scalar ADD_FIELD with no default on one existing application-owned resource table. Valid physical mappings: text, double precision, boolean and timestamp with time zone. The table and column names are compiler-owned PG16-safe ASCII identifiers, quoted in qualified static SQL; user strings and raw expressions never become executable SQL. No IF NOT EXISTS masking of an unexpected pre-existing column.

**Blocked:** CREATE_RESOURCE, tenant-owned resource operations, RLS/view provisioning, DROP, RENAME, type rewrites, ownership transitions, default expressions, required/backfill fields, indexes/foreign keys, more than one operation, and every DENIED/UNSUPPORTED/REQUIRES_REVIEW operation.

The executor rechecks current_database and session_user/current_user, authoritative installation environment and one-installation database topology, operator vs runtime role, effective non-superuser/no BYPASSRLS, runtime CREATE/TRUNCATE/REFERENCES/TRIGGER, privileged memberships, access to public SECURITY DEFINER functions, table and namespace ownership, table kind/persistence/inheritance/RLS, unexpected triggers or constraints, and every column type/nullability/default/identity/generated attribute. All checks and postcondition verification are under the same transaction fence.

**Known limits:** no live namespace reservation for CREATE_RESOURCE; no tenant-owned table execution; no assertion of deployed CMS role compliance. An existing unknown constraint/default or schema drift fails closed rather than guessed compatible.

## D. Concurrency, migration journal and recovery

The operator uses a dedicated PostgreSQL connection with 2s lock timeout, 10s statement timeout, 15s idle-in-transaction budget, SERIALIZABLE transaction and installation-keyed pg_advisory_xact_lock. Lock hash collisions only over-serialize, never allow concurrent writes. It compares the registry's exact old manifest/digest, checks the journal, validates live catalog, performs one ALTER and postcondition verification, performs registry digest CAS and inserts a COMPLETED journal record **before COMMIT**. DDL, registry state and journal commit or roll back atomically.

A completed matching journal and verified new catalog returns ALREADY_APPLIED with no new SQL. Missing/mismatched authorization, plan, journal or catalog state aborts. Failure before COMMIT attempts ROLLBACK. Unknown COMMIT or failed ROLLBACK outcomes return INDETERMINATE: destroy session, check journal and catalog on a new authorized connection, and request a reviewed forward-fix if mismatch exists. No automatic DROP or destructive rollback is offered.

**Residual:** rolled-back failures do not leave a completed journal row; a separate durable sanitized failure/incident sink is required. Exact approval-revocation race, role ACL inventories, and indeterminate commit fault evidence remain independent security gates.

## E. PostgreSQL role evidence and laboratory

The integration test provisions two **new isolated disposable** local PostgreSQL 16 databases, each with distinct author, approver, migration table owner and runtime logins. It rejects non-loopback, unexpected host port or non-test control databases, and requires a disposable superuser only for fixture setup and cleanup. Production DBs, production credentials and production migrations are never touched.

Tests cover missing, revoked and expired approvals, forged plan JSON, runtime ALTER/CREATE/DROP/TRUNCATE and registry-read denial, cross-installation CONNECT denial, unexpected column drift, same-installation concurrency, advisory lock timeout, completed journal replay, and rollback of ALTER if journal INSERT is denied. Seeded record counts must remain unchanged across successful ADD_COLUMN and failure injections. These tests use actual PG role connections, not only TypeScript mocks.

**Tenant RLS certification is INCOMPLETE:** this bounded candidate never operates on tenant-owned generated tables. Existing Wave 1 RLS tests are retained but do not certify a future generated tenant policy. PUBLIC and inherited SQL privilege probes must be revalidated on the actual target role topology.

## F. Compatibility and upgrade contract

Canonical IR v1, Manifest v1, Plan v1 and digest generation remain unchanged. New metadata tables are additive. The supported nullable column is a forward-compatible expand-only change for old and new API/worker processes because old code need not write it; automatic downgrade and backfill are unsupported. API/worker routes, existing CMS content and plugin/theme contracts are not modified.

Existing migration files remain unchanged. Migration 0059 is added to the Drizzle journal and schema definitions. **Drizzle generation review on Node 24 and fresh-install/upgrade replay are verification gates**, not to be assumed from manual SQL inspection. Legacy CMS runtime CREATE and broad PUBLIC/function EXECUTE privileges must be inventoried and remediated through a separate operator-approved deployment plan, never silently revoked here.

## G. Engineering status, findings and Agent 06 review

**Evidence:** authoritative final PR SHA CI link, Node/PG16 versions, unit and integration results and synthetic merge tree comparison must be appended once completed. Do not cite a cancelled intermediate run as acceptance.

**Outstanding review register:**
- Authentication and genuine provenance of approval-writer and operator privileges; effective inherited/PUBLIC grants and SECURITY DEFINER behavior (security sensitive).
- Tenant-owned RLS is **unsupported**, not certified. CREATE_RESOURCE also unsupported.
- Full failure-audit persistence and revocation/concurrent approval behavior under real grant matrices.
- Production-style backup/restore, upgrade from old CMS and mixed-version worker traffic.
- Node24 Drizzle migration generation/replay and exact final CI evidence.

**Review request:** Agent 06 must independently inspect code, root privilege checks, catalog SQL, canonical plan rehydration, lock/journal commit order, failure injection, test isolation, compatibility and all four required CI jobs, classify findings P0/P1/P2/P3 and decide acceptance separately.

**Engineering readiness: NO-GO. Independent review: PENDING. Merge: NOT AUTHORIZED. Production: NO-GO.** M03-S04 must not assume tenant resource creation or RLS provisioning is supported by this limited execution slice.
