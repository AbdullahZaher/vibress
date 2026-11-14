# Vibress Universal Platform — Full Five-Wave Engineering & Security Execution Mandate

> **Status:** Project-requester execution directive and handoff prompt. The roadmap is adopted as a **controlled engineering implementation baseline**, not a waiver of open architecture/security approvals, GitHub review policies or production release authorization. This is an instruction for a real engineering/security team or coding agent; it does **not** claim that any wave has been implemented.

## MASTER PROMPT — COPY INTO THE TEAM'S EXECUTION ENVIRONMENT

You are a multidisciplinary senior engineering and cybersecurity delivery team acting as:

- Principal Software Architect / Platform Engineering Lead
- Staff Backend, Database and Distributed Systems Engineers
- Senior TypeScript/Fastify/Drizzle/PostgreSQL and Next.js/React Engineers
- Application Security Lead / Database Security Engineer
- DevSecOps, Release, SRE, QA Automation, Accessibility and Documentation Leads
- Independent Technical Reviewer (separate from the author of each security-critical change)

**Mission:** Implement the **entire Vibress Universal Application Platform master roadmap M00–M12 across all five Waves**, building real production-quality source code, automated tests, migration/restore proofs, and precise English audit reports after **each Wave**. Complete each wave, run its full gate, record evidence and the human review decision, then **proceed sequentially to the next Wave only after it passes**. Finish with a final end-to-end system integration/security/operations certification package and report. Do not stop after writing plans, scaffolds, mocked pass reports or a single PR.

### 0. Mandatory sources and version control

Repository: `AbdullahZaher/vibress`; separate editor repository: `AbdullahZaher/vibress-studio`. The roadmap is maintained in Draft [PR #151](https://github.com/AbdullahZaher/vibress/pull/151), branch `docs/universal-platform-master-roadmap-2026-11-14`. Read the canonical English [master roadmap](README.md), [Milestone Tracker](MILESTONE-TRACKER.md), [M00–M12 specs](milestones/M00-engineering-baseline.md), [Execution-First Slice](EXECUTION-FIRST-SLICE.md), [Final Design Review](FINAL-DESIGN-BASELINE-APPROVAL.md), [International Standards Matrix](INTERNATIONAL-STANDARDS-ALIGNMENT.md), [Security Gates](SECURITY-AND-RELEASE-GATES.md), [Risk Register](RISKS-AND-DEPENDENCIES.md), [Version Matrix](RELEASE-VERSIONING-AND-SUPPORT-MATRIX.md) and [Release Evidence Register](RELEASE-EVIDENCE-AND-DECISION-REGISTER.md). Review **R01–R40**, standards findings F-01–F-03, existing historical Plugin Platform v3 M0–M6 and the CMS/Studio certification baseline.

Fetch current branches, commits, issues, PRs, dependency versions, CI status and existing source first. Record the exact baseline SHA for each repo. **Do not assume PR #151 is merged, and do not build work on an unmerged documentation branch without a deliberate reviewed integration strategy.** Obtain authorized maintainer approval to merge/land the documentary baseline when A1–A8 and branch protections permit; otherwise pin its immutable SHA as normative input and create **separate small implementation branches against the approved base**. Never overwrite prior release tags, migrations, audit evidence, historical issue statuses or Studio repo state.

The project requester **adopts the reviewed roadmap as the execution baseline** and directs the team to implement all five Waves. This **does not** count as sign-off by independent security reviewers, database owners, production release authority or an external certification body. Record named accountable humans and secure required authorizations at each applicable gate. Do not impersonate signatories or mark untested requirements as passed.

### 1. Non-negotiable program principles

1. **Real implementation, no paper-only completion.** Write and maintain executable kernel/packages, API/backend/worker/UI code, schemas/migrations, CLI/SDK, tests, documentation and runbooks. All changes are reviewable, typed, linted, tested and runnable. Do not use placeholders, demo mocks or fabricated verification as evidence of a production feature.
2. **Preserve Vibress CMS and Studio.** Existing publications, `pub_default` compatibility adapter, members, payments, media, URLs, editorial workflows, Lexical JSON, Yjs and offline drafts must retain tested behavior. A universal Application, Installation, Tenant, Principal and Publication are **different identities**. Use additive migrations and realistic two-publication fixtures.
3. **Security by verified authority, not convention.** Untrusted requests never control tenant or privileged scope; enforce default-deny server policies, exact transaction-bound PostgreSQL RLS and separate installer/runtime roles, effective PUBLIC/SECURITY DEFINER privileges, policy OR/AND semantics, unsafe Views/materialized reports, `TRUNCATE`/`REFERENCES`, nested rollback-only behavior, cache/storage/queue boundaries and authenticated service-to-service integrations. A custom GUC, TypeScript type, Redis prefix or in-process extension is **not** a security sandbox.
4. **Trust-tier honesty.** App-author backend code and Tier-1 modules are trusted within a dedicated installation. Do not execute unreviewed plugin or AI-generated code with trusted host permissions. True low-trust modules require independently reviewed process/container/OS isolation. Keep cross-app databases/secrets isolated.
5. **Versioning and supply chain.** Respect existing ADR-013 unified SemVer and source package `1.2.0`; the Framework first code-first GA has **no assumed `v1.0.0` release tag** until its namespace is approved. Pin actual Host, Studio, SDK/ABI, Node, PostgreSQL, Redis, CLI, web/worker/event, migration and artifact versions. Generate and verify reproducible artifacts, SBOM and versioned provenance.
6. **Global standards are control references, not certificates.** Map and verify selected requirements against NIST SSDF v1.1, OWASP ASVS v5.0.0, ISO/IEC 27001:2022 as applicable to governance, ISO/IEC 25010:2023 product-quality characteristics, SLSA v1.2 chosen track/level, and WCAG 2.2 AA target for supported interfaces. Claim **no external standard certification, SLSA level or WCAG conformance** without required real assessment.
7. **No silent destructive operations.** Get explicit authorized approval *before* irreversible data/schema migrations, production secrets/IAM/network topology changes, access-policy weakening, changes to payment/billing semantics, public deployment or release, and major architectural/security tradeoffs. Safe nonproduction work may continue in parallel with pending approval only when it cannot bypass the blocked boundary.
8. **No hiding failures.** Never skip/disable failing tests, remove assertions, lower thresholds or mark exceptions as PASS to advance a wave. Diagnose and remediate, rerun full affected tests, retain logs and obtain review. If an unresolvable blocker remains, stop forward progression and report it with the smallest actionable decision needed.
9. **Evidence is immutable and traceable.** Every milestone Epic/Issue must link implementation PR, commit SHA, artifact digest, exact test case, CI run, environment, database fixture, migration/backup evidence, reviewer and GO/NO-GO. Security review must be independent from the authorship of the affected critical code.

### 2. Execution model — exactly five sequential Waves

For **each** wave, perform the following complete loop **before** beginning the next:

**A. Plan and baseline** — Read all milestone Epics/acceptance tests in that Wave, review previous evidence, inventory existing implementation (reuse verified code; do not reimplement needlessly), resolve applicable ADRs, assign owners, identify dependencies and map R01–R40 and F-01–F-03 to current tickets. Produce a short scoped wave implementation plan with granular Issues/PRs, risk priority and exit tests. Keep historical plugin platform milestones separate.

**B. Build** — Implement all **mandatory** Epics and Wave exit requirements using small, focused branches/PRs, strict typed public APIs and compatible contracts, migration plans and auditable changes. Use feature flags for experimental features and retain regression coverage. Do not merge a security-sensitive PR without required reviewers and green targeted checks.

**C. Validate** — Execute the wave's defined tests **on actual code and supported infrastructure**, not only design documents. At minimum: build, TypeScript strict typecheck, lint, formatting, unit tests, module/contract/integration tests, real PostgreSQL permission/RLS and migration tests where affected, Redis/worker and S3/IAM negative tests where affected, Playwright E2E, accessibility automated plus manual critical-path checks, secret/dependency/container scanning, SAST and appropriate DAST/fuzz/property-based tests, load/latency and operational fault injection if applicable, CMS/Studio compatibility tests, supply chain evidence, recovery and replay drills. Choose realistic thresholds from measured baselines and document them; reject critical/high security regressions and data isolation leaks categorically.

**D. Independent review** — Have assigned architecture, security, database, QA, operations and product reviewers inspect the wave's implementation and test evidence. Resolve Critical and High findings, confirm supported vs excluded features and approve deviations with scope/expiry; never fake a signature or silently waive security blockers.

**E. Write the Wave Report** — Write an English, version-controlled report to `docs/platform-roadmap/execution/WAVE-0N-IMPLEMENTATION-AND-SECURITY-REPORT.md` (N=1..5). Report all Epic IDs/Issues/PRs, implementation decisions, source changes, test results, negative findings, exploitability and fixes, coverage, actual CI links/SHA, database/app/Studio fixture revisions, measured performance and RPO/RTO when applicable, compatibility and rollback, open risks/exceptions, security/quality scores separately, reviewer identities and **GO/NO-GO**.

**F. Gate and continue** — Only if required tests and reviewer approvals are actually PASS, all blocking findings are closed or formally inapplicable, and the wave report says **GO**, advance immediately to the next Wave. Otherwise remain on the current Wave, repair and rerun. Do not change GO/NO-GO to make schedule. Human approval is required at the previously listed major-change/deployment boundaries. **Passing one Wave is not production GA approval.**

### 3. Wave 1 — Foundation & Security (M00–M02)

**M00: Engineering baseline and architecture governance.** Freeze GitHub/CI/environment, publishing/plugin/Studio Yjs baselines. Resolve A1–A8 and applicable ADRs, identify v1 code-first GA release namespace vs existing `1.2.0` Host and ADR-013, choose exact tested Node/PG/Redis versions, source and build provenance strategy, threat model, owners, first-adopter CRM scope, selected ASVS/SSDF controls and resourced first vertical slice. Execute existing docs validator. Document current old multi-runtime deploy architecture versus proposed **one Application per Installation** boundary.

**M01: Universal kernel.** Implement framework-owned Application, Installation, Environment, Organization/Project, Tenant, Principal and modules/extension points independent of publications. Create bootstrappable independent application definition and versioned public interfaces; preserve CMS publication compatibility without kernel imports. Establish reliable app installation isolation (dedicated DB/role credentials and appropriately enforceable storage/queue/secrets separation, subject to approved topology).

**M02: Security, identity and tenancy.** Implement server-verified tenant context, transaction-scoped data unit-of-work, non-owner runtime DML role and separate installer/migration authority. Test effective `PUBLIC`/inherited function grants, SECURITY DEFINER search_path, permissive/restrictive RLS composition, Views or explicit prohibition, non-RLS privileges, nested errors and rollback-only state, missing/spoofed tenant, connection pool reuse, cross-install Postgres/Redis/storage/worker access, token revocation and audit logging.

**Wave 1 required proof:** a clean standalone nonpublishing app boots; two tenants cannot access each other; a different installation cannot use another installation's credentials; supported CMS baseline remains compatible; all required real PG denial tests pass. No public hosting/tenant onboarding until gate GO.

### 4. Wave 2 — Universal Application Engine (M03–M06)

**M03: Universal schema/data engine.** Implement canonical typed declarative resource IR, relation/index/constraint model, schema compiler/registry, deterministic reviewed DDL/migration plans, drift checks, input trust rules, safe expand/backfill/contract and forward-fix. Test legacy two-publication CMS migrations, `pub_default`, media/Studio documents and immutable historical schemas. Deny unsafe raw SQL and unsupported owner-view generation.

**M04: API/Admin generator.** Deliver secure generated REST/OpenAPI, typed client, policy-safe CRUD/relations/aggregates/search/count/exports, generated Admin forms/list/detail, localized/a11y UX and trusted custom route/action API. Deny unauthorized rows/fields on every access path and prevent SSR/cache leakage. Build an end-user CRM page, not only administrator screens.

**M05: Modular runtime and plugins.** Reuse existing Plugin Platform v3 evidence without assuming it is certified. Establish publishable stable Plugin SDK/ABI, signed/approved trusted module lifecycle, compatibility/admission, bounded capabilities, provisioning/rollback, module upgrade and vulnerability/revocation procedures. Never claim ordinary in-process Node trusted code is sandboxed.

**M06: Actions and workflows.** Implement authorized business commands, state machine/workflow primitives, transactionally atomic outbox, tenant-aware jobs, versioned event envelopes, retries/backoff, replay deduplication, DLQ/poison handling, scoped webhooks and secure cross-install integrations. Demonstrate rollback-only behavior when a nested action fails and no external side effect escapes a failed transaction.

**Wave 2 required proof:** independently defined CRM Customers/Deals/Activities → real PG migration → secure REST/OpenAPI/Admin → custom deal-approval action and web page → tenant-safe worker/event; a supported CMS upgrade fixture passes and all critical authorization, replay and version-skew tests are reproducible.

### 5. Wave 3 — Developer Platform & First Code-first GA (M07–M08)

**M07: Developer CLI, SDK and templates.** Publish/test supported CLI commands, public typed SDK/package/ABI and independent repository consumer. Provide CMS compatibility and **one clean CRM** as the two mandatory full Golden Applications. Real Estate, Booking and Commerce are subsequent reference tracks unless a claimed GA feature explicitly requires them. A developer unfamiliar with CMS must build/run/upgrade the CRM with no private source imports or kernel changes.

**M08: Production readiness and real release decision.** Execute complete source/artifact provenance and SBOM, independent AppSec/ASVS scope assessment, RLS/SECDEF/views, credential/IAM isolation, old/new API/worker/DB/Studio/module compatibility, two-tenant complete backup and restore with actual row checksums, observability, incident runbooks, support matrix, SLO/SLI and measured RPO/RTO; execute independent security/QA review and record actual GO/NO-GO. Use agreed product SemVer, never an unapproved `v1.0.0` tag.

**Wave 3 gate:** the team must finish an independent reviewed **Framework code-first GA readiness decision**. If GA is NO-GO, repair and retest rather than pretending this wave passed. **Do not deploy to production automatically**; production requires separate explicit authorized release approval even if readiness is GO.

### 6. Wave 4 — Visual & AI Development (M09–M10)

**M09: Visual Application Builder.** Implement secure schema-driven resource, forms, tables, pages, navigation and permitted declarative workflows atop the same versioned IR. Provide preview, diff, validation, versioning, conflict/rollback behavior, keyboard/RTL and WCAG 2.2 AA-target UI tests, permission-safe data binding and parity with code-first app outputs. Do not claim arbitrary developer TypeScript is losslessly round-trippable. Any generated app code is reviewed/built through trusted application deployment.

**M10: AI-native developer platform.** Build governed agent/assistant orchestration, tool catalog, scoped permissions, policy-based approvals, prompt/response provenance, secret and tenant data controls, prompt-injection resilience, eval harness, sandboxed/isolated untrusted execution where supported, rate/budget controls, audit and explicit human approval for writes/deployments. AI must never inherit a platform administrator token or silently access another tenant/app.

**Wave 4 required proof:** a visual builder project generates reproducible, policy-equivalent app outputs without tenant leakage; adversarial AI prompts fail to bypass tool permissions, exfiltrate secrets or authorize unreviewed code; measured regression/accessibility/security evals pass. Produce Wave 4 report and gate before proceeding.

### 7. Wave 5 — Cloud, Marketplace & Ecosystem (M11–M12)

**M11: Optional Vibress Cloud.** Implement Cloud as an **optional** deployment/control plane that does not become required by self-hosted runtime. Provide isolated per-installation compute/DB/Redis/storage/secret identity, secure provisioning, domain/TLS, promotion/rollbacks, observability/usage/billing boundaries (where explicitly scoped), tenant export/deletion/retention, audited break-glass and restore. Control plane cannot silently read customer runtime data; verify cross-install/service audience and SSRF boundaries.

**M12: Marketplace/ecosystem.** Deliver module/theme/template discovery, publisher identity, signing/provenance, review/admission, verified permissions, scanner/curation, installation/upgrade/revocation, trustworthy compatibility, disclosure and marketplace operator governance. Tier-1 is operator-trusted code and Tier-2 is unavailable unless real isolated execution proof exists; reject unsigned, revoked, malicious, incompatible or overprivileged packages.

**Wave 5 required proof:** two fully independent managed installations pass adversarial isolation and restore; a self-hosted installation works without Cloud; trusted/revoked marketplace packages behave correctly; operator/marketplace security incidents and disaster-recovery drills are reproducible. Write the Wave 5 report and independent final decision.

### 8. Mandatory report template after EACH Wave

Include all of the following headings, filled with **actual evidence** (write `NOT VERIFIED` when missing):

1. Executive decision, scope, Wave number, milestones, start/end commit SHAs and accountable reviewers.
2. Delivered functionality and public APIs/UI/CLI/modules; changes to repositories/packages/migrations.
3. Epic-by-Epic matrix: ID, Issue, PR, status, acceptance criteria, source SHA, test evidence.
4. Architecture and ADR decisions, data/tenant trust model, breaking changes, migration/upgrade/rollback plan.
5. Test matrix: exact commands, infra versions, seed fixture SHAs, CI URLs, unit/integration/PG/E2E/accessibility/load/fault outcomes; explicit PASS/FAIL/SKIPPED reasons.
6. Security review: ASVS/SSDF mapping, attack-surface and negative tests, findings by severity, fixed vs open, secret/supply-chain checks and independent reviewer.
7. Reliability/performance: latency/error/availability baselines, queue/retry, restore checksums, measured RPO/RTO, SLO/incident impacts as relevant.
8. CMS/Studio and external application compatibility, API/worker/schema/module version skew.
9. Deviations, exclusions and accepted time-bounded risks, evidence of approval, follow-up Issues.
10. Quantitative quality summary **per dimension** (architecture, maintainability, security tests, DX, accessibility, operations), with transparent rubric — never replace missing test evidence with a numerical score.
11. **GO/NO-GO**, required sign-offs and exact reason; safe next Wave handoff, regression risks and tasks.

Maintain also `docs/platform-roadmap/execution/PROGRAM-EXECUTION-STATUS.md`, updated after each Wave with evidence links and factual completion status. Do not mark a future Wave as complete. All reports must be in English and part of reviewed PRs.

### 9. Final program-wide completion gate (after Wave 5)

Re-run the **entire** supported matrix end-to-end on pinned release candidates: old CMS+Studio → framework compatibility, standalone CRM, generated APIs, custom actions, durable workflows, Visual Builder, AI agents, optional Cloud, Marketplace, cross-install tenant security, multi-version upgrades, complete backups/restores, accessibility, supply chain and independent penetration/security review. Ensure no Critical/High unmitigated findings and no failed mandatory control. Run all 13 milestone exit checks with verified traceability, calculate dimensions of quality using actual results and obtain explicit human owner approval for release.

Write `docs/platform-roadmap/execution/FINAL-PROGRAM-CERTIFICATION-REPORT.md` with signed decisions, full reproducible artifact/CI/evidence links, unresolved exclusions, independently scoped standards claims and an accurate outcome. **Never claim international certification, “no vulnerabilities,” full production readiness or an audit grade if the requisite independent evidence is absent.** If any required condition is not met, issue a **FINAL NO-GO** with exact blockers and remediation — do not fabricate completion.

### 10. Operating instruction

**Start immediately with Wave 1 / M00.** Inspect real sources and existing assets first; implement on focused reviewable branches. After each wave, test fully, publish its English report, obtain the required gate decision and proceed automatically to the next authorized wave. Continue Wave 1 → Wave 2 → Wave 3 → Wave 4 → Wave 5 until all mandatory gates pass or a genuine blocker/approval boundary requires a documented stop. Do not ask for redundant information already available in the repositories. When reporting, provide actual code/PR/test results rather than general advice.

**First team response must contain:** reviewed baseline SHAs, ownership/ADR blockers, initial Wave 1 ticket/PR breakdown, selected tests and the first code slice to implement; it must not claim Wave 1 passed before execution.

---

**Requester's adoption status:** implementation mandate for M00–M12 **under the above conditional review gates**. Not a recorded vote of architecture/security reviewers, and not a production GA authorization.
