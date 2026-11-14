# M08 — v1 Production Certification & Public Release

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 3 · **Size:** XL (relative) · **Dependencies:** M00–M07 · **State:** Proposed, not certified.

## Outcome

Release stable, self-hostable, independently assessed code-first Vibress Platform v1.0 with reproducible evidence.

## Workstreams and Epics

### M08-E01 — Independent security audit

Independent security audit: identity, permissions, tenant RLS, plugin trust, generated endpoints and uploads.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M08-E02 — Compatibility matrix

Compatibility matrix: CMS + Studio history and previous app/client/plugin versions.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M08-E03 — Performance

Performance: repeatable p50/p95/p99, startup, memory, migrations and job latency under disclosed workloads.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M08-E04 — DR drills

DR drills: database/object/queue backups, restore, migration recovery and measured RPO/RTO.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M08-E05 — Supply chain

Supply chain: SBOM, provenance/signatures, dependency and image scans, security advisory policy.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M08-E06 — Release docs

Release docs: compatibility matrix, support, semver, operator guide, developer tutorial.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M08-E07 — Go/no-go board

Go/no-go board: immutable SHA, tested artifacts, reproducible commands, independent approval.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- v1.0 release candidate and complete support/runbooks
- Independent threat/audit report and remediations
- Public benchmarks, recovery evidence and QA ledger

## Required acceptance gates

- [ ] No known unresolved Critical/High issue within audited scope before GA.
- [ ] Final immutable build passes Golden App, CMS and Studio compatibility matrix.
- [ ] Actual staging verifies RLS/roles, backup restoration, migrations, TLS and recovery.
- [ ] Release explicitly signed off; passing CI alone does not certify a production system.

## Known risks and non-goals

- Legacy report says CONDITIONAL LAUNCH; it is not GA evidence.
- Do not invent a 9.x quality score without an independent benchmark.

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
