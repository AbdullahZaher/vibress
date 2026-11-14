# M02 — Security, Identity & Multi-Tenancy

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 1 · **Size:** XL (relative) · **Dependencies:** M01 (audit from M00) · **State:** Proposed, not certified.

## Outcome

Ship deny-by-default principal, policy and real tenant isolation boundaries for every supported app data surface.

## Workstreams and Epics

### M02-E01 — Identity

Identity: distinguish platform operators from application owners, staff, end users and service accounts; auth adapters and optional MFA/SSO.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E02 — Authorization

Authorization: RBAC, resource and field permissions, row-level policy checks, extensible ABAC with default deny.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E03 — Trusted context propagation

Trusted context propagation: app/tenant/principal identities through API, generated local services, workers, websocket, storage and cache.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E04 — PostgreSQL RLS

PostgreSQL RLS: ENABLE/FORCE as appropriate; transaction-local trusted context on same connection; non-BYPASSRLS roles.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E05 — Role separation

Role separation: runtime DML vs migration owner vs approved plugin schema provisioning; remove broad public CREATE from app workers.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E06 — Security tests

Security tests: IDOR/cross-tenant, request spoofing, pool reuse, cache leakage, alternate API, delayed jobs, exports and webhooks.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E07 — Audit/secrets

Audit/secrets: scoped machine credentials, encryption, rotation, denial logging and production edge verification.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/tenancy, policy-engine, principal-context and RLS adapter
- RLS migration plan and real PostgreSQL negative-test matrix
- Least-privileged runtime/provisioner roles and staging evidence

## Required acceptance gates

- [ ] Cross-app and cross-tenant reads/writes are denied under actual nonowner PG role.
- [ ] Missing/forged tenant context fails closed through every supported execution surface.
- [ ] SET LOCAL uses the same transaction connection and leaks no tenant context across pooled connections.
- [ ] Existing production prelaunch controls undergo new staging/security evidence and sign-off.

## Known risks and non-goals

- RLS is explicitly disabled in current security review; do not claim otherwise.
- Plugin runtime DDL grants are currently wider than desired and need dedicated authorization.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Blocking RLS and privilege evidence

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M02-E08 — Scoped transaction unit of work

Build tenantUnitOfWork that validates server-owned principal/app/tenant context, sets transaction-local scope on the identical Drizzle/PG transaction handle, and forbids tenant-owned access through unscoped getDb(). Reject changes of tenant within a nested transaction.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M02-E09 — RLS policy coverage and maintenance exceptions

Define per-table app+tenant USING/WITH CHECK policies; include composite FK/unique isolation, default-deny missing context, owner/force-RLS decisions and audited service/migration escape hatches, without granting SQL capabilities to plugins.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M02-E10 — Plugin provisioning grant migration

Replace general CREATE public and broad function EXECUTE grants to API/worker with a separately authorized schema installer after staging existing plugin storage and migrations; include safe rollback/forward-fix evidence.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] A tenant-owned read/write performed outside the scoped transaction fails closed, including generated APIs, workers, exports and direct service calls.
- [ ] PostgreSQL tests cover pool reuse, nested-context switch, app/tenant ID spoofing, INSERT WITH CHECK, owner/BYPASSRLS, FK relations and an audited maintenance principal.
- [ ] Normal runtime credentials cannot create arbitrary tables or execute arbitrary schema functions; existing CMS/plugin storage still works using authorized migrations.

**Implementation constraint:** SET LOCAL/custom GUC is a row-policy input, not identity proof if the caller has arbitrary SQL access. Authentication and SQL mediation are separate controls.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M02-E11 — Tenant data lifecycle and authorization

Define signed-off owner/tenant export, deletion/offboarding, session/API key revocation, cache/queue/storage/search cleanup and backup retention caveats. Test that a different tenant cannot request another tenant's export/delete.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] Tenant export/offboarding and revoked credentials are authorization-tested, with data classes covering SQL, object storage, logs, queues, index and backups.
- [ ] Per-installation database and credential separation is tested; intra-app tenant RLS does not assume an unnecessary duplicate application_id on every table.

**Scope note:** Applicable legal/privacy requirements depend on deployment and must receive appropriate owner/legal review; this PR is not a compliance certification.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M02-E12 — Function effective ACL and SECURITY DEFINER audit

Inventory and restrict PUBLIC/inherited/default function EXECUTE, SECDEF owners/search_path and schema CREATE privileges under normal runtime credentials. Check newly created and migrated functions across actual PostgreSQL versions.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### M02-E13 — Multi-policy RLS and non-row privilege tests

Define permissive/restrictive policy composition per generated table and deny accidental OR widening. Explicitly block runtime TRUNCATE and REFERENCES privileges and test owner/BYPASSRLS, FK errors and WITH CHECK.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### M02-E14 — Cross-install infrastructure access tests

Enforce independent per-app database/credentials, Redis ACL/worker queues, object-store IAM and key/secret handling, not merely namespaced prefixes; stage migration and credential rotation.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] Effective function grants from PUBLIC, inherited roles and defaults are denied for sensitive functions, including SECURITY DEFINER fixtures and safe search_path.
- [ ] Two simultaneously applicable RLS policies cannot produce unauthorized OR widening; TRUNCATE/REFERENCES are blocked using SQL ACLs.
- [ ] Two app-installation credentials cannot cross-query or mutate each other's PostgreSQL, Redis/queue, object storage, secrets or backup resources; no SQL/GUC claim of hostile-code sandboxing.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

## Fourth-pass acceptance: views, nested transactions and complete backup scope

These cases extend **M02-E08/E09/E13** and the earlier [RLS permission model](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md). See [test contract](../RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md).

- [ ] Ordinary PostgreSQL view owner policy and, for supported versions, `security_invoker` behavior are checked under real runtime roles; views/materialized reports are prohibited in generic v1 if not proven safe.
- [ ] Tenant-scoped nested transaction mismatch and swallowed child failures cannot leave unintended committed writes; rollback-only or explicitly tested savepoint semantics documented.
- [ ] `row_security=off` is treated as an error-on-filtering control, **not an RLS bypass**; backup privileges, scope and row-level reconciliation are separately verified.
- [ ] Two-publication CMS migration is not confused with verified generic Application/Tenant policies, and existing identities are not broadened by default.

## Milestone closure evidence ledger

| Evidence | Status / link |
| --- | --- |
| Accountable owner | TBD |
| ADR / public contract | TBD |
| Immutable implementation commit SHA | TBD |
| CI checks and test fixtures | TBD |
| Security/tenancy and migration evidence | TBD |
| Deployment/restore evidence | TBD |
| Independent reviewer and decision | **OPEN — not certified** |

## Program links

[Master roadmap](../README.md) · [Security gates](../SECURITY-AND-RELEASE-GATES.md) · [Governance](../DELIVERY-GOVERNANCE.md) · [Existing work](../EXISTING-ASSETS.md)
