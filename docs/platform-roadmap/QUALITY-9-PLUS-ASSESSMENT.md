# Final Roadmap Design-Quality Assessment & 9+ Target — PR #151

> **Provisional editorial assessment of the written English roadmap, dated 2026-11-14; not an independent audit of code, runtime security or deployment.** Any number here is a reasoned reviewer judgment, not an empirical production rating. No plan can guarantee the absence of all unknown defects or vulnerabilities.

## Proposed updated roadmap-design score: 9.1 / 10 (conditional, self-assessed)

The earlier [8.0/10 assessment](SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) is retained **unchanged as a historical snapshot**. The new score reflects concrete repairs and a newly executable documentation test, not a claim that security code shipped. The separate *implementation/production readiness decision* remains **NOT VERIFIED / GA-NO-GO pending G0–G7 tests**.

### Consistent weighted criteria (same maxima as the historical rubric)

| Criterion | Max | Previous (historical) | New (plan only) | Re-evaluation rationale |
| --- | ---: | ---: | ---: | --- |
| Vision and positioning | 1.20 | 1.10 | **1.12** | Universal code-first app target and explicit limited v1 product class; real customer differentiation is still untested. |
| Architecture and extensibility | 1.60 | 1.20 | **1.46** | Installation/tenant/code trust and custom HTTP/frontend contracts, plus ADR sequencing and topology decisions defined. |
| Security and tenant isolation design | 1.60 | 1.30 | **1.47** | RLS GUC limitations, effective ACL/PUBLIC, SECURITY DEFINER, views, nested transactions, backups, isolation and negative matrices documented; none runtime-tested. |
| Scope, sequencing and feasibility | 1.50 | 1.25 | **1.39** | Mandatory CMS+CRM, bounded first vertical slice, P0 gates and explicit later Builder/Cloud/AI/Marketplace. |
| Backwards compatibility and migrations | 1.30 | 1.00 | **1.19** | Multi-publication CMS identity map, version-skew, app/worker/Studio fixtures and specific restore/forward-fix contracts. |
| Developer and application-building experience | 1.00 | 0.80 | **0.91** | Public SDK and independent CRM/custom action + UI acceptance; precise version/package release decision still pending. |
| Measurable verification and acceptance | 1.00 | 0.75 | **0.94** | Offline validator implemented and GitHub Actions workflow running; explicit release evidence/status ledger and negative acceptance. Actual product tests remain open. |
| Ownership, delivery governance and operations | 0.80 | 0.60 | **0.62** | Role responsibilities, GO/NO-GO, evidence policy clearer; actual named owners, capacity and SLO budgets are NOT assigned. |
| **TOTAL** | **10.00** | **8.00** | **9.10** | **Written plan structure/clarity only**; not runtime certification or independent peer review. |

**The score is intentionally conditional.** It should be downgraded if document CI fails on the final SHA, if release tags remain ambiguous when implementation begins, if incompatible requirements are found or if a reviewer disagrees with documented assumptions. It is a target-quality measure, not a representation that every plan defect has been discovered.

## Newly confirmed versioning defect — R40

**R40 — High planning/operational ambiguity:** the roadmap repeatedly used “Platform v1.0 GA” while existing root/DB/Plugin SDK package manifests already specify `1.2.0`; [ADR-013](../14-decisions/release-versioning-strategy.md) defines unified SemVer and production Compose contains a `VIBRESS_VERSION:1.0.0` fallback. Without resolving the version namespace, a new build could be mislabeled, wrong compatibility rules could be selected, or release history could be confused.

**Documentation remediation:** [release version and tested support matrix](RELEASE-VERSIONING-AND-SUPPORT-MATRIX.md) now treats “first code-first GA” as a **program name, not `v1.0.0` tag** until a signed decision. M00, M05, M07 and M08 require package/ABI/version compatibility checks. **The live release metadata or version defaults were not edited**; the underlying production mismatch is not claimed to have been repaired.

## What was materially improved rather than merely documented

1. Implemented [offline roadmap validator](../../scripts/verify-platform-roadmap.mjs) and [PR workflow](../../.github/workflows/platform-roadmap-docs.yml) for local Markdown links, heading fragments, milestone/Epic uniqueness, tracker Issue IDs and historical score arithmetic. Check a **successful run on the final PR SHA**; it does **not** exercise actual application code.
2. Identified specific code-backed version/runtime baselines: Node 24, pnpm 11.22.0, PostgreSQL 16, Redis 7, Host/Plugin SDK package 1.2.0, prod `VIBRESS_VERSION` fallback and unified ADR.
3. Added [testable release evidence and decision register](RELEASE-EVIDENCE-AND-DECISION-REGISTER.md) with evidence status vocabulary and gate-specific source/test/review requirements. This is a template; all runtime G0–G7 gates remain open.
4. Narrowed [first executable slice](EXECUTION-FIRST-SLICE.md) to legacy CMS compatibility + independent CRM + true security denial tests + first code-first GA. Preserves **140 existing Epics**; does not add speculative projects or delivery dates.
5. Explicitly excluded or gated uncertain capabilities (hostile untrusted server code, unsanctioned tenant SQL views, shared-process multi-app hosting, arbitrary DBs, full marketplace/cloud/visual builder) instead of claiming nonexistent support.

## Objective 9+ acceptance criteria for the next independent review

The **design** score of 9.1 is a **provisional self-assessment**. An independent reviewer should confirm all of the following before the project uses a public “9+ reviewed roadmap” label:

- [ ] **D1:** GitHub Actions doc validator passes on the exact final PR head and its outputs/coverage limits are recorded.
- [ ] **D2:** ADR-PLAT-001/002/003 decisions and ADR-013 version strategy are reviewed by accountable roles, including a chosen release naming scheme.
- [ ] **D3:** M00 owner/capacity assumptions, product first-adopter hypothesis and accepted/declined risk owners are recorded; no dates invented before capacity agreement.
- [ ] **D4:** Release evidence ledger's required/optional feature and source/fixture/test mapping has no inconsistent v1 claims, missing Epic IDs or false completed statuses.
- [ ] **D5:** CMS/Studio/Plugin SDK owners accept compatibility assumptions and the independent CRM mandatory v1 scope; otherwise document the proposed alternative.
- [ ] **D6:** Independent security/database reviewer agrees on explicit **testable** denial cases for tenant RLS, PUBLIC function grants, views, backup completeness, nested transactions, trusted code, integration boundaries and migrations.
- [ ] **D7:** Explicit reviewer sign-off and any exceptions are attached to GitHub; this self-score by itself is not independent approval.

**Additional mandatory *implementation* gates:** real code, database role/RLS integration, external clean consumer, schema upgrades, backup/restore, staging security tests and M08 GO/NO-GO. They are *not* satisfied by a 9.1 planning score.

## Final internationally benchmarked scope

The [Final Design Baseline Review](FINAL-DESIGN-BASELINE-APPROVAL.md) recommends **conditional acceptance of this roadmap for M00 execution planning**, subject to actual architecture/security/product owner sign-off A1–A8. [Standards alignment](INTERNATIONAL-STANDARDS-ALIGNMENT.md) maps selected versions of NIST SSDF, OWASP ASVS, ISO/IEC 27001/25010, SLSA and WCAG; **a crosswalk is not a certification audit**. The provisional self-assessed **9.1/10 score stays unchanged** and does not imply formal independent review or actual production readiness.

## Remaining limitations

- No signed ADRs, named owners, actual resource capacity, p95 operational SLO or production release manifest.
- Existing Plugin SDK package remains private in current code; general Framework runtime and tenant security controls are mostly proposals.
- Studio compatibility and historical security findings need current independently run tests.
- Not all external links, security threats or future product features can be statically proven from Markdown.
- An independent review may adjust the **subjective** score. Unresolved Critical/High runtime security findings block public GA regardless of this number.

**Current decision:** PR #151 stays **Draft** for human review. The roadmap can serve as an advanced engineering blueprint, but it does not make Vibress production-ready or vulnerability-free.
