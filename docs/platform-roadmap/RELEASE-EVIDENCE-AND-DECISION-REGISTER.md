# Release Evidence, Risk Disposition & GO/NO-GO Decision Register

> **Status: OPEN — proposed framework code-first GA.** This is the authoritative evidence index template, **not a certification**. Never check a gate from plan prose alone. The PR-specific completed documentation validation is recorded separately from unimplemented platform security requirements.

## Evidence-grade status vocabulary

| Status | Meaning |
| --- | --- |
| **DESIGN-PROPOSED** | Requirement and test plan documented, no signed ADR or working code. |
| **DECISION-APPROVED** | Human owner accepts ADR/scope, but **does not** imply code or tests exist. |
| **IMPLEMENTED-UNVERIFIED** | PR/commit exists, required negative/integration tests or independent review incomplete. |
| **EVIDENCE-VERIFIED** | Pinned code artifact and running tests prove the specified test matrix on declared environment. |
| **GA-GO / GA-NO-GO** | Explicit release owner decision *after* security/compatibility/restore approval; only M08 can record it. |
| **NOT-APPLICABLE** | Owner approved exclusion and tests confirm no unsupported feature is reachable (e.g. tenant SQL views excluded). |

No status may be inferred from a Markdown checkbox, a green unrelated CI workflow, the editorial roadmap score or prior Studio certification prose.

## Canonical first-release evidence ledger

| Gate | Source work / acceptance | Current status | Evidence required to advance |
| --- | --- | --- | --- |
| **G0 — Application/Publication topology** | M00-E02/E04/E07, M01-E05; ADR-PLAT-001/002 | DESIGN-PROPOSED | Approved identity graph, old CMS → app mapping, decision owner, fixtures |
| **G1 — Scoped transaction, SQL privileges and tenant security** | M02-E08/E09/E12/E13; ADR-PLAT-003 | DESIGN-PROPOSED | PG16 real nonowner tests, PUBLIC function ACL, SECDEF, nested error, two policies, views or verified exclusion |
| **G1b — App-installation boundaries** | M01-E10, M02-E14 | DESIGN-PROPOSED | App A/B dedicated DB credentials, Redis ACL/queues, object IAM and backup negative tests |
| **G2 — Schema and generated endpoint authorization** | M03-E08/E09, M04-E08/E10; ADR-PLAT-004/005/009 | DESIGN-PROPOSED | Verified migration and backfill, REST/Admin/export and custom route denial; unsafe view feature blocked |
| **G3 — CMS legacy compatibility** | M00-E04, M01-E05, M08-E02 | DESIGN-PROPOSED | Two-publication `pub_default` dataset, Studio Yjs/doc version roundtrip, media/payment/outbox and rollback |
| **G3b — Clean external CRM** | M01-E06/E09, M04-E10, M07-E10 | DESIGN-PROPOSED | Published/packed SDK, independent app build with customer/deals, frontend/custom action, no kernel imports |
| **G4 — Module/events/upgrades** | M05-E08/E09, M06-E08/E09, M08-E12; ADR-PLAT-006/008 | DESIGN-PROPOSED | Trusted plugin ABI/version acceptance, outbox/replay, mixed worker/API/DB versions, interrupted backfill |
| **G5 — Full data recovery** | M08-E04/E11, M11-E10; ADR-PLAT-010 | DESIGN-PROPOSED | Audited full backup vs tenant export, two-tenant row checksums and media/queue restore, observed RPO/RTO |
| **G6 — Release metadata and support** | M00-E02, M07-E09, M08-E06 | DESIGN-PROPOSED | Approved [release version strategy](RELEASE-VERSIONING-AND-SUPPORT-MATRIX.md), package/tag health metadata equality, actual Node/PG/Redis/Studio compatibility |
| **G7 — Independent GA decision** | M08-E08/E12 | DESIGN-PROPOSED | Independent security scope/finding closure, support/SLO, immutable build, named GO/NO-GO sign-off |
| **Docs CI — Markdown structure only** | [Offline validator](../../scripts/verify-platform-roadmap.mjs), [workflow](../../.github/workflows/platform-roadmap-docs.yml) | IMPLEMENTED; CI EVIDENCE REQUIRED | Attach successful GitHub Actions run for **final PR commit**. Does not change G0–G7. |

**Cross-workflow prerequisites:** G0 precedes new external app runtime; G1/G1b precede public multi-tenant/app hosting; G2/G3/G3b/G4 and G5 are mandatory before G7. Absence of a supported view/report feature must be an explicitly verified denial, not “passed by ignoring it.”

## Required proof record for each gate

Use the following fields in its GitHub issue or linked document; **do not insert fabricated reviewers, URLs, SHAs, timestamps, performance budgets or test numbers**:

```json
{
  "gateId": "G1",
  "status": "DESIGN-PROPOSED",
  "requirementIds": ["R01", "R26", "R27", "R35", "R37"],
  "epicIds": ["M02-E08", "M02-E09", "M02-E12", "M02-E13"],
  "ownerRole": "Database + Security",
  "ownerName": null,
  "decisionId": "ADR-PLAT-003",
  "decisionUrl": null,
  "codeCommitSha": null,
  "artifactDigest": null,
  "testRunUrl": null,
  "environment": null,
  "fixtureSha": null,
  "negativeCaseResults": [],
  "migrationAndRestoreEvidence": null,
  "reviewedBy": null,
  "reviewedAt": null,
  "exceptionExpiry": null,
  "goNoGo": null
}
```

A release reviewer must compare the **same immutable commit SHA** across source, tests, container digest, API/worker/module/Studio fixtures, documentation and release manifest. Automated tests and source-only advisory reports have different evidence classes.

## Blocking defect and exception rules

- Missing test evidence for a scoped P0/High security finding → **NO-GO**. No blanket executive waiver of proven cross-tenant access, an unresolved critical vulnerability or incomplete data restore.
- A well-scoped **unsupported feature** may be excluded from v1 only if API/CLI/UI rejects it and negative tests demonstrate it is unreachable; record future milestone and owner.
- Approved risks must identify threat/affected consumers, exact mitigation, owner, expiry and validation. An exception expires or an upgrade reopens it.
- A CI-success label for documentation does not assert anything about database RLS, plugin isolation or production vulnerabilities.

## International standards evidence mapping (all runtime evidence remains open)

Use the [International Standards Alignment Matrix](INTERNATIONAL-STANDARDS-ALIGNMENT.md) to attach chosen control IDs, version, scope, test proof, acceptance owner and exception status for: NIST SSDF v1.1, OWASP ASVS v5.0.0, ISO/IEC 27001:2022, ISO/IEC 25010:2023, SLSA v1.2 and WCAG 2.2 AA target. **Do not claim any SLSA level, ISO certificate, ASVS verified scope or WCAG AA conformance** until genuine independent evidence is recorded.

The [Design Baseline Review](FINAL-DESIGN-BASELINE-APPROVAL.md) distinguishes **conditional M00 planning acceptance** from the **new Framework GA production NO-GO** pending G0–G7. The initial documentary CI success is not a database/Studio security test.

## Roadmap scoring vs product release evidence

[Roadmap quality scoring](SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) and any aspirational 9+ threshold evaluate clarity/completeness of the **plan only**. Production certification is determined solely by the above executable evidence and release decision. No plan can guarantee that unknown bugs or vulnerabilities do not exist.
