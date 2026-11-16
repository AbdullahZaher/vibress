# Wave 1 Approval and Decision Register — M00–M02

> **Date: 2026-11-16 (Asia/Riyadh). Status: ALL RELEASE APPROVALS PENDING / NO-GO.** Audited PR #166 at `a96ea073767e303b02121d87558adbd12ce111f3` before governance edits. All named roles are *request targets*, not verified people. Zero signatures are inferred from a GitHub account, test result, PR author comment, or verbal appointment.

## Separation of duties and signature contract

Agent 01 coordinates evidence and maintains this register, **does not approve** sensitive changes, production operations, a release or a PR merge. Agents 02–05 must issue distinct formal verdicts; Agent 06 must independently review evidence *after* their reports and must not be the implementation author. The human Project Owner & Final Release Authority makes the final decision subject to these mandatory opinions.

A valid signature/approval must identify **named approver, verified authority, exact change scope, commit/build, evidence links, date/time, residual risk, conditions and expiry (if risk acceptance)**. Status stays PENDING/BLOCKED until the record exists. If an irreversible/privilege/security-sensitive action is proposed, require written risk assessment, relevant specialist + Agent 06 concurrence, verified backup and tested rollback, minimal time-limited scope and audit log.

## Approval ledger

| ID | Decision | Required role(s) | Named accountable owner | Status | Evidence/decision required | Request / source |
| --- | --- | --- | --- | --- | --- | --- |
| R26-A | DB privilege scope A | DB owner + AppSec security lead | UNASSIGNED | PENDING | Global future-function default privilege + 2 trigger PUBLIC EXECUTE revokes; inventory + caller analysis; signed risk, backup and tested rollback | R26-REVOCATION-APPROVAL-REQUEST.md |
| R26-B | Legacy api/worker role scope B | DB owner + AppSec lead | UNASSIGNED | PENDING | Written role grant policy, source change in provisionRuntimeRole, denies, migration/upgrade replay, rollback | R26-REVOCATION-APPROVAL-REQUEST.md |
| F-012 | CMS RLS option A/B disposition | Security review owner + DB owner | UNASSIGNED | PENDING | A or B decision with hosting limits, risk analysis, controls, review; cannot assume recommended B | F-012-CMS-RLS-DECISION.md |
| R35 | View/report surface policy | DB security lead + independent Agent 06 | UNASSIGNED | PENDING | Inventory of views/foreign tables and identities; measured RLS denial and independent approval | R35-VIEW-SURFACE-POLICY.md |
| R40 | Framework release/version identity | Release owner + architecture owner | UNASSIGNED | PENDING | Sign A/B/C choice, support/version policy, manifest digest migration plan; no GA tag | R40-VERSION-IDENTITY-DECISION.md |
| ADR-PLAT-001 | Dedicated installation topology | Architecture lead + infra security review | UNASSIGNED | PENDING | Signed tenancy topology tradeoffs, DB/Redis/storage/backup A/B proof | adr/ADR-PLAT-001-installation-topology.md |
| ADR-PLAT-002 | Identity vocabulary | Architecture lead + DB/security | UNASSIGNED | PENDING | Signed separate application/tenant/publication/principal contracts | adr/ADR-PLAT-002-identity-vocabulary.md |
| ADR-PLAT-003 | Scope/transaction/RLS contract | DB/security lead + architecture | UNASSIGNED | PENDING | Signed threat model, transaction isolation, R26/R35 disposition | adr/ADR-PLAT-003-tenant-transaction-rls.md |
| DEPLOY-OWNER | Non-superuser migration/deployment DB ownership | DB + infrastructure owners | UNASSIGNED | PENDING | Production-shaped deployment design, least-privilege role evidence and recovery drill | PLATFORM-BOOT-REGISTRY-RUNBOOK.md |
| DEPLOY-WORKER | Worker/provisioning identity separation | DB + architecture + IAM owner | UNASSIGNED | PENDING | Separate credentials and least-privilege deny-matrix under staged deployment | PLATFORM-BOOT-REGISTRY-RUNBOOK.md |
| W1-T06 | Redis, object storage, queues, secrets isolation | Infrastructure owner + Agent 04/05 | UNASSIGNED | PENDING | Scoped time-limited disposable credential use; A/B negative tests, cleanup evidence | W1-T06-RESOURCE-ISOLATION-REQUEST.md |
| W1-T07 | Production IdP and authentication integration | IdP administrator + security owner | UNASSIGNED | PENDING | Nonprod issuer/client, JWKS rotation, revoke and principals, live deny tests, no shared secrets in PR | W1-T07-IDENTITY-PROVIDER-REQUEST.md |
| SUPPLY-2026-01 | Fastify CVE-2026-120216 disposition | AppSec owner Agent 03 + Agent 06 | UNASSIGNED | OPEN FINDING | Lockfile 5.12.7; fixed 5.12.8; affected path and remedy/negative tests; signed disposition | WAVE-01-GATE-CLOSURE-MATRIX.md |
| GOV-THREADS | 20 outstanding review threads | PR engineering owner + independent reviewer | UNASSIGNED | PENDING | Address each thread with commit/test or signed justification; no silent resolution | https://github.com/AbdullahZaher/vibress/pull/166 |
| GOV-PROTECTION | Required branch rules and merge controls | GitHub repo administrator / release owner | UNASSIGNED | PENDING | Effective branch protection/rulesets configuration plus status check and reviewer requirements | https://github.com/AbdullahZaher/vibress/pull/166 |
| AGENT-02 | Formal Database Security verdict | Agent 02; appointing project owner | UNASSIGNED | BLOCKED | APPROVE/CONDITIONAL/REJECT/BLOCKED; exact SHA, R26/F012/R35/migrations, findings evidence | WAVE-01-RELEASE-DECISION-PACKET.md |
| AGENT-03 | Formal Application Security verdict | Agent 03; appointing project owner | UNASSIGNED | BLOCKED | Exact SHA, OWASP ASVS/auth/SCA, Fastify advisory, supplier proofs | WAVE-01-RELEASE-DECISION-PACKET.md |
| AGENT-04 | Formal Infrastructure/SRE verdict | Agent 04; appointing project owner | UNASSIGNED | BLOCKED | Isolation, CI/CD, owner topology, backups/recovery, observability and rollback | WAVE-01-RELEASE-DECISION-PACKET.md |
| AGENT-05 | Formal Identity/IAM verdict | Agent 05; appointing project owner | UNASSIGNED | BLOCKED | OIDC, sessions, roles, secrets, privilege proofs and tenant isolation | WAVE-01-RELEASE-DECISION-PACKET.md |
| AGENT-06 | Independent audit after other agents | Agent 06 independent; appointing project owner | UNASSIGNED | BLOCKED | Separate identity, artifact attribution, red-team and conflict reconciliation; required concurrence | WAVE-01-RELEASE-DECISION-PACKET.md |
| FINAL-RELEASE | GO/NO-GO, PR #166 merge | Project Owner & Final Release Authority | PROJECT OWNER ROLE ONLY — signature absent | PENDING | Signed exact-build decision with five verdicts, backups/restore, risks and monitoring; only then merge | WAVE-01-RELEASE-DECISION-PACKET.md |
| A1 | Architecture authority: ADR-PLAT-001/002; review ADR-003 transaction spike | Principal Architect + DB/Security (names unassigned) | UNASSIGNED | PENDING | Signed installation, identity and transaction scope / threat-model design decision | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| A2 | Version identity and disclosure support strategy | Release Manager + Security (names unassigned) | UNASSIGNED | PENDING | Reconcile ADR-013, packages, host tags and support/disclosure channels; signed R40 linkage | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| A3 | SSDF and OWASP ASVS security scope | AppSec + Engineering (names unassigned) | UNASSIGNED | PENDING | Select version-pinned ASVS requirements/tests and vulnerability response/disclosure owner | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| A4 | Supply-chain and operations provenance | CI/Release + Ops (names unassigned) | UNASSIGNED | PENDING | Choose SLSA source/build target, attest immutable artifacts, SBOM and restoration evidence | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| A5 | Product quality, accessibility and SLO/DR targets | Product + QA + UX (names unassigned) | UNASSIGNED | PENDING | Define ISO 25010 metrics, WCAG 2.2 AA scope and measured SLO/RPO/RTO targets | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| A6 | CMS/Studio/plugin migration and compatibility | CMS + Studio + Plugin owners (names unassigned) | UNASSIGNED | PENDING | Sign publication mapping, Yjs, SDK, clean CRM and regression acceptance boundaries | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| A7 | Resourced program, owners and risk acceptance | Repository maintainers + Program Sponsor (names unassigned) | UNASSIGNED | PENDING | Name accountable workstream owners, approve P0 slice and independent review plan | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| A8 | Final immutable evidence and CI review | Repository maintainer (names unassigned) | UNASSIGNED | PENDING | Signed exact final SHA checks for roadmap/project CI with approved exceptions | PR #151 FINAL-DESIGN-BASELINE-APPROVAL.md (draft) |
| G0 | Application/Publication installation topology | Architecture + DB/Security owner (names unassigned) | UNASSIGNED | PENDING | Signed ADR-PLAT-001/002, CMS mapping, principal trust graph and legacy compatibility; baseline entry | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |
| G1 | Scoped transaction, SQL privileges and tenant security (includes G1b app boundaries) | DB + Security + Infrastructure (names unassigned) | UNASSIGNED | PENDING | PG16 runtime nonowner, FORCE RLS, PUBLIC/function ACL, nested transaction negatives; G1b PG/Redis/storage/backup A/B deny tests | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |
| G2 | Schema/compiler and generated endpoint authorization | Architecture + AppSec + DB lead (names unassigned) | UNASSIGNED | PENDING | M03/M04 safe schema/DDL, migration review, generated/custom endpoint denials, negative policy tests | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |
| G3 | CMS legacy compatibility (includes G3b clean CRM) | CMS + Studio + Independent QA + Plugin owners (names unassigned) | UNASSIGNED | PENDING | Two-publication restore/roundtrip + G3b clean independent CRM/SDK/custom route/frontend proof | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |
| G4 | Module, event processing and upgrade compatibility | Plugin + Distributed Systems + Release owner (names unassigned) | UNASSIGNED | PENDING | Signed trusted plugin ABI, outbox/replay, upgrade/mixed-version and interrupted backfill tests | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |
| G5 | Full backup, tenant-safe export and recovery | DBA + Infrastructure/SRE (names unassigned) | UNASSIGNED | PENDING | Two-tenant checksums, media/queue restore, measured RPO/RTO and restoration drills | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |
| G6 | Release metadata, version and support | Release + Architecture + Security owner (names unassigned) | UNASSIGNED | PENDING | R40 version stream, tag/package/build digest equality, Node/PG/Redis/Studio compatibility | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |
| G7 | Independent GA GO/NO-GO decision | Independent Security Reviewer + Project Owner (names unassigned) | UNASSIGNED | PENDING | Independent evidence/signature on immutable build; explicit owner GO/NO-GO and support/SLO approval | PR #151 RELEASE-EVIDENCE-AND-DECISION-REGISTER.md (draft) |

## A1–A8 / G0–G7 interpretation

The **definitions** of A1–A8 have now been traced to the [pinned draft design-baseline review](https://github.com/AbdullahZaher/vibress/blob/c9997a9353a229a4287256f5ba3b94d718e3a5d9/docs/platform-roadmap/FINAL-DESIGN-BASELINE-APPROVAL.md) (2026-11-14). G0–G7 definitions and subsidiary **G1b** (physical app-installation boundaries) and **G3b** (clean external CRM) are traced to the [pinned draft release-evidence register](https://github.com/AbdullahZaher/vibress/blob/c9997a9353a229a4287256f5ba3b94d718e3a5d9/docs/platform-roadmap/RELEASE-EVIDENCE-AND-DECISION-REGISTER.md) (2026-11-14), cross-checked with [proposed security gates](https://github.com/AbdullahZaher/vibress/blob/c9997a9353a229a4287256f5ba3b94d718e3a5d9/docs/platform-roadmap/SECURITY-AND-RELEASE-GATES.md). These are **documented proposal definitions, not accepted organizational standards**: PR #151 remains Draft/unmerged, G0 unsigned, and no owner identity/actual signature is supplied. Wave 1 scope includes G0 and relevant G1/G1b evidence; later G2–G7 and G3b are tracked as future and cannot be marked passed by Wave 1 tests.

## Formal agent verdict requirements

| Agent | Current verdict | Required report before any GO |
| --- | --- | --- |
| 02 Database Security | **BLOCKED — no formal appointed reviewer report** | exact SHA/build/env; R26 A/B and F012; effective ACL/RLS/tenant denies; migrations; backups & restore; findings with severity/reproduction/fix; sources/dates; residuals |
| 03 Application Security | **BLOCKED — no formal appointed reviewer report** | SAST/SCA/OWASP, authenticated/unauth flows, supply chain and Fastify CVE disposition; exact SHA |
| 04 Infrastructure/SRE | **BLOCKED — no formal appointed reviewer report** | production-shaped isolation, logging/alert thresholds, recovery drill and rollback triggers; exact infrastructure digest |
| 05 Identity/IAM | **BLOCKED — no formal appointed reviewer report** | live IdP, token/MFA/rotation, least-privilege role assertions, operator credential handling |
| 06 Independent | **BLOCKED — no independent reviewer identity or signed verdict** | reproduce critical claims independently, review 02–05 findings, reconcile conflicts and sign exact release candidate |

GitHub PR #166 currently has **4 COMMENTED, 0 APPROVED reviews** by its author and **20 unresolved inline threads** (some marked outdated). These are advisory input, not independent sign-offs.

## Requests in dependency order

1. **Owner appointment:** Project Owner designates named human accountable owners (DB, AppSec, architecture, infrastructure/SRE, IAM/IdP, release, and truly independent reviewer), scopes authority and requests A1–A8/G0 meanings/signatures.
2. **Pre-authorization non-privileged analysis:** Agent 02 R26/R35/production ACL impact; Agent 03 F012 and Fastify; Agent 04 resource-isolation and tested recovery proposal; Agent 05 IdP acceptance criteria; no production credentials or grants changed.
3. **Sensitive decisions:** written R26 A/B, F012 A/B, non-superuser deployment authority and any provisioned test identity, with a tested rollback and Agent 06 concurrence where required.
4. **Execution after authorization:** staging-only changes, negative isolation, restore and CI tests with measured evidence; review conflicts; full retest on final candidate SHA.
5. **Final gate:** obtain 02–05 formal written verdicts, then 06 independent verdict; Project Owner final signed GO/NO-GO; PR merge is separate and never authorized by passing CI alone.

## Decision record template

```text
Decision ID:
Requested action / environment / affected installation:
Exact source SHA / image digest:
Proposed owner (name, role, authority evidence):
Risk assessment (likelihood, blast radius, CVSS if applicable):
Agent specialist verdict and link:
Agent 06 concurrence and link:
Backup ID and tested recovery / rollback proof:
Minimized scope + authorization start/end:
Decision (APPROVE / REJECT / DEFER):
Decision signer + timestamp:
Residual risk, mitigation and expiry:
Post-action test, monitoring and audit record:
```

## Live audit limits
No actual production environment, signed owner delegation, IdP configuration, Redis/S3 policies, retained backup evidence, rollback test or independent audit was accessible during this document-only coordination step. Do not replace missing evidence with conclusions based on passing CI.

Related: [gate matrix](WAVE-01-GATE-CLOSURE-MATRIX.md), [release decision packet](WAVE-01-RELEASE-DECISION-PACKET.md), [ownership request](OWNERSHIP-ASSIGNMENT-REQUEST.md).
