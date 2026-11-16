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

## Mandatory decision and evidence gates introduced by PR review

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M00-E07 — Deployment/identity security architecture spike

Approve ADR-PLAT-001 and 002 and independently review the ADR-PLAT-003 PostgreSQL transaction/security prototype before implementing M01 runtime extraction. ADR-PLAT-003 must be fully accepted and operationally verified before any external tenant-owned data access. Compare one-app-per-installation (recommended) with shared multi-app runtime; record database/Redis/storage/secrets topology, runtime principal boundaries and rejected alternatives.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M00-E08 — Public SDK and migration inventory

Record existing @vibress/plugin-sdk private package, ABI vs package semver, existing runtime DDL grants, publication-dependent Content Modeler and Drizzle transaction entry points.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M00-E09 — Documentation and milestone validation

Add a docs CI checker for Markdown links/headings, missing Mxx-Eyy work IDs, duplicate IDs, stale tracker links and translation authority. The checker is future runtime/tooling work, not accomplished by this doc.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] ADR-PLAT-001 and 002 are accepted; the ADR-PLAT-003 security transaction prototype is independently reviewed before M01 runtime changes. Its full implementation and verification block external tenant access, not isolated M01 prototyping.
- [ ] Source inventory explicitly records getDb()/runInTransaction() behavior, the plugin SDK private flag, runtime CREATE/EXECUTE grants and legacy publication fallbacks.
- [ ] Risk register R01–R16 is triaged with named owners, actual PR/CI evidence and a documentation-check task.

**Implementation constraint:** Do not treat proof-of-concept code in an isolated dev environment as authorization to host external apps or tenants.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M00-E10 — v1 product compatibility and architectural proof plan

Document concrete classes supported by v1 code-first web runtime, including custom typed HTTP actions and end-user web routes; reject claiming native mobile or arbitrary compute. Establish initial app packaging, dependency and benchmark fixtures.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.

### M00-E11 — Operational and privacy ownership baseline

Choose SLI/SLO metrics, security/data owners, scoped tenant lifecycle, planned recovery RPO/RTO measurement and qualitative team/capacity assumptions. Record ADR-PLAT-009/010 as proposed and assign their later stage-specific sign-off.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] M00 records ADR-PLAT-001/002 accepted and ADR-PLAT-003 security transaction prototype reviewed before M01; later ADR-PLAT-004..010 have owners and future approval gates rather than an unconditional G0 block.
- [ ] A v1 capability matrix states support for developer-owned custom API/actions/end-user web UI and explicit limitations for unsupported runtimes.
- [ ] Named operational and data-lifecycle owners, evidence format and SLI/SLO baseline measurement plan are recorded without invented numeric service promises.

**Scope note:** All ADRs must be owned at M00, but do not require speculative decisions 004–010 to be finally accepted before M01. This is an architectural/design phase, not an all-product sign-off.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M00-E12 — PostgreSQL effective grant and RLS policy inventory

Record actual function EXECUTE grants from PUBLIC/roles/default privilege owners, SECURITY DEFINER functions, writable search_path, existing RLS policies/role inheritance and deployment topology. Reconcile findings R26–R29 before choosing app hosting contracts.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### M00-E13 — First-adopter and documentation quality spike

Choose an evidence-based external developer use case, comparator-matched CRM task, actual owner/capacity assumptions, and a testable docs checker plan (relative links, headings, IDs, ADR and GA scope).

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] An accepted R26–R29 threat model lists function effective ACLs, policy OR/AND, non-RLS privileges and trusted app code boundaries.
- [ ] First-adopter/user research hypothesis, named architecture/security/product owners and resource assumption are documented with explicit stop/pivot tests.
- [ ] Roadmap-specific CI checker task is defined; any current manual link check is explicitly labeled manual, not a passing dedicated CI job.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

## Fourth-pass acceptance: baseline, CMS migration and first slice

These tests refine **existing M00-E04, E07, E12 and E13**; they do not create new Epics. See [fourth review](../FOURTH-PASS-REVIEW-2026-11-14.md), [legacy migration mapping](../LEGACY-CMS-IDENTITY-AND-MIGRATION.md) and [P0/P1 first slice](../EXECUTION-FIRST-SLICE.md).

- [ ] Pin and preserve a seeded **two-publication CMS + pub_default** fixture with member/role, Studio saved documents, assets, subscription and delayed-job references.
- [ ] Baseline inventory includes views/materialized reports, their PostgreSQL owners/security_invoker settings and backup role/restore semantics.
- [ ] Product, architecture, DB/security, Studio and release roles accept the first P0 vertical-slice order or record a decision with risks; no invented staffing or date.
- [ ] Baseline tests and results refer to immutable source/fixture SHAs; no claim of completed documentation CI validator without an actual CI job.

## Release identity and automated documentation gate (existing M00-E02/E09)

- [ ] **Reconcile ADR-013 Unified SemVer with current 1.2.0 package manifests and the Compose `VIBRESS_VERSION:1.0.0` fallback**; decide whether "Framework first code-first GA" belongs to existing version stream or uses separately approved, noncolliding tags/package names.
- [ ] **Pin support candidates:** Node 24, pnpm 11.22.0, PostgreSQL 16, Redis 7 from actual current source; record exact tested Studio/Host/plugin ABI versions, environments and upgrade matrices. Do not imply wider support without tests.
- [ ] The [automated documentation validator](../../../scripts/verify-platform-roadmap.mjs) passes against the **current** PR SHA and reports milestone, issue map, relative-link/heading and score arithmetic checks. It does not satisfy actual RLS or release security.
- [ ] Every open security/Migration/Studio gate has an explicitly named future owner role and a [release evidence ledger entry](../RELEASE-EVIDENCE-AND-DECISION-REGISTER.md). Human assignment, deployment tests and audit evidence remain open.

[Release support matrix](../RELEASE-VERSIONING-AND-SUPPORT-MATRIX.md) · [Release ledger](../RELEASE-EVIDENCE-AND-DECISION-REGISTER.md)


## International standards design sign-off (existing M00 epics; no new IDs)

- [ ] Review the [final design baseline recommendation and open A1–A8 conditions](../FINAL-DESIGN-BASELINE-APPROVAL.md); record genuine human architecture/security/product owner approval before claiming formal organizational sign-off.
- [ ] Approve a standards-control register mapping [NIST SSDF v1.1, ASVS v5.0.0, ISO/IEC 27001/25010, SLSA v1.2 and WCAG 2.2](../INTERNATIONAL-STANDARDS-ALIGNMENT.md) to existing M00–M08 Epics, real owners, selected control versions and test artifacts.
- [ ] Resolve legacy [architecture overview](../../01-architecture/overview.md) single-deployment/multiple-runtime-application wording versus new per-installation topology, without rewriting existing CMS runtime claims.
- [ ] Reconcile [historical SECURITY.md version support](../../../SECURITY.md) with current Host/SDK 1.2.0 and proposed Framework GA version strategy without fabricating product support dates.
- [ ] Define SSDF vulnerability intake/triage, selected ASVS verification depth, SLSA target track/level, ISO 25010 product measures and WCAG 2.2 AA testing scope; record decision owners and real resources.

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
