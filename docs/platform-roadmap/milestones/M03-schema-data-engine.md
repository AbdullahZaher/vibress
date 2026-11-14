# M03 — Universal Schema & Data Engine

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 2 · **Size:** XL (relative) · **Dependencies:** M01–M02 · **State:** Proposed, not certified.

## Outcome

Turn typed application resources into reviewable PostgreSQL schemas without depending on publishing models.

## Workstreams and Epics

### M03-E01 — Universal resource DSL

Universal resource DSL: text, numbers, money, datetime, enum, media, relations, localization, JSON and Studio documents.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E02 — Canonical IR and registry

Canonical IR and registry: one versioned representation for code-first, visual builder and agent tools.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E03 — Relational rules

Relational rules: indexes, unique constraints, foreign keys, concurrency tokens, soft delete and deterministic pagination.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E04 — Schema compiler

Schema compiler: produce migrations, schema manifests, validation rules and change reports.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E05 — Storage strategy

Storage strategy: physical Postgres tables for transactional data plus bounded dynamic models; avoid JSONB-only design.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E06 — Schema evolution

Schema evolution: expand/contract, backfill, safe renames, compatibility windows and destructive-change approvals.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E07 — Security coupling

Security coupling: every generated tenant-owned resource requires consistent ownership/policy/RLS semantics.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/schema-engine, resource-contracts, migration-planner and postgres adapter
- Resource DSL specification with migration safety rules
- CRM schema fixture for customers/deals/activities

## Required acceptance gates

- [ ] CRM schema compiles to real relations, constraints and versioned migrations.
- [ ] Additive migration and backfill retain live fixture records; unsafe destructive changes require approval.
- [ ] Resource introspection does not leak forbidden fields or tenant data.
- [ ] A new domain resource is independent from Publication and Posts.

## Known risks and non-goals

- Automatic rename inference can silently destroy data; never assume equivalence.
- Complex financial/order records should preserve strong relational constraints.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Migration trust and executable schema guarantees

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M03-E08 — DDL trust boundary and namespace reservation

Validate canonical resource IR and identifiers; reserve namespaces per app/module; reject raw untrusted SQL, unsafe expressions and cross-app models. Run generated DDL only through a separate installer with approval.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M03-E09 — Migration drift, concurrency and compatibility

Record checksums; verify live DB drift; lock concurrent migrations; apply lock/statement budgets; preview data backfill; define expand-contract windows and operator-approved forward-fix after irreversible changes.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] A malicious or malformed resource definition cannot cause arbitrary DDL, privilege escalation, unsafe default expression or another app's table alteration.
- [ ] Concurrent schema updates, drifted migration checksums and interrupted backfills fail safely with a recoverable operator plan.
- [ ] Dynamic resource and physical table strategies explicitly document tenant/security limits and migration tradeoffs.

**Implementation constraint:** An API user, visual editor or AI agent must never obtain DDL privileges simply by submitting a model descriptor.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M03-E10 — Topology-aware identity and schema compatibility

Select per-installation physical schema ownership and tenant discriminators; add application_id only where justified by physical deployment. Define deterministic resource migration and stable event/schema compatibility contracts.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] Physical keys and scoped foreign keys match the approved per-installation topology, with tests of tenant isolation independent of unnecessary app_id duplication.
- [ ] Schema-version and migration-manifest checksums are stable across clean app installs and staged upgrades.

**Scope note:** Avoid forcing both app_id and tenant_id into every table without considering physical DB-per-application architecture.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M03-E11 — Mixed-version schema compiler and backfill compatibility

Design old/new API and worker compatible expand/backfill/contract migrations, registry and migration-plan digests, concurrent installer fencing and failure recovery.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] Generated schema changes are tested against old and new API/worker and rollback/forward-fix fixtures with seeded rows and in-flight jobs.
- [ ] Safe installer stops on schema drift, concurrent operation or incompatible backfill and documents observed recovery rather than claiming automatic lossless downgrade.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

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
