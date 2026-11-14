# M07 — Developer CLI, SDK & Application Templates

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 3 · **Size:** L (relative) · **Dependencies:** M03–M06 · **State:** Proposed, not certified.

## Outcome

Provide reproducible self-hostable creation, extension and upgrade of applications via a public SDK, CLI and templates.

## Workstreams and Epics

### M07-E01 — CLI

CLI: implement v1 supported `vibress create`, `add`, `doctor`, `upgrade --plan`; additional `generate`, `upgrade --apply` and `verify` commands are staged feature proposals requiring explicit versioned acceptance.

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

Golden apps: **v1 mandatory** CMS compatibility + independently installed CRM. Real Estate, Booking and Commerce are staged post-v1 reference tracks, or focused feature fixtures only if a feature is advertised for v1.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/cli, app-sdk and templates with docs
- Two mandatory v1 Golden Applications (existing CMS and clean external CRM); three progressive reference tracks after GA
- Versioned module and app upgrade conformance suite

## Required acceptance gates

- [ ] A CRM app is created and boots in a clean environment without kernel edits.
- [ ] Adding and upgrading an external module works through documented public APIs.
- [ ] All **v1 supported** templates run their auth/tenant/security tests as generated; post-v1 templates have separate preview/deprecation status.
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

## Minimum GA template and external consumer gate

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M07-E08 — Staged Golden App conformance

Make existing Vibress CMS + externally created CRM the two mandatory v1 Golden Apps. Keep Real Estate, Booking and Commerce as progressively expanded example tracks; test claimed subset features without requiring full production products.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M07-E09 — SDK packaging/version gate

Ensure the published SDK and module ABI match runtime, CLI commands operate on clean installation, no internal alias is needed and generated zones preserve user code.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] A new CRM is created with minimal/CRM template under a clean checkout and uses only public packages, not private monorepo aliases.
- [ ] CMS and CRM pass golden acceptance and migration; additional reference apps do not block GA unless their capability is advertised in scope.
- [ ] CLI upgrade --plan outputs a safe, reviewable migration/compatibility report; it never runs destructive DDL without approval.

**Implementation constraint:** Do not advertise an unimplemented CLI command or the current private plugin SDK as a released consumer API.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M07-E10 — End-user code-first web app and custom action acceptance

Deliver a clean external CRM with both generated resource CRUD/Admin **and** a developer-owned web route, typed client auth, custom HTTP endpoint/action, tenant-safe worker event and independently deployable source package.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] A clean external CRM implements custom deal approval and an end-user-facing route using the public SDK without raw SQL/Fastify or kernel edits.
- [ ] v1 required artifacts/templates are explicitly separated from future examples; no milestone is blocked solely by missing full Real Estate/Booking/Commerce apps.

**Scope note:** v1 exposes a bounded general **web application** substrate, not a promise to run arbitrary untrusted native code or any programming language.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M07-E11 — External developer adoption and matched product trial

Run clean external CRM development/onboarding and competitor-matched tasks with real developer participants, record unsupported workflows, manual edits, time to custom action/web view and broken SDK/upgrade compatibility.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] At least one real externally packaged v1 CRM app proves end-user UI/custom business action and a tenant-safe worker without private imports or kernel changes.
- [ ] Product claims are limited to features actually benchmarked; M00 first-adopter feedback and recorded blockers are reviewed before declaring v1 ready.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

## Fourth-pass acceptance: executable scope, not a growing checklist

The [first executable slice](../EXECUTION-FIRST-SLICE.md) prioritizes **existing M07-E09/E10/E11**. Only CMS and independent CRM are mandatory full v1 Golden Applications.

- [ ] A clean independently packaged CRM demonstrates frontend, typed custom endpoint/action, multi-tenant checks and no kernel edits; old CMS fixture retains all publication-scoped identity and media behaviors.
- [ ] External CLI/SDK documentation explicitly excludes unsupported materialized tenant reporting and any feature requiring unreviewed privileged SQL views.
- [ ] First-adopter tasks and an actual owner/capacity decision determine v1 claim scope; no additional full reference application is made a GA blocker by this review.

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
