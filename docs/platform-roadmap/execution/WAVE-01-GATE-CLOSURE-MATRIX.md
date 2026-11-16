# Wave 1 Gate Closure Matrix — M00–M02

> **Governance snapshot: 2026-11-16 (Asia/Riyadh). Decision: NO-GO.** This is a coordination artifact, **not a release certification, signature, or fresh test execution**. PR #166 audited at `a96ea073767e303b02121d87558adbd12ce111f3`; base `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`. Most local test totals are historical reports dated 2026-11-15. CI run [43755004357](https://github.com/AbdullahZaher/vibress/actions/runs/43755004357) is independently read from GitHub for audited HEAD; check run names: build, e2e, container-scan (all success). Last application/source change `f0d8aaedb90c4debca5cf792480e297ca12e1832`; commits `a9d99a41`, `0d308dfa`, `a96ea073` change docs. All new governance commits require their **own** check attribution before final release consideration.

## Interpretation
- **VERIFIED CI** means a named GitHub run at a named SHA; **IMPLEMENTED TESTED** means source+historical test evidence, *not independent certification*.
- **PARTIAL/GUARDED** do not satisfy final gate. **BLOCKED** means evidence or human authorization is missing; no silence-based acceptance.
- Roles named here are functional reviewers/request targets. **No human identity or actual signature is assigned** where UNASSIGNED appears. Agent coordination is not authority delegation.
- No other milestone or Wave 2–5 is certified by this table.

## Acceptance matrix

| ID | Wave | Criterion | State | Evidence | Evidence producer / authorized owner | Blocker or approval gap | Required exit evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M00-01 | M00 | Pin repository/base/roadmap & immutable source history | VERIFIED | BASELINE-AND-OWNERSHIP-M00.md; PR #166 commit history | Agent 01 / architecture lead UNASSIGNED | None for record; owner acceptance open | Independent owner confirms pinned inputs and accepts baseline |
| M00-02 | M00 | Supported Node/pnpm + workspace inventory | RECORDED | package.json Node >=24 <25, pnpm 11.22.0; M00 baseline | Agent 03 | CI pass; independent validation pending | Repeat exact-version build under supported engine |
| M00-03 | M00 | CI validation, test split, clean tree, docs links | VERIFIED CI | GitHub run 43755004357, head a96ea073; build job steps | Agent 03 / Agent 04 | Do not transfer run result to other SHA | All required checks verified again on final candidate SHA |
| M00-04 | M00 | Branch rules / mandatory review enforcement | BLOCKED | main protected:false; rulesets [] from accessible API; detailed protection endpoint 403 | Repository administrator UNASSIGNED / Agent 01 | Required merge controls not demonstrably enforced | Admin supplies effective ruleset/protection export and enforces or documents controlled merge authorization |
| M00-05 | M00 | Historical CI/test result attribution | VERIFIED HISTORICAL | Run 43750359129 -> a9d99a41; 43752560245 -> 0d308dfa; 43755004357 -> a96ea073 | Agent 01 | Older results do not re-attest new evidence | CI run head_sha and step results linked per changed head |
| M00-06 | M00 | Ownership map, named accountable owners, G0 | BLOCKED | OWNERSHIP-ASSIGNMENT-REQUEST.md; no signatures | Project Owner / release coordinator | All A1-A8 and G0-G7 lack accepted named owners | Written acceptance with name, scope, date and link |
| M00-07 | M00 | ADR-PLAT-001/002/003 design acceptance | PROPOSED | adr/ADR-PLAT-001..003 | Architecture lead + Agent 02/03; humans UNASSIGNED | No formal accepted ADR | Signed decisions and updated ADR status with evidence |
| M00-08 | M00 | Dependency and threat-model advisory review | OPEN FINDING | pnpm-lock fastify@5.12.7; GHSA-3qgw-9275-xf8w published 2026-11-02 | Agent 03 | Medium CVSS 5.9; handlerTimeout/streaming reachability unknown | Upgrade to fixed version >=5.12.8 and retest or independently verify unreachable configuration |
| M01-01 | M01 | Branded application/tenant/principal identity, reject pub_default | IMPLEMENTED TESTED | packages/platform-kernel/src/identity.ts; platform tests 214/214 historically | Agent 03 / architecture lead | Independent reviewer missing | Source-bound tests verified on final SHA; ADR-PLAT-002 accepted |
| M01-02 | M01 | Public kernel contracts, policy and route executor | IMPLEMENTED TESTED | packages/platform-kernel; packages/tenancy; boundary tests | Agent 03 | Trust boundary for arbitrary app code must remain explicit | Review trust model and pass contract/boundary tests |
| M01-03 | M01 | Canonical manifest and persisted registry drift refusal | IMPLEMENTED TESTED | packages/platform-kernel/src/manifest.ts; platform-application-registry.ts | Agent 03 / Agent 02 | Manifest digest is metadata, not artifact provenance | Verify CAS/denial tests and separate build provenance |
| M01-04 | M01 | Installation create/update mandatory CAS with audit | IMPLEMENTED TESTED | registration.ts; migration 0058; reference-app integration 86/86 historical | Agent 02 | Production authorization/process not proven | Independent data-integrity review; staging audit integrity proof |
| M01-05 | M01 | Atomic manifest + installation provisioning | IMPLEMENTED TESTED | registration.ts; rollback/audit-failure/concurrency test claims in reports | Agent 02 / Agent 03 | Production deployment owner not approved | Staged rehearsal with controlled non-superuser owner |
| M01-06 | M01 | Separate operator provisioning executable from server | IMPLEMENTED TESTED | scripts/provision-platform-reference.ts; start/main; child-process deny tests | Agent 03 / Agent 05 | Secret distribution and job identity unresolved | Review operator secret lifecycle and real deployment startup |
| M01-07 | M01 | Runtime, membership reader, deployment verifier split | PARTIAL | tests/integration/platform-production-topology.test.ts 8/8 historically | Agent 02 + Agent 05 | Registry-provisioning and worker identities unsplit | End-to-end least privilege in production-shaped topology for every identity |
| M01-08 | M01 | Pinned read-only app/environment/installation verification | IMPLEMENTED TESTED | platform-deployment-verification.ts; reference-app tests | Agent 03 + Agent 05 | Artifact digest operator supplied; binary provenance unproven | Signed/attested binary/image digest bound to running deployment |
| M01-09 | M01 | Reference CRM boot and HTTP/PG Playwright | IMPLEMENTED TESTED | tests/e2e-platform/reference-app.spec.ts; 8/8 historical | Agent 03 + Agent 04 | Broader CMS/staging E2E absent | Repeat staging tests on release candidate |
| M01-10 | M01 | Framework release/version identity R40 | BLOCKED | R40-VERSION-IDENTITY-DECISION.md | Release owner UNASSIGNED | Options A/B/C unsigned; no GA tag approved | Written choice + version/manifest migration plan |
| M02-01 | M02 | Server verified scope / default deny membership | IMPLEMENTED TESTED | packages/tenancy/src/scope.ts, policy.ts; 214 platform tests historical | Agent 03 + Agent 05 | Live IdP not wired | Negative auth and tenant scope tests on staging credentials |
| M02-02 | M02 | Transaction-bound Unit of Work, rollback-only, async escape | IMPLEMENTED TESTED | unit-of-work.ts; PostgreSQL deny fixtures | Agent 02 + Agent 03 | Trusted SQL is not a malicious-code sandbox | Independent transaction contamination and failure-path tests |
| M02-03 | M02 | RLS ENABLE+FORCE, non-owner tenant matrices | IMPLEMENTED TESTED | 0054 platform RLS; platform-tenant-isolation, 24/24 historically | Agent 02 | Production role/owner topology lacks proof | Negative cross-tenant tests with deployed non-superuser owner |
| M02-04 | M02 | Two-database installation boundary | PARTIAL | platform-installation-isolation.test.ts 8/8 historical | Agent 02 + Agent 04 | Disposable PG fixture only; non-DB resources unproven | Production-shaped installation A/B credential denials |
| M02-05 | M02 | Versioned runtime privilege allowlist, effective ACLs | IMPLEMENTED TESTED | platform-runtime-privilege-contract.ts; signature-exact tests | Agent 02 + Agent 05 | Independent DB review/signature missing | Reproduce no unexpected PUBLIC/inherited/column/function privileges |
| M02-06 | M02 | R26 PUBLIC EXECUTE and legacy role scope B | BLOCKED | R26-REVOCATION-APPROVAL-REQUEST.md; proposal 0055 unapplied; 4/4 disposable tests | DB owner + AppSec owner UNASSIGNED; Agents 02/03/06 | Scope A impacts global defaults; scope B legacy grants; no approvals | Signed A/B decision, backup and rollback rehearsal, authorized application and fresh deny tests |
| M02-07 | M02 | F-012 legacy CMS RLS disposition | BLOCKED | F-012-CMS-RLS-DECISION.md; option B proposed only | DB owner + Security review owner UNASSIGNED | CMS tables no RLS; option A/B unsigned | Written signed choice, scope and compensating controls with verification |
| M02-08 | M02 | R35 secure view/report policy | GUARDED REVIEW OPEN | R35-VIEW-SURFACE-POLICY.md; 3/3 tests historical | Agent 02 + Agent 06; human security owner UNASSIGNED | Owner-path views, foreign tables, non-runtime profiles not universally guarded | Independent review + inventory of each reporting/view surface |
| M02-09 | M02 | Topology/onboarding fail-closed gate | IMPLEMENTED TESTED | platform-deployment-topology.test.ts 8/8 historical | Agent 03 + Agent 04 | Does not constitute F-012 sign-off | Staging negative configuration tests + approved topology |
| M02-10 | M02 | Redis isolation / queue separation / storage IAM / secrets | BLOCKED | W1-T06-RESOURCE-ISOLATION-REQUEST.md | Agent 04 + Agent 05; infra owner UNASSIGNED | No authorized live deny-matrix or policies | Disposable A/B cross-installation deny proofs and signed scope |
| M02-11 | M02 | OIDC verifier / production authentication wiring | BLOCKED | oidc-principal-verifier.ts; 21/21 offline tests historical; W1-T07 request | Agent 05 + Agent 03; IdP admin UNASSIGNED | No live IdP, key rotation, revocation or auth integration | Approved non-prod IdP and live adversarial tests |
| M02-12 | M02 | Non-superuser deployment owner and role separation | BLOCKED | Dev/Compose database owner superuser; test-only proof | Agent 02 + Agent 04; DB owner UNASSIGNED | Actual topology unverified | Controlled non-superuser deployment + effective-ACL/owner tests |
| M02-13 | M02 | CMS/Studio backward-compatibility and regression | PARTIAL | 6 files / 82 tests historical; fixture pack and HTTP/PG tests | Agent 03 + Agent 06 | Staging CMS E2E/upgrade acceptance missing | Full backward compatibility staging suite and independent pass |
| M02-14 | M02 | Backup, PITR/restore, migration replay, rollback | BLOCKED | Runbook exists; no scoped live restore/recovery rehearsal evidence | Agent 02 + Agent 04 | RPO/RTO, backup integrity and rollback unverified | Signed evidence of backup, timed restore, migration and application rollback |
| M02-15 | M02 | Observability, security alerts, postrelease thresholds | BLOCKED | No evidence attached to PR of live alerting or smoke/rollback criteria | Agent 04 | Detection and automatic rollback triggers undefined | Monitoring dashboards, thresholds, alerts, rollback decision table verified |
| M02-16 | M02 | Independent five-agent formal verdicts | BLOCKED | 4 PR reviews COMMENTED by PR author, 0 APPROVED; 20 open review threads | Agents 02–06, Agent 06 independent | No authorized signed verdict with evidence on final SHA | Signed standard-format 02–05 verdicts and 06 independent concurrence; threads triaged |
| M02-17 | M02 | Release gate, PR merge, Wave 2 authority | BLOCKED | PR #166 OPEN, NO-GO; owner sign-offs missing | Project Owner & Final Release Authority | No GO, merge authority or Wave 2 start | Final owner-signed decision and non-bypassable merge controls |

## Normative draft G0–G7 mapping (not approved)

The gate meanings have been traced to the pinned, still-unmerged PR #151 [release evidence ledger](https://github.com/AbdullahZaher/vibress/blob/c9997a9353a229a4287256f5ba3b94d718e3a5d9/docs/platform-roadmap/RELEASE-EVIDENCE-AND-DECISION-REGISTER.md). **G0 is unsigned**, and no future gate is marked accepted. See the [approval register](WAVE-01-APPROVAL-REGISTER.md) for A1–A8 and accountable role requests.

| Gate | Proposed scope in pinned roadmap | Wave 1 relevance |
| --- | --- | --- |
| G0 | Application/Publication topology; ADR-PLAT-001/002, CMS mapping | **BLOCKED**: signed design baseline missing |
| G1 | Scoped transaction, effective SQL ACL/RLS, tenant security | **PARTIAL**: runtime tests exist, R26/F-012/production proofs missing |
| G1b | Distinct installation DB, Redis, object IAM and backups | **BLOCKED**: non-DB negative tests missing |
| G2 | Safe schema compiler and generated API authorization | Future M03/M04, not passed |
| G3 | CMS/Studio legacy compatibility | **PARTIAL**: local fixture pass; staging acceptance missing |
| G3b | Clean external CRM SDK, UI and custom action | Future clean external consumer validation, not passed |
| G4 | Module ABI, event reliability and upgrade compatibility | Future Wave, not passed |
| G5 | Full restore, RLS-safe backups, measured RPO/RTO | **BLOCKED** for any deploy; full program gate later |
| G6 | Release metadata/version and support compatibility | R40 currently **BLOCKED**; full gate later |
| G7 | Independent GA owner GO/NO-GO | Future M08, not Wave 1 GO; **NO-GO** remains |

**Source limitation:** this is a mapping from proposed roadmap definitions, not proof of their formal organizational adoption. Design A1–A8 are defined in [pinned PR #151 design baseline](https://github.com/AbdullahZaher/vibress/blob/c9997a9353a229a4287256f5ba3b94d718e3a5d9/docs/platform-roadmap/FINAL-DESIGN-BASELINE-APPROVAL.md). Human names/signatures remain UNASSIGNED.

## Decision dependencies and parallel work

1. **Parallel, non-privileged:** Agent 02 audits R26 Scope A/B and R35 view/foreign table inventory; Agent 03 assesses Fastify CVE-2026-120216 and F-012 controls, reviews application trust; Agent 04 prepares resource-isolation harness and recovery/alert criteria without deploying; Agent 05 defines IdP tests and effective-role ACL matrix; Agent 01 gathers accountable owner acceptances, exact CI/threads and version decision.
2. **Authorization prerequisite:** assign DB/security/release/IdP/infrastructure/architecture owners; approve scope for R26, F-012, W1-T06/W1-T07 and non-superuser topology; document backups and tested rollback before sensitive execution. Do not deploy tests with credentials while blocked.
3. **Serial after approvals:** implement approved changes → repeat tests on exact source SHA → independent Agent 06 review after Agents 02–05 → owner decision. Any change invalidates older evidence for affected scope.
4. **Merge gate:** 20 GitHub inline review threads are unresolved (some outdated); each needs specific fix evidence or reasoned disposition. No automatic resolution just because a thread is outdated.

## Findings register
- **R26-P0 (release blocking):** effective public/legacy function EXECUTE remains open. Dev inventory 33 functions, 33 PUBLIC executable, 0 security-definer; proposal 0055 disposable test 4/4; production deployment unapproved.
- **F-012 (release blocking):** legacy CMS without RLS; fail-closed topology prevents unsupported onboarding but does not accept proposed disposition.
- **R35 (review blocking):** runtime view guard measured for security_invoker and rejection of materialized views; reports, owner code, foreign tables and downstream principals require explicit decision.
- **DEPLOY/INFRA/IDP (release blocking):** non-superuser deployed owner, worker identity, Redis/S3/queue/secrets deny tests, IdP integration, restore and monitoring evidence missing.
- **SUPPLY-2026-01 (new, Medium, CVSS 5.9):** lockfile resolves fastify **5.12.7**, within advisory affected range `>=5.8.0 <5.12.8` for [CVE-2026-120216 / GHSA-3qgw-9275-xf8w](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w), published **2026-11-02**. Trigger needs nonzero `handlerTimeout` and streaming route: configuration reachability not yet established. AppSec shall inspect both API and reference runtime, upgrade to `>=5.12.8` with lockfile and regression tests or independently prove exposure is impossible. [OSV](https://osv.dev/vulnerability/CVE-2026-120216), modified 2026-11-09. Do **not** infer from passing dependency audit that this Medium advisory was assessed/closed.
- **GOV-20 (review blocking):** 20/20 review threads unresolved; four COMMENTED reviews from repository author, no actual independent APPROVE review observed in the connector result.
- **GOV-BRANCH (review blocking):** branch query says `main protected:false`, rulesets list empty; detailed protection endpoint 403. Administrator must verify effective controls; never equate `mergeable:true` with authorization.

## Research register (retrieved 2026-11-16)
- [PostgreSQL 16 ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/16/sql-alterdefaultprivileges.html) — verifies global vs schema-scoped default privilege semantics.
- [PostgreSQL privilege defaults](https://www.postgresql.org/docs/current/ddl-priv.html) — EXECUTE to PUBLIC for new functions.
- [OWASP ASVS 5.0.0](https://asvs.owasp.org/) (published 2025-05-30) — independent authentication/access-control verification baseline.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — reviews, checks and merge restrictions.
- [NIST SP 800-53 Rev.5](https://doi.org/10.6028/NIST.SP.800-53r5) — CM-3 and CP-4 change/recovery evidence.
- [Fastify vendor advisory 2026-11-02](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w) and [OSV entry, modified 2026-11-09](https://osv.dev/vulnerability/CVE-2026-120216). No claim that NVD or CISA KEV status was exhaustively established.

## Audit rules
No fabricated signatures, no acceptance of Critical/High findings, no production changes, no R26 proposal application, no schema drop, no tag, no merge and no Wave 2 start. A substantive fix requires source-SHA bound proof, follow-up reviews and fresh owner decision.

See [approval register](WAVE-01-APPROVAL-REGISTER.md) and [decision packet](WAVE-01-RELEASE-DECISION-PACKET.md).


## Six-agent integration addendum — 2026-11-16 (technical evidence, NO-GO)

A separate integration candidate was assembled on branch integration/wave1-agents-01-06-20261116 from #166 HEAD 3c55c5b0a1bcbd9093ade62c5b6f738acbe42021. Exact specialist sources: #171 9ee1d2b3, #172 d149804e, #173 e97ff02d and #174 bf1a63ce. The combined code/evidence path through 108ae9497974217948fd1a273044198553b33243 adds AG06-05 transactional role provisioning and fault tests, R35 foreign-table denial, offline membership-enriched OIDC (not production-wired), disposable Redis/S3 harness, and a reference CRM Playwright CI job. This document update is a further SHA change and requires final-head CI.

No R26 proposal was applied; F-012 remains undecided; actual BullMQ worker, production IdP and patched production PostgreSQL are unverified; image provenance and restoration remain open. The last independent Agent 06 review predates integration; 22 #166 threads and all required human signatures remain outstanding. Github main was reported unprotected by branch API; administrator policy change is not authorized by this addendum. Preserve the recorded 8.3/10 until independent reassessment. No merge, Wave 2, release or risk exception is authorized.

Full decision-ready evidence, role matrix and mandatory remaining gates: WAVE-01-SIX-AGENT-INTEGRATION-2026-11-16.md.

---

## Agent 01 — 2026-11-16 integrated candidate governance update

**Decision remains NO-GO.** Integration PR [#176](https://github.com/AbdullahZaher/vibress/pull/176) is Draft, unmerged. The pre-governance-doc candidate `63c47b3adda183d816727edc7b590979b2a8c2da` includes pinned specialist source from PRs #171–#174, atomic role provisioning fixes, and new required reference-app E2E CI. **Integration CI [43870098128](https://github.com/AbdullahZaher/vibress/actions/runs/43870098128) was IN PROGRESS**, with its build job unfinished, at last direct inspection. Its workflow and build job head_sha matched `63c47b3a`; the actual checkout commit has not been independently confirmed from logs. The resource-isolation check on this SHA completed successfully; this is **not full CI PASS**. These governance edits create a new HEAD and require fresh checks.

**Reverified reviews:** #166 has **5 COMMENTED, 0 APPROVED, 22 unresolved review threads**. #171–#174 and #176 have zero submitted approvals. #175 returned 404 as a PR; no evidence of a valid PR #175. `main` and Wave 1 source branch report `protected:false`, rulesets `[]`; `main/protection` is 403 and the integration branch protection lookup is connector-restricted. Administrator verification is mandatory.

**Specialist state:** Agent 02 BLOCKED (R26 A/B, non-superuser role/restore, patched PG16.16); Agent 03 BLOCKED (F-012, cross-publication paths, conditional Fastify advisory); Agent 04 BLOCKED (synthetic Redis/S3 38-case proof, no real BullMQ or DR); Agent 05 BLOCKED (offline OIDC adapter only, no live IdP); Agent 06 BLOCKED (prior review predates integrated SHA). No signed human review or risk acceptance exists.

**Individually testable Agent 06 issues created:** [AG06-01 #177](https://github.com/AbdullahZaher/vibress/issues/177), [02 #178](https://github.com/AbdullahZaher/vibress/issues/178), [03 #179](https://github.com/AbdullahZaher/vibress/issues/179), [04 #180](https://github.com/AbdullahZaher/vibress/issues/180), [05 #181](https://github.com/AbdullahZaher/vibress/issues/181), [06 #182](https://github.com/AbdullahZaher/vibress/issues/182), [07 #183](https://github.com/AbdullahZaher/vibress/issues/183), [08 #184](https://github.com/AbdullahZaher/vibress/issues/184), [09 #185](https://github.com/AbdullahZaher/vibress/issues/185), [11 #186](https://github.com/AbdullahZaher/vibress/issues/186). All remain open pending exact integrated remediation, tests and independent disposition.

**Wave 1 exit mapping:** G0 signed architecture, G1 scoped PG16.16/RLS/ACL and G1b installation isolation are applicable; R26/F-012/R35, non-superuser roles, IdP and actual recovery are blocking for the proposed production-shaped scope. G2/G3b/G4 and full GA G5/G6/G7 are later roadmap gates and not claimed as Wave 1 exits; minimum tested recovery and R40/version identity remain necessary for any deploy. A1–A8 applicability requires named authority; no future milestone is falsely marked passed.

**Additional deliverables:** [integrated PR/commit evidence](WAVE-01-INTEGRATED-PR-COMMIT-EVIDENCE-REGISTER.md), [branch protection recommendation](WAVE-01-BRANCH-PROTECTION-RECOMMENDATION.md), and [owner action checklist](WAVE-01-OWNER-FINAL-ACTION-CHECKLIST.md). The previously recorded **8.3/10 remains unchanged (Δ 0.0)**. No security/DB/branch settings were modified; no merge, production operation, release GO, risk acceptance or Wave 2 authorization was issued.


### Agent 01 integration execution addendum — PR #189 (2026-11-16)

**NO-GO / NOT APPROVED.** Dedicated branch `integration/wave1-final-remediation-20261116` was created from PR #176 HEAD `3df799b365f8933d8cea234c403beb189a139335`. Imported Agent 02 PR #187 `dfcedbf1d`, Agent 04 PR #174 `e5a43dc1`, scoped Agent 03 PR #188 `ae7b6eb4`, and Agent 05 PR #173 identity evidence `99549c68`. The OIDC adapter reconciles server-side membership permissions with required `jti` validation and negative tests. See [six-agent integration record](WAVE-01-SIX-AGENT-INTEGRATION-2026-11-16.md) and [Draft PR #189](https://github.com/AbdullahZaher/vibress/pull/189).

CI #43896862303 was triggered on initial integration commit `491fe26b03c670b5c635e7be477d2ea862614e8a`; its result is **not certified for this subsequent documentation HEAD**. Node 24 immutable image, Fastify patched lockfile, artifact provenance, R26 A/B, F-012 A/B, IdP/staging authorization, full restore, branch protection and human/Agent 06 reviews remain BLOCKED. Quality baseline **8.3/10**, no risk acceptance, no GO/merge/Wave 2.
