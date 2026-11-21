# Cross-Wave Governance, A1–A8, G0–G7 and Release Decision Checklist

**Status:** all universal-framework GA release gates remain OPEN unless verified with *full scoped immutable evidence*. This document is the executable gate overlay to the normative [Release Evidence & Decision Register](https://github.com/AbdullahZaher/vibress/blob/main/docs/platform-roadmap/RELEASE-EVIDENCE-AND-DECISION-REGISTER.md), [A1–A8 Standards Sign-off](https://github.com/AbdullahZaher/vibress/blob/main/docs/platform-roadmap/FINAL-DESIGN-BASELINE-APPROVAL.md) and [Milestone Tracker #165](https://github.com/AbdullahZaher/vibress/issues/165). Documentation-only CI is not platform certification.

## Architecture and program approvals A1–A8

- [ ] **A1 — Architecture:** real named architecture/DB/security owners accept ADR-PLAT-001/002 and transaction ADR-003, including old CMS/installation boundary. (A01/A02/A05)
- [ ] **A2 — Product/version strategy:** reconcile ADR-013 Host 1.2.0 with Framework GA naming, package namespace, historical tags and disclosure policy. (A01/A10)
- [ ] **A3 — Security standards:** selected OWASP ASVS 5.0.0 web/API controls, NIST SSDF handling and actual AppSec owner; not marketing certification. (A03/A05)
- [ ] **A4 — Supply chain / provenance:** SLSA source/build target, SBOM, reproducible digest, vulnerabilities, release incident ownership. (A03/A04)
- [ ] **A5 — Reliability/accessibility:** named ISO 25010 metrics, WCAG 2.2 AA *target*, manual tests, SLI/SLO and measured RPO/RTO. (A04/A08/A11)
- [ ] **A6 — CMS/Studio/Plugin:** frozen compatibility IDs, Yjs/doc version, media/member/delayed job, SDK/ABI and real independent CRM. (A07/A08/A09)
- [ ] **A7 — Resourcing/governance:** real accountable Project Owner, specialist delegates, independent reviewer, capacity and risk exception process. (A01)
- [ ] **A8 — Final evidence:** SHA-pinned candidate/CI and responsible repo maintainer sign-off. (A01/A11/A06)

## Release gates G0–G7 (including G1b/G3b)

- [ ] **G0 — Application/Publication identity topology:** accepted deployment/identity ADR, Application vs Publication and pub_default, verified migration/CRM separation. (M00/M01)
- [ ] **G1 — Scoped transaction/SQL grants/RLS:** actual runtime nonowner, FORCED tenant RLS, PUBLIC/default/inherited EXECUTE, nested rollback-only, view owner/non-row privileges and real SQL denial. (M02)
- [ ] **G1b — Installation boundaries:** actual application A/B PG, Redis/BullMQ, S3/object IAM, secrets, backup and revocation isolation; fixture-only tests inadequate. (M01/M02/M11)
- [ ] **G2 — Schema and generated endpoints:** signed additive plans, real roles, tenant-safe migration/backfill and generated REST/Admin/custom action field/row/count/export/SSR negative tests. (M03/M04)
- [ ] **G3 — Legacy CMS/Studio:** two-publication CMS+pub_default data, Yjs/docs, locales, media, paid membership, delayed jobs, upgrade/restore with stable mapping and rows. (M00/M01/M03/M08)
- [ ] **G3b — Clean CRM:** public packed/published SDK, external install, user-facing route, custom approval action and tenant-safe Worker, no kernel edits/private imports. (M04/M07)
- [ ] **G4 — Modules/events/upgrades:** trusted signed module, version skew, transactional outbox/inbox, retry/DLQ, revocation and interrupted backfill/forward-fix. (M05/M06/M08)
- [ ] **G5 — Full installation recovery:** DBA/ops-authorized backup scope, PG physical WAL/PITR+media+queues+two-tenant reconciliation, observed RPO/RTO, no blanket zero loss claim. (M08)
- [ ] **G6 — Artifact release metadata:** Host/Framework/SDK/Plugin/Studio/Node/PG/Redis compatible version matrices, matched tags, digests, SBOM and runtime image. (M00/M07/M08)
- [ ] **G7 — Independent GA:** formal Agent06 and independent security findings closed, actual release board/owner explicit `GA-GO` or `GA-NO-GO` against immutable candidate; `NO-GO` until all gates. (M08)

## Sensitive owner decisions (no implicit approval)

- [ ] R26 A/B and legacy F-012: legitimate human DBA/AppSec and owner decisions, actual privilege tests. Staging/runtime controls, not discussion-only ADR.
- [ ] R35 security_invoker/foreign materialized view exclusions, nonowner deployment and R40 release identity.
- [ ] M03 D-01 future READY V2 principal/tenant fence: A05 owner + A06 concurrence. No general runtime GO.
- [ ] M03 D-02: A02/A04 real Backfill retained/rewound PITR and executable recoverable operator path; owner+Agent06 acceptance against E06/E09.
- [ ] M03 D-03: named *human* DBA/IAM policy approval for 0061 owner UPDATE/TRUNCATE, immutable mapping, audited metadata correction; new additive SQL only if duly authorized.
- [ ] Destructive CONTRACT, any privileged SQL grants, production role/IdP change, GA deploy or human risk acceptance require separate time-limited explicit authority, backup/rollback proof and audit log.
- [ ] Preserve production `NO-GO`, M04 Batch03 `NOT AUTHORIZED`, DELTA-08 and P07-RC-C disabled, Policy A/P05-R1/P06-E2-A, D1=2517ms in restricted original scope and M=NOT DETERMINABLE.

## Reviewer independence and controlled merging

**Responsibility chain:** Implementers A02–05/A07–12 → QA A11 → integrator A01 → frozen exact SHA/tree → independent A06 review → real owner/authorized maintainer decision → approved merge → postmerge source/CI audit.

- [ ] Agent06 checks actual code, binary/DB test logs and final checklist against original requirements, not a copied agent assertion.
- [ ] An A06 `ACCEPT` does not imply actual human policy or production permission; `CONDITIONAL` cannot be silently interpreted as `GO`.
- [ ] Failing required tests, open High/P0, stale SHA, no approval, missing independent reviewer → no canonical merge.
- [ ] A06 cannot approve its own commits, impersonate any human signatory or quietly rewrite original test gates.
- [ ] After a successful independent decision and actual owner merge authorization, merge only the reviewed branches in planned dependency order; rerun impacted verification if merge conflicts change code.
- [ ] Record GitHub PR, commit/merge SHA, tree, CI, reviewer signoff, human approvals, risk/expiry, rollback/forward-fix and issue updates.
- [ ] At **the end of each Milestone** run the full suite once on the frozen candidate; at **the end of each Wave**, perform one integrated cross-milestone check and independent GO decision; **at the end of Wave5**, run full cross-wave program certification.
- [ ] No repeated full CI per small task/Epic and no artificial green skip; security preflights still mandatory before dangerous changes.

## Handoff report schema

```text
program, wave, milestone, issue
original_epics_and_acceptance_scope
implementation_sha, git_tree_sha, base_sha, merge_sha
PR URLs; test source + test names; exact CI run/job URLs
environment (PG, Node, Redis, S3, OIDC), fixture/backup hashes
negative isolation/authorization cases, expected refusal SQLSTATE
migrations, historic compatibility, data recovery and rollback
unit/integration/e2e/security results; skips and why
A02/A03/A04/A05 specialist reports and date
Agent06 independent review URL, findings and verdict
named human DBA/IAM approvals (if required), owner decision URL
risk acceptance and expiry, deployment restrictions, monitoring
Epic checkboxes with evidence URLs and formal milestone GO/NO-GO
Wave GO/NO-GO; Program/GA GO/NO-GO (only if authorized)
```

**Do not fabricate a signature, reported test, execution time, compliance certification, percentage or authoritative date.** Keep unproven work unchecked.
