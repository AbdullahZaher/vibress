# M12 — Marketplace, Ecosystem & Platform 2.0

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 5 · **Size:** XL (relative) · **Dependencies:** M05,M08; M11 for cloud flows · **State:** Proposed, not certified.

## Outcome

Scale extension development through governed marketplace, publisher trust, enterprise needs and transparent external benchmarks.

## Workstreams and Epics

### M12-E01 — Registry

Registry: immutable plugin/template versions, compatibility, dependencies and deprecation.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M12-E02 — Marketplace UX

Marketplace UX: discovery, release inspection, explicit operator admission and install approval.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M12-E03 — Publisher program

Publisher program: verified identity, release signatures, provenance and revocation.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M12-E04 — Supply-chain/security

Supply-chain/security: SBOM, scans, advisories, moderation, safe update/recovery.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M12-E05 — Enterprise adapters

Enterprise adapters: SSO, policy controls and dedicated tenant database as real demand dictates.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M12-E06 — Community

Community: public roadmap, contribution contract, support versions and governance.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M12-E07 — Comparative benchmarks

Comparative benchmarks: transparent tasks against Payload, WordPress, Wix, Ghost and low-code peers.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- Registry + publisher portal + admission/test policy
- External developer conformance and security review pipeline
- Public comparable benchmark harness and release governance

## Required acceptance gates

- [ ] External author builds, signs, submits and updates a module via documented SDK.
- [ ] Untrusted/unreviewed listing does not imply executable admission.
- [ ] Revocation prevents new admissions and defines existing fleet response.
- [ ] Marketing comparisons include exact task, hardware, source commits and limitations.

## Known risks and non-goals

- Untrusted JS marketplace not launched before credible isolation or strictly operator-reviewed trusted releases.
- Popularity metrics and template counts are not engineering quality evidence.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Marketplace trust and external safety barriers

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M12-E08 — Publisher and extension isolation admission

Separate discovery/listing/download from operator approval and runtime execution; implement signed identities, provenance, revocation, consent and negative SDK/upgrade tests.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M12-E09 — Truthful interoperability benchmarks

Use matched versioned CRM/editor/visual tasks, publish raw inputs, tested features and unsupported gaps; no claims of being 'better than Payload/Wix/WordPress/Ghost' without benchmark evidence.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] No marketplace listing or external agent may trigger arbitrary ESM execution in a privileged host process.
- [ ] Signed release and signer revocation are testable in install, upgrade, replacement and recovery scenarios.
- [ ] All public competitor comparisons include equivalent tasks, hardware/fixtures, versions and known limitations.

**Implementation constraint:** Untrusted Tier-2 marketplace packages must remain blocked until actual process/container isolation is independently validated.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### Additional blocking exit checks

- [ ] Module and publisher data-processing boundaries, documentation of stored end-user data and install/revocation permissions are reviewable before listing.

**Scope note:** Extension distribution must remain a separate security/trust transition from discovery or vendor marketing.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).


### Blocking exit checks

- [ ] Marketplace operator-approved Tier-1 package execution remains explicitly trusted privileged code, not advertised as in-process isolation; untrusted Tier-2 requires separate OS/runtime threat review.
- [ ] Module upgrade admission and effective installer/DB grants are checked before activation; no package metadata alone grants SQL or cross-install authority.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

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
