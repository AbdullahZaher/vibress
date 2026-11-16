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
| A1 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A1 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| A2 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A2 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| A3 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A3 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| A4 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A4 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| A5 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A5 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| A6 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A6 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| A7 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A7 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| A8 | Organizational accountability approval (precise criterion awaiting source-level mapping) | Project Owner to designate authorized role | UNASSIGNED | PENDING | Identify exact A8 definition, accepted decision authority, signature, date, source link; no assumed approval | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G0 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G0 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G1 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G1 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G2 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G2 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G3 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G3 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G4 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G4 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G5 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G5 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G6 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G6 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |
| G7 | Program certification gate (exact definition/phase must be verified) | Project Owner + gate-specific signatories | UNASSIGNED | PENDING | Identify G7 requirement and entry/exit evidence; written gate verdict, reference and timestamp | OWNERSHIP-ASSIGNMENT-REQUEST.md |

## A1–A8 / G0–G7 interpretation

The source ownership inventory states A1–A8 are organizational sign-offs and G0–G7 are program gates, with **G0 unsigned**. It does **not** supply an accepted person-by-person mapping for each identifier in the reviewed execution docs. Accordingly this register allocates no specific individual to those identifiers, and does not imply all G1–G7 are due for Wave 1; applicability must be established from the normative roadmap with approval by the Project Owner. Later-wave gates cannot be silently marked passed.

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
