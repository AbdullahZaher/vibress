# Second Engineering Review & Scored Roadmap Assessment — 2026-11-14

> **Scope:** PR [#151](https://github.com/AbdullahZaher/vibress/pull/151), its M00–M12 roadmap, existing review R01–R16 and selected Vibress host/Plugin SDK/source files. **This scores the quality of the written roadmap only, NOT the implemented software, exploit resistance, uptime or release certification.** Review based on the commit identified in the PR; GitHub CI and external owner sign-off are independent.

## Overall editorial assessment: 8.0 / 10

**Verdict: Strong strategic roadmap; CONDITIONAL / needs design-owner approval before execution.** The plan is coherent, transparent about existing components and specific about security gates. Its score is limited by unapproved architectural decisions, remaining product breadth, unspecified people/capacity, no execution evidence and still-to-be-built runtime contracts.

### Transparent scoring rubric (qualitative, not independently benchmarked)

| Criterion | Max | Awarded | Reason |
| --- | ---: | ---: | --- |
| Vision and competitive positioning | 1.2 | **1.10** | Clear universal app ambition and phased approach; specific product differentiation still needs user trials. |
| Architecture and extensibility | 1.6 | **1.20** | Strong modular boundary/IR/installation design; formal ADR acceptance and custom-runtime feasibility still pending. |
| Security and tenant isolation design | 1.6 | **1.30** | Serious RLS, roles, trust tiers and negative tests; no implemented verified tenant transaction or production assessment. |
| Scope, sequencing and feasibility | 1.5 | **1.25** | Narrowed CMS+CRM GA and explicit later waves; workload/capacity and critical dependencies unvalidated. |
| Backward compatibility and migrations | 1.3 | **1.00** | Legacy fixtures, additive changes and forward-fix defined; live workload conversion remains untested. |
| Developer and application-building experience | 1.0 | **0.80** | Code-first resource/API/admin/CLI path; frontend/custom-code app substrate still proposed. |
| Measurable verification and acceptance | 1.0 | **0.75** | Negative tests, Golden Apps, and audit evidence schema; budgets and CI docs checker are future tasks. |
| Ownership, delivery governance and operations | 0.8 | **0.60** | Epic IDs and governance exist; no real assigned owners, capacity, SLO or validated runbooks. |
| **TOTAL** | **10.0** | **8.00** | **Roadmap quality, not software quality.** |

The rubric is an **expert editorial judgment** against the documents and source limitations; it is not a measured comparison showing Vibress better than Payload/WordPress/Wix/Ghost. Do not report an 8/10 production certification. Re-score when ADRs are accepted and evidence/estimates are linked; never auto-increase by writing more documentation.

## New second-pass findings (R17–R25)

| ID | Severity | Evidence-backed plan defect | Documentation correction | Required runtime / owner proof |
| --- | --- | --- | --- | --- |
| **R17** | **High — inconsistency** | Original [M07](milestones/M07-cli-sdk-templates.md) E07 and its Deliverables still required **five clean Golden Apps**, contradicting [v1 scope](V1-SCOPE-AND-RELEASE-CRITERIA.md)'s mandatory CMS+CRM minimum. | Rewrite M07 E07/Deliverables, Golden Apps and issue scope: two mandatory GA; three expansion tracks. | M07 acceptance/owner confirms actual supported releases. |
| **R18** | **High — false absolute** | [Master README](README.md) stated **“No data loss”** in a core principle while [review R09](REVIEW-FINDINGS-2026-11-14.md) rejects unconditional lossless schema downgrade. | Replace blanket guarantee with scoped reversible migration, measured recovery and explicit RPO/RTO. | M03/M08/M11 test expand-contract, forward-fix and restore. |
| **R19** | **High — product gap** | Generated CRUD/Admin is insufficient evidence of a general-purpose **web application framework**. No clear v1 contract for custom server actions/routes and user-facing web apps. | Add [Code-first Application Runtime and Extensibility](APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and M01/M04/M07/M08 criteria. | External CRM has both custom authenticated workflow/API and end-user route/pages; no kernel editing. |
| **R20** | **Medium — sequencing** | [Governance](DELIVERY-GOVERNANCE.md) G0 demanded approval of **all ADR-PLAT-001..008** at the start, even when later decisions should be reconsidered at M03/M05/M08. | Phase gates: 001–003 before general runtime/security, 004–005/009 before schema/API, 006 before external modules, 007–008/010 by release; M00 records owners for all. | Decisions signed when applicable, gate status machine-auditable. |
| **R21** | **Medium — topology ambiguity** | [DB contract](DATA-ISOLATION-AND-MIGRATIONS.md) describes one DB per app installation but also says every tenant table must carry app ID, risking contradictory database/key design. | Differentiate logical immutable app/install identity, physical DB isolation and row tenant discriminator; avoid insisting app_id is duplicated when per-install DB already enforces scope. | Real PG model for per-install vs future shared schema is reviewed and testable. |
| **R22** | **High — data lifecycle** | Roadmap covered cross-tenant reads but not sufficiently detailed data export, tenant deletion, retention, backup erasure and legal/contractual privacy boundaries. | Add [Data Lifecycle and Operational Readiness](DATA-LIFECYCLE-AND-OPERATIONS.md), M02/M06/M08/M11 acceptance and owner decision ADR-PLAT-010. | Authorized export/deletion/retention and backup retention evidence; legal review where applicable. |
| **R23** | **Medium — API/event contract** | Events and jobs are planned but public event envelope versioning, schema compatibility and poison-event / re-delivery policies are not explicit enough. | Add versioned event envelope, consumer compatibility, dead-letter/replay and tenant-safe event tests in M05/M06. | Real producer→consumer version upgrade, replay/idempotency and missing-context tests. |
| **R24** | **Medium — measurable operations** | The plan lacks approved SLO/SLI and release error budgets; qualitative sizes M/L/XL/XXL alone do not make a resourced schedule. | Introduce target SLI/SLO/error budget and owner/capacity planning task with actual baselines in M00/M08; no invented numeric promises. | Owners and evidence from representative staging load/error/recovery drills. |
| **R25** | **Medium — traceability & quality** | Existing review says the English roadmap is authoritative but historical mixed-language copy and free-form issue/PR paths can drift. No executable docs validation has run as part of this review. | Link this scorecard, reconcile English files/issue E07 and require docs checker/labelled scope ledger; preserve older translation with warning only. | M00 CI uses frozen link/epic/status validator; PR SHA evidence. |

### Code sources for core unresolved technical risks

- [`getDb()` and pool](../../packages/database/src/connection.ts), [transaction runner](../../packages/database/src/transaction/transaction-runner.ts): generic pooled path vs tenant-bound UoW still to be built.
- [Runtime DB grants](../../packages/database/src/runtime-role.ts), [migration role](../../packages/database/src/migrate.ts): broad CREATE/functions and owner-run migrations to separate.
- [Content Modeler](../../packages/domains/content-modeler/src/application/content-modeler-service.ts): legacy publication scoping; application identity migration needed.
- [Plugin SDK metadata](../../packages/plugin-sdk/package.json): `private: true`; [synthetic extension host](../../packages/plugin-core/src/extension-host.ts): no actual isolated execution.
- [Prelaunch security review](../../SECURITY-REVIEW.md): conditional launch; RLS not certified.

## Disposition and next action

**Editorial discrepancies R17–R25:** corrected or scoped in this PR's English planning artifacts; **not fixed in runtime code or existing live environments**. Previously identified R01–R16 remain open at runtime/design implementation level.

**Merger recommendation:** keep PR **Draft** until platform/product/security/DB owners explicitly review the revised plan and ADR applicability; run document/checker CI against its final SHA. Do not treat a documentation quality score as approval to enable shared hosting, untrusted plugins or general-purpose applications in production.

**First engineering proof:** M00 topology and transaction spike, then M01 nonpublishing app runtime and M02 scoped RLS/security; only then expose general app generation. User-facing custom route/action + generated CRM frontend is a minimal v1 proof, not evidence of every class of application being supported.

**Verification performed here:** GitHub PR status/branch, 13 milestone texts and docs, selected code source, internal repository-relative link targets. **Not performed:** application boot, local build, PostgreSQL RLS integration, production deployment, penetration test or external product benchmark.
