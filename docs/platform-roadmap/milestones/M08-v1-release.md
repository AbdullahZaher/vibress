# M08 — v1 Production Readiness & GA Decision

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

## Corrected terminology: Production Readiness / GO-NO-GO, not an automatic certificate

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M08-E08 — Explicit independent audit and release authorization

Record independent reviewer scope, unfixed finding policy, runtime security matrix, exact artifact digest, CMS+CRM fixtures, actual staged migration/restore and named GO/NO-GO decision.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M08-E09 — Published support and release scope

Publish proven platform capabilities and exclusions (GraphQL, untrusted plugins, full Wix builder, AI, Cloud, other database engines), measured RPO/RTO and compatibility windows.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] Release owner records an explicit GO or NO-GO after independent security, data restore, tenant isolation and external clean install evidence.
- [ ] Mandatory v1 CMS+CRM applications pass; Real Estate/Booking/Commerce remain progressive tracks unless specific functionality was committed.
- [ ] There is no blanket assertion of lossless schema rollback, universal vulnerability absence, full accessibility certification or zero regression risk.

**Implementation constraint:** Rename public deliverable description from 'certified' to 'release-readiness reviewed'. An M08 issue closed without independent evidence is NOT production approval.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M08-E10 — General-app proof, privacy and operational service budget

Require external CRM custom endpoint/action/end-user UI, verified tenant export/deletion procedure, backup and queue retention runbooks, independently reviewed support matrix, and baselined SLI/SLO/error budget and RPO/RTO evidence.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] The GA evidence includes both generated Admin CRUD and a trusted external CRM custom endpoint/action and user-facing web route.
- [ ] Tenant data export/retention/offboarding, service SLI/SLO budgets, support/responsibility boundary and observed RPO/RTO are accepted by assigned owners.
- [ ] A formal GO/NO-GO identifies unsupported application types, untrusted plugins, database providers, visual/AI/cloud product lines and any legal-compliance limits.

**Scope note:** Rating a *written plan* 8.0/10 is not a certification of platform code; the release gate cannot be passed based on score or docs-only CI.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M08-E11 — Effective privilege and infrastructure isolation release proof

Independent reviewer checks PUBLIC/default function grants, SECURITY DEFINER, policy composition, TRUNCATE/REFERENCES, SQL owner roles and two-installation PostgreSQL/Redis/object-store credentials.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### M08-E12 — Version-skew and operator recovery release gate

Exercise rolling old/new API+worker+web+database+module+event combinations; require measurable support/runbook, on-call ownership, product/operations budgets and a GO/NO-GO record.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] Independent security review includes actual function PUBLIC/default grants, multiple RLS policies, non-row SQL privileges and cross-installation DB/Redis/S3 negative tests.
- [ ] Supported mixed-version API/worker/schema/event/SDK combinations, backfill interruption and rollback/forward-fix are verified in staging with immutable evidence.
- [ ] Product owner records real first-adopter feedback, staff/capacity and operational budgets before a public 'better than competitors' or universal app support claim.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

## Fourth-pass release gates: views, backups, legacy identity and rollback

Existing **M08-E02/E04/E11/E12** own these requirements. See [fourth review](../FOURTH-PASS-REVIEW-2026-11-14.md), [RLS-aware backup contract](../RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md) and [legacy CMS migration](../LEGACY-CMS-IDENTITY-AND-MIGRATION.md).

- [ ] Actual supported PostgreSQL versions deny tenant data leakage via ordinary owner-context views, invoker views and materialized reports **or** their generation is explicitly unsupported/blocked in v1.
- [ ] Complete-installation backup is distinguishable from scoped tenant export, using an audited backup identity; two tenant row-count/checksum and media/queue restoration checks pass with measured RPO/RTO.
- [ ] Legacy two-publication CMS content, members/plans, locales, published URLs, Studio documents and delayed jobs migrate/operate compatibly with new Application identity; independent CRM keeps its separate installation boundary.
- [ ] Tested nested transaction error/rollback-only and outbox state matches v1 business action semantics.
- [ ] Release owner makes a documented GO/NO-GO decision with actual CI and independent security evidence; checklist completion alone is not certification.

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
