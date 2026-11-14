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
