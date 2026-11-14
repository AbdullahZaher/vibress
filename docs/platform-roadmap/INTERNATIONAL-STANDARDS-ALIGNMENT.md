# International Standards Alignment Matrix — Vibress Framework Roadmap

> **Document type:** engineering standards crosswalk, not a certificate. **Date:** 2026-11-14. **Candidate design baseline:** PR [#151](https://github.com/AbdullahZaher/vibress/pull/151). This analysis maps selected, publicly documented internationally recognized frameworks to Vibress's proposed architecture and acceptance tests. **It does not establish ISO certification, OWASP ASVS verification, SLSA level attainment, accessibility conformance or NIST endorsement.**

## Control standards, declared versions and applicability

| Framework / primary reference | Scope and why relevant | Proposed Vibress mapping (requirements and evidence) | Current evidence status |
| --- | --- | --- | --- |
| [NIST SP 800-218 SSDF v1.1](https://csrc.nist.gov/pubs/sp/800/218/final) | Secure software development lifecycle: **PO, PS, PW, RV** | [Delivery governance](DELIVERY-GOVERNANCE.md), [security/release gates](SECURITY-AND-RELEASE-GATES.md), M00/M02/M08; enumerate **security requirements, threat models, code provenance, vulnerability response** and incident learning with named owners | **Planned / not verified**; existing CI is necessary but not full SSDF practice evidence |
| [OWASP ASVS v5.0.0](https://asvs.owasp.org/) | Web/API technical security verification | M02/M04/M08, authn/authz, tenant segregation, secure sessions, validation, injection, file/media handling, CSRF, SSRF, webhook and server-side policies; version-pin any individual ASVS IDs as `v5.0.0-<id>` **only after exact CSV requirements are selected** | **No completed requirement-by-requirement ASVS control matrix**; must choose risk-driven assurance depth and independently test |
| [ISO/IEC 27001:2022 + Amd 1:2024](https://www.iso.org/standard/27001) | Organizational **information security management system** and continuous risk management | [Data lifecycle](DATA-LIFECYCLE-AND-OPERATIONS.md), [risk register](RISKS-AND-DEPENDENCIES.md), ownership, incident response, suppliers, business continuity and documented risk treatment; M00/M08/M11 | **Organization-wide ISMS audit not performed**; a software roadmap alone cannot confer ISO/IEC 27001 conformity or accreditation |
| [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) | Product quality model with **nine characteristics** across the software lifecycle | M00 define measurable quality requirements; M04/M07 test correctness, developer usability, accessibility, maintainability, compatibility; M08 performance, reliability, security and support evidence, measured SLO and restoration | **Quality objectives specified, metrics/baselines mostly unmeasured**; plan score is not an ISO/IEC 25010 product assessment |
| [SLSA v1.2](https://slsa.dev/spec/v1.2/) | Software supply-chain Source/Build tracks and artifact provenance | M00 protected PR/source provenance; M05/M07 verified SDK artifacts; M08 immutable build digest, SBOM, signed attestations, dependencies, lockfiles, least-privilege CI permissions and dependency pinning | **No SLSA track/level claimed** until an assessed builder, retained verifiable provenance and downstream validation prove its requirements |
| [W3C WCAG 2.2](https://www.w3.org/TR/wcag/) | Accessible end-user and admin web interfaces | M04/M07/M09: **AA is the proposed design target** for supported UI flows, with automated axe-style checks plus keyboard, focus, screen-reader and RTL/manual scenarios; define documented exclusions and accessibility regression fixtures | **No WCAG 2.2 AA conformance claim** until representative end-to-end flows and manual evaluation are evidenced |

Official standards may change. This matrix pins the cited version, requires a controlled revision before adopting a new major version, and distinguishes **applicable controls** from **assessed conformity**. ISO full texts may be copyrighted/paid; this mapping uses publicly described scope and does **not** reproduce proprietary clauses.

## Standard-to-milestone acceptance gates

| Control gate | Milestone / actual implementation proof | Disposition to approve plan |
| --- | --- | --- |
| **STD-01: SSDF secure SDLC** | M00 owner/reviewer decision and threat model; M08 source/test evidence, secure vulnerability intake and triage route in [existing SECURITY.md](../../SECURITY.md) | **Covered as design.** Reconcile vulnerability response/version support with new Framework packages before claiming implemented |
| **STD-02: ASVS verification** | M02 and M04: code-versioned ASVS checklist, real PostgreSQL RLS/Views/ACL plus API, session and negative authorization, admin/media/webhook tests; M08 independent review | **Not yet proven**. A large list of roadmap security risks is not an ASVS audit |
| **STD-03: ISO 27001 ISMS** | Named owner, asset/data classification, access policy, risk acceptance record, incident playbook, vendor and disaster recovery oversight | **Crosswalk only**; ISO certification requires separate organizational audit |
| **STD-04: ISO 25010 product quality** | CMS regression and independent CRM Golden App, accessibility, install success, upgrade recovery, performance/SLI, support and developer trial evidence | **Criteria defined**, measurements pending |
| **STD-05: SLSA supply chain** | Immutable release digests, SBOM inventory, trusted source history/review controls, artifact provenance and signed/vetted supply chain; assess against a named SLSA 1.2 track/level | **Level not assigned**; don't equate green GitHub Actions with SLSA achievement |
| **STD-06: WCAG 2.2 AA** | M04/M07 admin and external CRM user flows, M09 visual builder when shipped; automated + manual keyboard/RTL/assistive-tech validation | **AA target only**, certification/conformance not tested |

The evidence record for each STD-xx must include **an owner, standard version and exact selected control IDs where applicable, bounded scope, code SHA, test and environment, reviewer, status, exceptions/expiry and remedial issue**. Store in [Release Evidence Register](RELEASE-EVIDENCE-AND-DECISION-REGISTER.md).

## Final review discrepancy controls

### F-01 — Existing deployment topology versus new framework v1

The current [architecture overview](../01-architecture/overview.md) says a single deployment may host multiple runtime applications; the new [ADR-PLAT-001](ARCHITECTURE-DECISION-GATES.md) **proposes** one independently isolated Application per Installation for the first external code-first framework. These are **different scopes**, not evidence that the current system already enforces the new model. The existing CMS multi-domain runtime is not automatically a hosted tenant-app sandbox. ADR-PLAT-001 approval must specify migration, non-breaking CMS compatibility and what "runtime application" means in each document. No broad new app hosting before physical isolation tests.

### F-02 — Historical security support policy versus Framework release lineage

[SECURITY.md](../../SECURITY.md) describes historical supported Host `v1.1.x` / `v1.0.x`; root/SDK package manifests use `1.2.0`, ADR-013 specifies unified SemVer, and the new Platform GA artifact version is **TBD**. This is a support-policy and version-collision review item, **not evidence that old versions are unsupported**. Require Release/Security owners to publish an accurate, version-specific support/disclosure policy and compatible release manifest before GA. Do not change historical live support entries without authorized product/security review.

### F-03 — Standards claims, source provenance and developer accessibility

The plan historically included SBOM, a11y and security reviews but lacked a **versioned standard-by-standard controls/evidence matrix**. This document adds traceability; the remaining work is implementing a reviewer-approved ASVS control set, SSDF vulnerability response, explicit source/build provenance expectations, product quality budgets and a WCAG 2.2 AA evaluation plan. **No unsupported SLSA, ISO, ASVS or WCAG certification claim is permitted.**

## Verification and review decision

- ✅ [Documentation validator](../../scripts/verify-platform-roadmap.mjs) and [roadmap workflow](../../.github/workflows/platform-roadmap-docs.yml) exist; their success must be checked on the **final head SHA**.
- ✅ [Current PR CI](https://github.com/AbdullahZaher/vibress/pull/151/checks) may show green build, tests, image scan and E2E on its tested SHA. It is **not** a substitute for future general-framework PostgreSQL, multi-app, new CRM or control-standard evidence.
- ☐ **Owner sign-off pending:** ADR-PLAT-001/002/003, ADR-013 package/version and security support, SSDF/ASVS scope, SLSA build target, quality/SLO and accessibility acceptance, unassigned team capacity.
- ☐ **Product GA remains blocked** by [G0–G7](RELEASE-EVIDENCE-AND-DECISION-REGISTER.md), independent security and actual recovery tests.

**Disposition:** Recommended **CONDITIONAL APPROVAL OF THE ROADMAP AS AN IMPLEMENTATION PLANNING BASELINE**, subject to named architecture/security/product owners reviewing the above F-01–F-03. **NOT** an approval to deploy, an international standards certificate or a claim of vulnerability absence.
