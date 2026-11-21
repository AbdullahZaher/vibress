# End-of-Milestone Integration, Testing, Independent Audit and Merge Protocol

## Precise cadence requested by Project Owner

**Test only at the completion of each M00–M12 milestone, not after every Epic, tiny task, agent branch, sub-batch or commit.** One consolidated candidate is assembled and subjected to **one complete stage-wide end-gate cycle**. Any failing gate triggers focused debugging and then a new complete mandatory gate run on the new frozen SHA. Never falsely describe unfinished CI as successful.

Inside milestone implementation, use fast static feedback, code reviews, schema/contract design and safe local smoke checks at developer discretion; do not require repetitive full-repository suites or CI for every workstream. GitHub push policies may run mandatory checks automatically; do not weaken protected checks or forge statuses to avoid them. Security-sensitive privilege or data-loss changes still need advance sandbox checks and explicit approvals.

## Workflow per milestone

### Phase A — Planning & isolated development (no full CI yet)
- [ ] Confirm upstream wave gate, previous completed stage, exact code baseline and stale/nonmerged PRs.
- [ ] A01 assigns every Epic and filename ownership to specialists, documents acceptance definitions and security blockers.
- [ ] Create isolated per-agent branches/worktrees; maintain a single milestone integration target; no force pushes or history rewrites.
- [ ] Each specialist finishes implementation, migrations, docs and test cases; report tests as **NOT RUN — DEFERRED TO MILESTONE END**.
- [ ] A11 reviews test definitions and ensures meaningful negative cases without executing the complete cycle after each change.
- [ ] Code integration occurs once as a cohesive milestone candidate; resolve collisions and perform initial source-review checks.

### Phase B — Candidate freeze & one integrated milestone test gate
- [ ] Freeze implementation SHA, Git tree, dependency lockfile, migration journal, fixture digests and relevant downstream product commit SHAs.
- [ ] Run relevant typecheck, formatting, lint, architecture boundaries and security scanning.
- [ ] Run milestone unit, contract and negative tests **against the exact candidate**.
- [ ] For persistence/identity milestones, execute PostgreSQL16 fixture, RLS/ACL, migration replay, concurrent session and rollback/forward-fix tests on **disposable** DBs.
- [ ] For service/runtime milestones, execute real APIs, Workers, Redis/S3, OpenAPI, end-to-end positive/negative tenant tests.
- [ ] For UI and DX, execute browsers, accessibility/RTL, clean consumer builds, published/packed SDK and cache/SSR proof.
- [ ] For changes that affect operational recovery, execute required fault/backup/restore/PITR matrix, verify cleanup and no production touch.
- [ ] Execute **one mandatory full GitHub CI suite at milestone end** including relevant browser/container/artifact jobs. Include explicitly required independent security checks. Keep all skips visible and justified.
- [ ] On failure, do not merge: fix, freeze a new SHA and repeat the **required complete** end-gate plus focused regression.

### Phase C — Specialist and independent certification
- [ ] A02 DBA checks SQL, isolation, migrations and recovery evidence.
- [ ] A03 AppSec checks actual authz, negative proof, boundaries, dependency findings.
- [ ] A04 SRE checks disposable infrastructure, container provenance, observed restore and cleanup.
- [ ] A05 IAM checks principal/tenant/session/operator privileges and real approvals.
- [ ] A11 provides exact tests/pass/fail/skip evidence and coverage gaps.
- [ ] A01 publishes integrated milestone dossier and unresolved P0–P3 findings with unchanged historical evidence.
- [ ] A06 independently reviews frozen SHA, code and logs; may demand targeted reruns for inadequate claims, then issues signed verdict `ACCEPT / CONDITIONAL / REQUEST_CHANGES / NOT_CERTIFIABLE`.
- [ ] Mandatory owner/human DBA/IAM approvals must actually exist for their sensitive scopes; A06 cannot sign on their behalf.

### Phase D — Review approval, controlled merge and tracking
- [ ] No merge if `REQUEST_CHANGES`, `NOT_CERTIFIABLE`, missing mandatory owner approval, open P0/High, failing CI or unsupported infra permissions.
- [ ] An A06 `ACCEPT` establishes **technical review**, not owner release authority. The Project Owner or delegated maintainer must separately grant merge permission.
- [ ] If fully authorized, the authorized maintainer (or automation with explicitly granted permission and branch protection) merges specialist branches into milestone integration and then canonical `main` in approved order, verifying that actual merged tree matches review scope.
- [ ] If conflicts/rebase change code, request new tests and independent delta review. Never silently carry approval across a materially different SHA.
- [ ] Verify merged SHA, current mandatory CI, zero accidental changes, issues updated with precise Epic status and evidence. Close milestone Issue only after formal closure authorization.
- [ ] Independently accept the **Wave GO** only after all mandatory component milestones and cross-cutting gates pass. Later Wave must not use premature deployment authorizations.

## Stage-specific mandatory tests

| Stage | Complete at its end (not after each Epic) |
| --- | --- |
| M00 | repo baseline, Architecture/ADR lint, docs checker, seeded CMS/Studio and offline boot, governance proof |
| M01 | public kernel, independent nonpublishing app boot, registry digest/drift, identity boundary, CMS regression |
| M02 | PG16 runtime ACL/RLS, effective PUBLIC grants, nested transaction, two-tenant/install and actual API/Worker/Redis/S3 negatives, OIDC revocation |
| M03 | canonical IR/DDL/migration/backfill/locks, PG16 race RED/GREEN, C01 CMS mixed inventory, logical restore, targeted PITR recovery, worker version mix |
| M04 | actual scoped generated REST/Admin/typed-client, field/row/SSR/cache/count/export denials, browser E2E, clean CRM |
| M05 | packed SDK/ABI, signed real trusted plugin install/upgrade/revoke/crash recovery, runtime segregation |
| M06 | live action/outbox atomicity, duplicate/retry/DLQ, worker+webhook fault, cross-tenant/app and version upgrade |
| M07 | CLI bootstrap, clean Node/PG consumer, published/packed SDK, templates, end-user CRM page/action |
| M08 | full CMS+Studio+CRM, staging RLS, DB+media+queue restore and measured RPO/RTO, supply-chain, accessibility, independent GA |
| M09 | visual model/forms/pages/preview, IR roundtrip, security/a11y/RTL/keyboard/mobile and generated CRM |
| M10 | agent/MCP scoped commands, prompt injection, approval revocation/quota/audit, reproducible module generation |
| M11 | pinned deploy across environments, secrets/tenant isolation, compatible rollback/forward-fix, DR/observability and self-host independence |
| M12 | publisher signing, marketplace submission/install/revoke/upgrade, malicious module denial and reproducible benchmarks |

## Exact reviewer/merge handoff form

`Milestone ID | Epic coverage 0/1 | original acceptance refs | implementation branch SHA/tree | migrations/role delta | CI run URLs and verdict | PG16/Redis/S3/Node versions | E2E/negative counts | restore/rollback proof | known exclusions | specialist verdict links | human approval references | Agent06 report URL | Project Owner merge authorization | merge SHA and postmerge CI | wave GO status`.

Do not mark the work complete merely by drafting the handoff or passing documentation-only CI. No percentage or delivery date without a measurable denominator and owner agreement.

## Stop / fail-closed conditions

Production credentials or destructive data/DDL touched without written authorization; missing per-app tenant denial, SQL privilege escalation, cross-tenant read, unrecoverable migration, duplicate paid effect, lost acknowledged data, invalid signature or secret exposure: **STOP and escalate**. Do not proceed to the end gate to hide a known security failure. Keep affected milestone and Wave `NO-GO`.
