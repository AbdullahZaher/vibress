# M01 — Universal Application Kernel

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 1 · **Size:** XL (relative) · **Dependencies:** M00 · **State:** Proposed, not certified.

## Outcome

Let a brand-new nonpublishing app run without changing framework internals, while keeping the current CMS working.

## Workstreams and Epics

### M01-E01 — Domain vocabulary

Domain vocabulary: define Project, Application, Environment, Installation, Organization, Tenant, Principal and Publication separately.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M01-E02 — Public kernel contracts

Public kernel contracts: ApplicationDefinition/Context, ModuleDefinition, RequestContext, PolicyDecision and DomainEvent.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M01-E03 — Application registry

Application registry: persisted definitions, versioned modules and installation/environment records.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M01-E04 — Dependency inversion

Dependency inversion: application services use kernel ports; no publishing dependencies in kernel.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M01-E05 — Strangler compatibility

Strangler compatibility: preserve CMS routes, editor documents, publications, members, billing, migrations and data during extraction.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M01-E06 — Reference consumer

Reference consumer: task-manager using only public contracts, without posts/publications/newsletters imports.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/platform-kernel, app-contracts, app-registry and compatibility adapters
- Task-manager proof-of-concept
- CMS/Studio cross-version compatibility report

## Required acceptance gates

- [ ] Task-manager runs independently using stable public contracts.
- [ ] Kernel import graph does not depend on publishing domains.
- [ ] Old CMS content, membership, paid plans and Studio persisted document fixtures still pass.
- [ ] No app/tenant identity may be derived from a client-controlled publication fallback.

## Known risks and non-goals

- Avoid direct global renaming of publication_id; use additive migrations.
- Treat existing runtime deployments and data as immutable compatibility consumers.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Revised application runtime boundary

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M01-E07 — Application-per-installation reference runtime

Implement the M00-approved deployment topology. V1 default recommendation is one Application per Installation with independent deployment identity, DB credentials, storage and queue namespaces; a multi-tenant app uses an additional scoped tenant layer.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M01-E08 — Authenticated application context compatibility

Make app identity server-owned and unforgeable, keep the CMS publication resolver only inside a legacy adapter, and require no implicit pub_default fallback for newly generated applications.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] The task-manager can run as an isolated installation with distinct database credentials and no CMS publishing imports.
- [ ] No new app-owned repository reads or writes unscoped data through generic getDb(); tenant resources use the reviewed M02 transaction prototype.
- [ ] The application/installation/environment/tenant identities are unambiguous in API contracts and deployment fixtures.

**Implementation constraint:** M01 feature prototyping is **dev/staging only** until M02 independent tenant/security proof is achieved.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M01-E09 — General application packaging and extension boundary

Define developer-owned app package version, independently installable runtime artifact, typed custom action and route registration ports, and safe public web app template integration. The generic kernel must not import publishing modules or hand raw privileged DB/Fastify to plugins.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] An independent installation can own its application code, metadata, runtime/configuration and user-facing entry points through versioned contracts.
- [ ] Custom application/business logic can use approved action/route extension points without modifying the kernel or inheriting CMS publication defaults.

**Scope note:** A universal app kernel cannot be justified merely by names for Project/Application; it needs an executable route/action contract and ownership model.

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
