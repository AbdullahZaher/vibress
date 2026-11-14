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
