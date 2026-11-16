# Wave 1 — Six-Agent Integration and Conditional Release Evidence (2026-11-16)

Status: TECHNICAL NO-GO. This record is an engineering evidence package, not a human approval, risk acceptance, independent security signature, or authorization to merge PR #166 or begin Wave 2.

## A. Immutable intake baseline and candidate

- Repository: AbdullahZaher/vibress; Wave 1 PR #166; base main 5183f34f0c404de9c02ba8c79cc54b42bc6975e6; intake source 3c55c5b0a1bcbd9093ade62c5b6f738acbe42021.
- Specialist source heads: #171 Agent 03 9ee1d2b3639aa717c4a09689dfb916b5970b04c6 (6 files); #172 Agent 02 d149804e19b2a8cfbe7c3eee849e5651bb12ce41 (5 files); #173 Agent 05 e97ff02deb8e8c733df9e4d3cbc110b368c6fd1c (6 files); #174 Agent 04 bf1a63ce43d8e812f08fd9364eda2b2afc1d9169 (6 files).
- Source PR bases: #171/#172 1deefe0a33b109d16bba7f4c2f65320a4d13c3b9; #173 965824e5c1cf7ff77be2535a6eba4a03517cb957; #174 3c55c5b0a1bcbd9093ade62c5b6f738acbe42021. Since these bases, #166 changed only three governance documents for #171/#172, and two for #173, none overlapping imported paths.
- Work assembled, without merging draft PRs, on integration/wave1-agents-01-06-20261116. Intake integration commits: a0d3177f (#171), e739d8df (#172), 48b60154 (#173), 17dfa343 (#174). All 23 source file blobs were imported at their pinned specialist heads.
- AG06-05 remediation 4373f074041176b527dcca35290290f9d8bf6d49; PostgreSQL regression suite 4a6c7a2085e7e15dd4a9e7290791a40a8ffd7d67; additive CI reference E2E 2ec1054daf0ba4fa2066f915b0aa9ac6ea2640fc; E2E harness and PG16 patch guard 108ae9497974217948fd1a273044198553b33243. This is the source candidate prior to this evidence-document update; the final document commit has a different SHA and requires a new exact-head CI run.
- Previously observed exact-head GitHub run 43862790731: #166 build, e2e and container-scan SUCCESS at 3c55c5b0. #174 run 43864193113: disposable resource isolation SUCCESS at bf1a63ce. Neither certifies combined source. Integration push CI run 43869334905 was IN PROGRESS when first inspected at source 2ec1054d, and becomes historical when source advances.
- PR #166 remains open, not merged. Specialist PRs #171–#174 are draft. At intake, #166 had 22 unresolved review threads, five COMMENTED reviews and zero APPROVED reviews. Branch API reported main protected=false, repository rulesets=[]; administrative protection detail GET returned 403. These are repository observations, not security-policy authorization.
- Runtime constraints from package.json: Node >=24 <25; pnpm 11.22.0 (>=11.17); PostgreSQL 16 fixture. The PostgreSQL project released fixed 16.16 on 2026-11-12; actual production patch level is unknown. CI reference E2E now fails if its PostgreSQL 16 fixture is below 16.16.
- Runner limitations: GitHub source and Actions API are accessible; this executor has no repository checkout, compatible Node 24/pnpm 11 workspace, running PostgreSQL, Docker daemon, Redis, MinIO or approved live IdP. No tests executed locally; only exact GitHub results are eligible as CI proof.

## B. Agent delivery and role review

| Agent | Delivered and source-reviewed | Integration disposition | Mandatory open review |
| --- | --- | --- | --- |
| 01 Governance | #166 five gate/decision/status files; integrated baseline and decision record | REQUIRES_AUTHORIZATION | Owner release decision; 22 unresolved threads; branch protection; A1–A8, ADR and applicable G0–G7 |
| 02 PostgreSQL | #172 R26 Scope A/B evidence, read-only SQL census, seven-role target; original proposal 0055 remains unapplied | REQUIRES_AUTHORIZATION | Real patched-PostgreSQL deny matrix, owner/migrator/recovery proof, DBA/AppSec approval |
| 03 AppSec | #171 F-012 recommendation, threat register, R35 foreign-table deny plus 4 source tests | REQUIRES_REMEDIATION | Exact integrated CI, AppSec independent review, legacy CMS/Studio isolation decision |
| 04 SRE | #174 disposable Redis ACL/MinIO IAM 38-case harness and workflow | REQUIRES_AUTHORIZATION | Real BullMQ worker/API isolation, backup/restore, staging identities, issue #175 |
| 05 IAM | #173 production-shaped offline OIDC adapter, revocation/JWKS contracts, membership hydration and negative matrix | REQUIRES_AUTHORIZATION | Real IdP admin, session revocation, live JWKS/outage and RouteExecutor E2E |
| 06 Independent review | Latest COMMENTED source review on #166 2026-11-16T12:07:11Z with AG06-01..11 | REQUIRES_REMEDIATION | A new review of exact final integrated SHA by non-implementing reviewer; separate human security sign-off |

Architect: retain package and contract boundaries; isolated candidate rather than merge. Security: preserve fail-closed runtime/tenant gates and no unapproved R26, F-012 or identity activation. DB engineer: one PostgreSQL transaction for all three roles, transaction advisory serialization, disposable role ACL tests and uncertain-commit reconciliation. API/IAM: OIDC remains unwired, verified server membership only. Infrastructure: synthetic ACL/IAM proof is not real worker proof. i18n/Studio/plugin reviewer: no content/schema/theme changes in this integration; compatibility remains a required suite. QA: final-head CI, real PostgreSQL denial, Playwright, migration compatibility and complete evidence after any new commit.

Implementation plan executed: inspect current status and every specialist changed path -> import disjoint source blobs into isolated branch -> address AG06-05 and mandatory E2E gate -> trigger exact-head CI -> audit the final diff -> publish decisions; unresolved privileged steps must remain blocked.

## C. Remediation and independent disposition register

| Finding | Severity | Source evidence / action | Independent final status |
| --- | --- | --- | --- |
| AG06-05 atomic roles | P1 | CLI had three sequential mutating provisioning operations; now one BEGIN/COMMIT with rollback and advisory lock, 10 PostgreSQL test cases including existing effective-grant rollback, retry and race. A lost connection during COMMIT is explicitly unknown and requires operator inspection. | PENDING fresh review and executed fault matrix |
| AG06-04 OIDC tenant hydration | P1 | #173 hydrates tenantIds only from active server membership; JWT tenant roles/permissions are not trusted, and revocation is required. No production wiring. | PENDING live IdP and positive RouteExecutor E2E |
| AG06-02 R26 | P1 | Scope A proposal/Scope B legacy function grants remain unapplied; #172 fixes global default ACL read-only audit semantics | BLOCKED owner and AppSec authorization |
| AG06-03 W1-T06 | P1 | #174 38-case synthetic Redis/S3 proof; no actual BullMQ worker deny proof | BLOCKED staging identities, issue #175 |
| AG06-06 F-012 | P1 | #171 recommends Option A FORCE RLS for shared risk, Option B only restricted self-hosted with explicit residual risk | BLOCKED owner/DB/AppSec disposition |
| AG06-01 governance | P1 | Main branch is unprotected via accessible branch API, zero approval reviews; unsigned ADR/authorization gates | BLOCKED admin/owner/human review |
| AG06-07 reference Playwright | P2 | Added separate build-dependent reference-app E2E CI job with migration and Chromium | PENDING final-head CI |
| AG06-08 artifact provenance | P2 | Registry manifest digest is not signed build/container provenance; no trustworthy artifact-to-runtime binding implemented | OPEN with release gate proposal |
| AG06-09 foreign tables | P2 | #171 rejects contract foreign tables before grant SQL and adds 4 contract tests | PENDING final-head CI and PG review |
| AG06-11 Fastify | P2 conditional | Existing lock resolves Fastify 5.12.7; advisory GHSA-3qgw-9275-xf8w fixed 5.12.8 only affects configured nonzero handlerTimeout plus streaming; no demonstrated exploitable configuration | OPEN conditional proof or compatible lock refresh |

No Agent 06 finding is marked CLOSED until the non-implementing reviewer reproduces the relevant result. Historic source fixes to privileged bootstrap, role membership closure, registry CAS and R35 security_invoker remain visible as unresolved review threads until accepted by a reviewer; do not auto-resolve.

## D. Integrated validation matrix

| Gate | Command / environment | Evidence |
| --- | --- | --- |
| Individual Wave1 CI | GitHub Actions 43862790731, source 3c55c5b0 | PASS build/e2e/container-scan; not combined |
| Individual infra harness | GitHub Actions 43864193113, source bf1a63ce | PASS disposable harness; not BullMQ |
| New integration CI | GitHub Actions push workflow triggered on isolated integration branch; new reference-app E2E job | NOT CERTIFIED until all final-head job results are recorded |
| Role provisioning | pnpm exec vitest run tests/integration/platform-role-atomic-provisioning.test.ts; PG16.16+ disposable roles | NOT VERIFIED pending CI |
| Contract / OIDC | pnpm exec vitest run --config vitest.platform.config.ts tests/architecture/platform-runtime-contract-relation-kinds.test.ts apps/platform-reference/src/production-oidc-authentication-adapter.test.ts | NOT VERIFIED pending CI |
| Full gates | pnpm audit --prod --audit-level high; pnpm typecheck; pnpm lint; pnpm verify:explicit-any; pnpm test:unit; pnpm test:integration; pnpm build; pnpm verify:clean-tree | NOT VERIFIED on final integration HEAD |
| Reference CRM browser | pnpm test:e2e:platform-reference with fresh PG migrations/Chromium | NOT VERIFIED pending job |
| Real resources and recovery | patched PG roles/RLS, BullMQ ACL, MinIO IAM, restore RPO/RTO, live IdP/rotation | BLOCKED resource approvals |

Build and tests run on merge refs must record actual checkout SHA as well as PR head; a green historical branch is not enough.

## E / H. Explicit owner and external authorization packet

| Decision | Requested action and options | Accountable authorization | Residual and reversibility |
| --- | --- | --- | --- |
| R26-A/B | Approve exact Scope A SQL + global creator-default ACL and separately reviewed legacy Scope B; otherwise reject/defer | DB owner + AppSec + Project Owner | Extension/function callers and migrations; transactional rollback/compensating grants + backup before execution |
| F-012 | Approve staged legacy FORCE RLS (recommended for shared deployments), or expressly restrict Option B to single-operator self-hosted with time-boxed risk acceptance | Project Owner + AppSec + DB owner | Cross-publication SQL/worker/plugin escape; rollback requires tested migration strategy |
| DB-OWN | Assign distinct non-superuser migrator, registry, runtime, reader, verifier and worker identities; supply approved disposable DBA validation access | DB admin / infrastructure owner | Operational migration and role-ownership failure; staged grant rollback |
| T06-STAGING | Authorize disposable per-installation restricted worker/API Redis/S3/queue identities, restore target, RPO/RTO measurements as scoped in #175 | Infrastructure owner + Project Owner | Cross-installation credential leakage; destroy only disposable identities after evidence |
| T07-IDP | Supply approved HTTPS issuer, audience/client registration, scoped JWKS/revocation authority and staging accounts; retain fail-closed static-token prohibition in production | IdP administrator + AppSec + Project Owner | Token confusion, revocation outage, wrong memberships; no production activation until tests |
| R35 | Approve fail-closed foreign-table policy; separately review any future FDW exception | AppSec + DB owner | Incompatible extension schemas; revert code only after alternate proof |
| R40 / provenance | Approve signed release artifact identity, registry image digest/attestation, supply-chain retention and release policy | Release owner + security + infrastructure | Manifest-only integrity cannot prove executable; safe additive metadata path |
| ADR / A1-A8 / G0-G7 | Explicitly accept individual applicable scope, architecture, identity, design, operational, audit and decision gates | Project Owner + appointed domain owners | No implied acceptance from published prose |
| GitHub controls | Configure required checks, CODEOWNERS, security reviewer and non-bypass review protection on main after proposal approval | GitHub repository administrator + Project Owner | Reversible under formal admin change control; no bypass |
| Wave 1 release | Record final exact code SHA, image, environment, final-head green evidence, independent human security sign-off and written GO | Project Owner is final release authority | Until all mandatory gates: NO-GO; no #166 merge and no Wave 2 |

## F. Quality rubric

Keep the recorded 8.3/10 baseline. No independent evidence yet justifies a new number, and a score over 9.0 would not waive mandatory controls.

## G. Final technical recommendation

WAVE 1 — NO-GO. An isolated reviewable integration candidate and several safe remediations exist, but final combined CI, updated independent technical review, real production-shaped infrastructure and identity isolation, R26/F-012 dispositions, governance approvals and a human security sign-off are still mandatory. Do not merge #166, deploy to production, dismiss review findings or start Wave 2.
