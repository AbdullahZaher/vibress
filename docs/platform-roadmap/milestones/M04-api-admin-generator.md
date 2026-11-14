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
