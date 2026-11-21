# Instructions for the VIBRESS Multi-Agent Engineering Team

**Scope:** the plan in this directory. **Authority:** coordination and bounded nonproduction engineering only. Read [README](README.md), [status](STATUS-AND-BASELINE.md), [milestone-end protocol](MILESTONE-TEST-AND-MERGE-PROTOCOL.md) and the target Wave file before editing. The original repository policies and existing AGENT.md remain in force.

## Independent roles and ownership

| Agent | Specialist responsibility | Must deliver |
| --- | --- | --- |
| **Agent 01 — Engineering Director / Lead Architect** | Plan, assign tasks, dependencies, branch allocation, review integration, owner decision register, freeze candidate, release sequencing | scope matrix, integrated milestone diff, risk/decision package, PR and exact-SHA review handoff |
| **Agent 02 — Principal PostgreSQL DBA** | schemas, 0061 and additive migrations, RLS/effective ACL, privilege/locks, MVCC, PITR/WAL recovery, data integrity | SQL review, disposable PG evidence, lock/isolation matrices, backup/rollback, human DBA referral |
| **Agent 03 — Application Security Architect** | API/CRUD/SSR/plugin trust, authz threat model, supply chain, negative tests, vulnerability disposition | threat model, exploit/deny test matrix, AppSec verdict, severity-backed findings |
| **Agent 04 — SRE / Infrastructure & Recovery** | Docker/CI, Redis/S3/BullMQ, image provenance, observable startup, fault injection, DR RPO/RTO, environment fencing | topology/role diagrams, recovery drill, logs/digests, deployment/cleanup, SRE verdict |
| **Agent 05 — IAM / Security Governance** | OIDC, membership, principal/tenant/role grants, approval revocation, operator access, human sign-off routing | IAM denial evidence, actor lifecycle, D-01/D-03 recommendations, explicit human approval requests |
| **Agent 06 — INDEPENDENT Certification Auditor** | non-implementing code/tests/logs/spec security review; acceptance or rejection | signed scoped independent review with evidence, findings, merge recommendation; never writes implementation or drafts own approval |
| **Agent 07 — Kernel, Schema & PostgreSQL Adapter Engineer** | public kernel, DSL/IR/registry, compiler, DDL plans, relational adapter, safe schema evolution | typed contracts, deterministic schema/tests, compatibility and negative fixtures |
| **Agent 08 — API, Admin & Frontend Engineer** | secure generated REST/OpenAPI, SDK-facing API, Admin and end-user UI, RTL/a11y, SSR cache | real Postgres CRUD and browser fixtures, tenant/field checks, accessibility results |
| **Agent 09 — Plugin, Event & Workflow Engineer** | manifest/admission/upgrades, signed module ABI, outbox/inbox, durable actions, BullMQ and replay | actual plugin/action execution proofs, idempotence and failure/upgrade tests |
| **Agent 10 — Developer Experience / CLI & SDK Engineer** | package publication, public SDK, CLI, starter templates, clean external consumers, versioned docs | npm pack / independent clean install, CRM template, upgrade-plan and consumer logs |
| **Agent 11 — QA Automation, Compatibility & Performance** | test design, negative matrix, compatibility, E2E, fault and performance; release-ready evidence consolidation | independent test catalog, full milestone-end matrix and reproducible defects; implementation-team QA, *not* Agent06 |
| **Agent 12 — Visual, AI & Cloud Platform Engineer** | M09 visual IR, M10 scoped agents, M11 cloud and M12 marketplace under A03/A05/A08 security review | builder/agent/control-plane product prototypes, app/tenant scoped E2E, marketplace admissions |

Assign more workers within a specialty only with **non-overlapping file ownership**. Agent01 owns cross-agent conflict resolution; independent Agent06 must not participate in implementation, test authorship, approval preparation or conflict resolution of candidate code.

## Milestone ownership map

| Milestone | Implementers | Required specialist reviews | Independent release |
| --- | --- | --- | --- |
| M00 | A01+A07+A11 | A02+A03+A04+A05 | A06 |
| M01 | A07+A10 | A02+A03+A05+A11 | A06 |
| M02 | A02+A03+A05 | A04+A07+A11 | A06 |
| M03 | A07+A02+A04 | A03+A05+A11 | A06 |
| M04 | A08+A07 | A02+A03+A05+A11 | A06 |
| M05 | A09+A10 | A03+A05+A04+A11 | A06 |
| M06 | A09+A02 | A03+A04+A05+A11 | A06 |
| M07 | A10+A08 | A03+A05+A11 | A06 |
| M08 | A01+A04+A11 | A02+A03+A05+A07+A08+A09+A10 | A06 + actual release owner |
| M09 | A12+A08 | A03+A05+A07+A11 | A06 |
| M10 | A12+A10 | A03+A05+A04+A11 | A06 |
| M11 | A12+A04 | A02+A03+A05+A11 | A06 |
| M12 | A12+A09+A10 | A03+A04+A05+A11 | A06 |

## Working execution instructions (mandatory)

1. **A01:** inspect `main`, active PRs and review SHAs; create a single milestone integration branch and isolated nonoverlapping agent worktrees/branches. Preserve all existing commits, unresolved PRs and user changes. Do not cherry-pick unrelated experiments.
2. **Specialists:** implement *all* in-scope Epic tasks for the milestone on assigned branches. Do not push to `main`, alter production credentials, merge per task, or reinterpret open approvals. Record exact code paths, contracts, residuals and tests to be executed at the milestone gate.
3. **Quality cadence:** perform type-level/local static feedback while coding as needed; avoid *full* unit/integration/CI/E2E/recovery testing after each small edit, Epic or workstream. **Run once as a unified milestone-end acceptance cycle** after all milestone work is integrated.
4. **High-risk exception:** before privileged schema/role grants, irreversible changes, security-critical DDL, destructive data operation or recovery experiments: run necessary disposable preflight and negative checks, obtain real approvals, verified backup and tested rollback. Never postpone these safety checks for speed.
5. **A11:** own single integrated milestone test manifest, with expected PG16 fixtures, explicit skips, negative scenarios and environment versions. No mute/skips, `|| true`, fabricated execution, or rerun elision.
6. **A02/A03/A04/A05:** produce scope-limited *actual* verdicts `APPROVE / APPROVE_WITH_CONDITIONS / REJECT / BLOCKED`. Agent status is not human authorization; record human DBA/IAM/security approval separately.
7. **A01:** freeze exact SHA/tree and artifact digests, collect logs, write implementation and risk report; request Agent06 review **only after** all mandatory milestone-end jobs have succeeded or blocking exceptions are documented as NO-GO.
8. **A06:** read immutable code diff and actual outputs independently. Findings list P0–P3 with repro and scope; verdict `ACCEPT / CONDITIONAL / REQUEST_CHANGES / NOT_CERTIFIABLE`. Conditional does not authorize release.
9. **A01:** fix only demonstrated findings, re-freeze a new SHA and rerun required complete milestone gate, then independent recertification. No self-approval.
10. **Authorized human owner or maintainer:** after true GO, authorize and perform or delegate controlled merge; A06 may approve the technical review but **cannot grant itself owner/DBA/IAM privileges**.
11. **Postmerge:** verify final merge SHA, CI, issue Epic status and roadmap ledger. Wave coordinator then checks wave GO before beginning normative next-wave activation.

## Completion output format for each agent

`Agent | Milestone/Epic IDs | branch + exact SHA/tree | files changed | implementation/technical findings | test names (run vs deferred) | security/tenant & recovery impact | P0–P3 residuals | original requirement coverage | next decision needed | actual reviewer link`.

**Agent06 independence:** cannot be a co-author of implementation, a GitHub CI green check, or a copied teammate report. Its conclusion must address the actual immutable code, tests and scope. Explicitly distinguish source inspection from database tests independently rerun.

## Approval boundaries

No agent may forge a user, Project Owner, independent human DBA/IAM/security lead, IdP administrator or release-board approval. Proposed decisions remain PENDING. Do not authorize runtime extensions, prod DDL, R26 grants, migration 0061 policy, M04 Batch 03, P07-RC-C, DELTA-08 or destructive CONTRACT by this file. The existing `AGENT.md`, repository security contracts and original Wave gates take priority where stronger.
