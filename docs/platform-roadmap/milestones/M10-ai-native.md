# M10 — AI-Native Development Platform

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 4 · **Size:** XL (relative) · **Dependencies:** M07; integrations with M09 · **State:** Proposed, not certified.

## Outcome

Make agents productive but tightly permissioned developers of resources, modules, migrations, interfaces and tests.

## Workstreams and Epics

### M10-E01 — Agent SDK

Agent SDK: typed inspect/create/update/validate commands against public application DSL.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M10-E02 — MCP server with scoped principal and tool capabilities; no arbitrary tenant selectors.

MCP server with scoped principal and tool capabilities; no arbitrary tenant selectors.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M10-E03 — Skills/AGENTS.md

Skills/AGENTS.md: ADR-aware guidance for modules, migrations, test plans and security.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M10-E04 — Approval flow

Approval flow: diffs, destructive migration preview, dependency changes and privileged operations.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M10-E05 — Constrained runtime

Constrained runtime: no unrestricted production credentials, shell or secret access.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M10-E06 — Evaluation harness

Evaluation harness: pinned tasks across CRM, booking, real estate; record fixes, costs, regressions and violations.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M10-E07 — Visual compatibility

Visual compatibility: apply changes to same canonical resource IR, not separate agent state.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/agent-kit + scoped MCP tools
- Agent policy and approval integration
- Reproducible agent task evaluation suite

## Required acceptance gates

- [ ] Agent can generate and test a CRM module without kernel edits.
- [ ] Unauthorized tools and production database changes are denied independent of prompt wording.
- [ ] Privileged actions produce principal/app/tenant auditable records.
- [ ] Model/tool versions and reproducibility limitations are recorded with benchmark evidence.

## Known risks and non-goals

- Prompt instructions are guidance, not a security boundary.
- Avoid claiming AI autonomy or accuracy based on one successful demo.

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
