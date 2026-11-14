# M04 — API & Admin Generation Engine

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 2 · **Size:** XL (relative) · **Dependencies:** M03 · **State:** Proposed, not certified.

## Outcome

Provide Payload-class productivity: secure generated REST/OpenAPI, TypeScript clients and Admin CRUD from one resource definition.

## Workstreams and Epics

### M04-E01 — CRUD operations compiler

CRUD operations compiler: typed operations, validation, optimistic concurrency, safe filters and list pagination.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M04-E02 — REST/OpenAPI generator

REST/OpenAPI generator: documented endpoints, errors, versioning and authenticated exposure controls.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M04-E03 — Typed application SDK

Typed application SDK: generated client with scopes and stable error model.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M04-E04 — Host-rendered Admin UI

Host-rendered Admin UI: resource forms, list views, filters, details, relations and declarative metadata.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M04-E05 — Authorization binding

Authorization binding: row, field, relationship and bulk/export projections enforced server-side.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M04-E06 — Extension lifecycle

Extension lifecycle: authorized hooks and validated custom actions without bypassing permissions.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M04-E07 — Performance guardrails

Performance guardrails: resource limits, unbounded query prevention, rate limits and external consumer tests.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/api-generator, admin-view-generator and typed client generator
- Secure generated CRM REST/OpenAPI/Admin UI
- Sample clean consumer and generated API conformance tests

## Required acceptance gates

- [ ] CRM CRUD/UI/API can be generated with no handwritten route or basic form code.
- [ ] Field/record policies apply consistently across list, detail, search, exports and mutations.
- [ ] New service works outside monorepo and tests pass in a clean environment.
- [ ] Query complexity and tenant data exposure negative tests pass.

## Known risks and non-goals

- Defer GraphQL until a separate query/security complexity gate.
- Generated Admin may not execute untrusted plugin JSX on privileged origin.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Generated query and response authorization

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M04-E08 — Negative authorization conformance suite

Test read/list/detail/bulk/aggregate/count/filter/sort/search/export, nested relations, hidden/derived fields, generated OpenAPI/typed SDK, SSR/cache variants and service credentials.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M04-E09 — Resource cost and schema exposure budget

Limit relation depth, pagination, sorting indexes, payload sizes, mutation batch sizes and expensive aggregation; hide secrets and private schema metadata from unauthorized client generation.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] Generated APIs reject unauthorized counting/aggregation/filtering that would reveal protected records or field values.
- [ ] SSR and cache vary by application, tenant, principal/scope and data visibility where required.
- [ ] Generated CRUD works with independent clean-install consumer and no custom Fastify route, while all queries remain scoped and bounded.

**Implementation constraint:** GraphQL is explicitly excluded from v1 mandatory scope pending its own query complexity/security design.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M04-E10 — Typed custom endpoint and user-facing client security

Expose an approved trusted application HTTP handler/action registration contract with path/body validation, authorization and tenant-bound unit of work. Provide typed client integration for a developer-owned end-user web page and test SSR/cache/CSRF properties; no raw privileged Fastify/SQL escape hatch.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] Independent CRM exposes a custom authenticated deal-approval endpoint, backed by a transactionally safe action, and tests scope/role denial.
- [ ] A user-facing frontend (not only Admin) consumes the public typed client; SSR and cache paths cannot leak another tenant or principal data.

**Scope note:** Custom trusted application code is in a separately controlled app installation. Untrusted installed plugins do not gain arbitrary server code/SQL execution via generated endpoint metadata.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).


### Blocking exit checks

- [ ] Custom authenticated route, generated CRUD and non-admin end-user UI all use a reviewed scoped access boundary; sensitive DB functions are not exposed as an authorization bypass.
- [ ] An external clean CRM app and generated API run without direct plugin SQL, privileged Fastify escape hatches or undocumented internal imports.

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
