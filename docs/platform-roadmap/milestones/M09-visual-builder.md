# M09 — Visual Application Builder

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 4 · **Size:** XXL (relative) · **Dependencies:** M03,M04,M07; GA after M08 · **State:** Proposed, not certified.

## Outcome

Let non-developers build secure apps visually using exactly the same canonical app resource IR as code-first.

## Workstreams and Epics

### M09-E01 — Visual data modeler

Visual data modeler: models/fields/relations/policies and safe migration preview.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M09-E02 — Form builder

Form builder: layouts, conditional inputs, validated fields, files and dynamic relations.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M09-E03 — Data tables and dashboards

Data tables and dashboards: filters, metrics, charts, row actions and dashboards.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M09-E04 — Page/layout builder

Page/layout builder: routing, navigation, reusable design tokens, themes and responsive components.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M09-E05 — Action/data bindings

Action/data bindings: secure preview, workflow wiring and explicit server runtime permissions.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M09-E06 — Visual-code synchronization

Visual-code synchronization: IR ownership, generated regions, version history and export review.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M09-E07 — Accessibility/RTL/IME and collaboration

Accessibility/RTL/IME and collaboration: real devices and recovery as an acceptance gate.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- apps/builder and packages/ui-engine/visual-builder
- Canonical visual schema and export-import contract
- No-code CRM demo and user acceptance test plan

## Required acceptance gates

- [ ] A noncoder creates and deploys a CRM to staging without handwritten CRUD.
- [ ] Visual changes produce reviewable versioned resource definitions; custom code is never silently lost.
- [ ] Generated preview and production both enforce resource/tenant policies server-side.
- [ ] A11y, keyboard, RTL and real mobile test matrix meets accepted quality budget.

## Known risks and non-goals

- Lexical content JSON is not a general-purpose UI/application schema.
- Full Wix-parity page designer is secondary to working resource/forms/dashboard builder.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Visual builder is an authority-restricted client, not a second compiler

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M09-E08 — Canonical IR and code ownership contract

Visual edits compile to the same reviewed resource IR used by TypeScript and agents; preserve handwritten code with explicit generated file ownership and conflict resolution.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M09-E09 — Builder preview threat model

Enforce auth/policy and tenant isolation on preview/serialized UI; prevent script injection, unsafe URL fetching, secrets exposure and data leak through preview users.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] Visual definition import/export preserves resource IDs, migration versions and permissions; conflicts are reported rather than silently overwritten.
- [ ] Preview cannot fetch another installation/tenant data or run unrestricted script/external requests.
- [ ] Manual mobile RTL, keyboard, screen-reader and content recovery acceptance is recorded for supported devices.

**Implementation constraint:** The standalone Lexical Studio editor remains document/content oriented and must not be used as the general app schema.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### Additional blocking exit checks

- [ ] Visual/AI IR is limited to declarative models/pages/actions; the designer cannot silently round-trip or overwrite arbitrary application TypeScript.
- [ ] Generated previews and external web routes honor the same effective server-side policy and audit constraints.

**Scope note:** See Application Runtime and Extensibility for distinctions between declarative visual metadata and developer-owned code.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).


### Blocking exit checks

- [ ] Visual builder output never promotes unreviewed custom code into trusted app-server or plugin execution; runtime owner approves compiled code and network capabilities.
- [ ] Builder data-binding previews remain within the selected physical installation and enforce tenant policy and scoped credentials.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

## International accessibility and product quality target

- [ ] The eventual visual builder specifies [WCAG 2.2 AA](https://www.w3.org/TR/wcag/) as a target for its declared supported user journeys, with real keyboard, focus, screen-reader, high-contrast, RTL and automated regression testing; no AA conformance claim without scoped evaluation.
- [ ] Builder-generated pages/forms conform to declared [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) product-quality targets with measured authoring recoverability, correct output, security and reliability. Neither measure is automatic from successful compilation.

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
