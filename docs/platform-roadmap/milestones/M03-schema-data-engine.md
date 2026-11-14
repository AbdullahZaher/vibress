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
