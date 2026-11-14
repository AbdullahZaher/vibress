# M00 — Engineering Baseline & Architecture Governance

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 1 · **Size:** M (relative) · **Dependencies:** None · **State:** Proposed, not certified.

## Outcome

Freeze reproducible current-state evidence and decide immutable boundaries before extracting a general framework.

## Workstreams and Epics

### M00-E01 — Repository inventory

Repository inventory: classify apps, domains, packages, dependencies, API/Studio/plugin contracts as existing, partial or planned.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M00-E02 — Architecture ADRs

Architecture ADRs: define the new app identity vocabulary, module ownership, versioning, hosting and trust decisions.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M00-E03 — Boundary enforcement

Boundary enforcement: codify Nx/ESLint rules to forbid kernel→publishing, UI→database and plugin→private internals imports.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M00-E04 — Compatibility baseline

Compatibility baseline: pin host and Studio commits, collect CMS documents, subscriptions, roles, media, Yjs and migration fixtures.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M00-E05 — Quality governance

Quality governance: capture security findings, CI/scan/restore evidence, risks, support matrix, approval and release process.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M00-E06 — Traceability

Traceability: establish epic→issue→PR→tested evidence→signoff ledger.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- Versioned baseline architecture report and package inventory
- ADR index and dependency-boundary automation
- Legacy fixture harness and evidence/risk ledger

## Required acceptance gates

- [ ] A clean repository checkout reproduces documented baseline test commands.
- [ ] Architectural boundary tests reject deliberately forbidden imports.
- [ ] Every current app/package has an explicit ownership map and migration strategy.
- [ ] Baseline gaps, including production certification limits, remain visible and are not marked done without evidence.

## Known risks and non-goals

- Existing prelaunch security review remains CONDITIONAL; no production certification inferred.
- Do not overwrite historical source/Studio/plugin roadmaps.

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
