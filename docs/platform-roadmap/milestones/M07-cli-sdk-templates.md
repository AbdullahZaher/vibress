# M07 — Developer CLI, SDK & Application Templates

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 3 · **Size:** L (relative) · **Dependencies:** M03–M06 · **State:** Proposed, not certified.

## Outcome

Provide reproducible self-hostable creation, extension and upgrade of applications via a public SDK, CLI and templates.

## Workstreams and Epics

### M07-E01 — CLI

CLI: vibress create/add/generate/doctor/upgrade --plan/upgrade --apply/verify with dry-run and safe defaults.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M07-E02 — Public app SDK

Public app SDK: typed queries/actions/resources, identity, events, storage and notifications.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M07-E03 — Templates

Templates: minimal, SaaS, CRM, admin/dashboard, CMS; later real-estate, booking and commerce.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M07-E04 — Clean installed consumers

Clean installed consumers: compile/run with published/packed packages outside monorepo.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M07-E05 — Upgrade UX

Upgrade UX: codemods, compatibility checks, handwritten vs generated ownership and restore guidance.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M07-E06 — Developer docs

Developer docs: quickstart, API and Plugin SDK, migration and production checklist.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M07-E07 — Golden apps

Golden apps: CMS, CRM, real estate, booking and commerce using only public framework APIs.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/cli, app-sdk and templates with docs
- Five clean installed golden applications
- Versioned module and app upgrade conformance suite

## Required acceptance gates

- [ ] A CRM app is created and boots in a clean environment without kernel edits.
- [ ] Adding and upgrading an external module works through documented public APIs.
- [ ] All templates run their auth/tenant/security tests as generated.
- [ ] Handwritten customizations survive code regeneration or produce an explicit merge conflict.

## Known risks and non-goals

- Scaffolds drift without continuous published-package install tests.
- CLI commands are target proposals, not current Vibress commands.

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
