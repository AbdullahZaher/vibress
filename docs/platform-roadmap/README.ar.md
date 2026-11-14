> **English canonical edition / translation status (2026-11-14):** This earlier Arabic roadmap summary does **not yet** incorporate the complete R01–R16 engineering review and updated M00–M12 blocking criteria. For approved planning, use the [English master roadmap](README.md), [review findings](REVIEW-FINDINGS-2026-11-14.md) and [v1 scope](V1-SCOPE-AND-RELEASE-CRITERIA.md). This is an informational translation only; its older statements must not override the English acceptance gates.

# Vibress Platform — خارطة التطوير الكاملة

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

## الرؤية

تحويل Vibress من منصة نشر إلى إطار عام مفتوح المصدر لإنشاء أي تطبيق ويب: CRM، SaaS، عقارات، حجوزات، تجارة إلكترونية، تعليم ونشر. **المعيار الأهم:** إنشاء تطبيق مختلف بالكامل دون تعديل `platform-kernel` أو الاعتماد على Posts وPublications.

تتكون الرؤية من ثلاث منتجات مترابطة: **Vibress Framework** لمحرك التطبيقات والـSDK، و**Vibress Studio / App Builder** لتحرير المحتوى وبناء التطبيقات بصريًا، و**Vibress Cloud** كخدمة نشر اختيارية لا تمنع الاستضافة الذاتية.

## خمس موجات و13 معلمًا

| الموجة | معالمها | الغاية |
| --- | --- | --- |
| 1 — الأساس والأمان | M00–M02 | تدقيق الواقع الحالي واستخراج Kernel آمن وهوية مستقلة |
| 2 — المحرك العام | M03–M06 | Schema وAPI وAdmin وPlugins وWorkflows |
| 3 — المطور والإطلاق | M07–M08 | CLI وSDK وقوالب واختبارات واعتماد v1.0 |
| 4 — البناء البصري وAI | M09–M10 | إنشاء التطبيقات بصريًا وبوكلاء محكومين بالصلاحيات |
| 5 — السحابة والمنظومة | M11–M12 | نشر اختياري وسوق إضافات آمن ومجتمع مطورين |

## تفاصيل المعالم

### [M00 — Engineering Baseline & Architecture Governance](milestones/M00-engineering-baseline.md)

**الاعتماد:** None | **الحجم:** M

Freeze reproducible current-state evidence and decide immutable boundaries before extracting a general framework.

**نطاق التنفيذ:** Repository inventory: classify apps, domains, packages, dependencies, API/Studio/plugin contracts as existing, partial or planned.؛ Architecture ADRs: define the new app identity vocabulary, module ownership, versioning, hosting and trust decisions.؛ Boundary enforcement: codify Nx/ESLint rules to forbid kernel→publishing, UI→database and plugin→private internals imports.؛ Compatibility baseline: pin host and Studio commits, collect CMS documents, subscriptions, roles, media, Yjs and migration fixtures.؛ Quality governance: capture security findings, CI/scan/restore evidence, risks, support matrix, approval and release process.؛ Traceability: establish epic→issue→PR→tested evidence→signoff ledger..

**تسليمات:** Versioned baseline architecture report and package inventory؛ ADR index and dependency-boundary automation؛ Legacy fixture harness and evidence/risk ledger.

**بوابة القبول:** A clean repository checkout reproduces documented baseline test commands.؛ Architectural boundary tests reject deliberately forbidden imports.؛ Every current app/package has an explicit ownership map and migration strategy.؛ Baseline gaps, including production certification limits, remain visible and are not marked done without evidence..

### [M01 — Universal Application Kernel](milestones/M01-universal-kernel.md)

**الاعتماد:** M00 | **الحجم:** XL

Let a brand-new nonpublishing app run without changing framework internals, while keeping the current CMS working.

**نطاق التنفيذ:** Domain vocabulary: define Project, Application, Environment, Installation, Organization, Tenant, Principal and Publication separately.؛ Public kernel contracts: ApplicationDefinition/Context, ModuleDefinition, RequestContext, PolicyDecision and DomainEvent.؛ Application registry: persisted definitions, versioned modules and installation/environment records.؛ Dependency inversion: application services use kernel ports; no publishing dependencies in kernel.؛ Strangler compatibility: preserve CMS routes, editor documents, publications, members, billing, migrations and data during extraction.؛ Reference consumer: task-manager using only public contracts, without posts/publications/newsletters imports..

**تسليمات:** packages/platform-kernel, app-contracts, app-registry and compatibility adapters؛ Task-manager proof-of-concept؛ CMS/Studio cross-version compatibility report.

**بوابة القبول:** Task-manager runs independently using stable public contracts.؛ Kernel import graph does not depend on publishing domains.؛ Old CMS content, membership, paid plans and Studio persisted document fixtures still pass.؛ No app/tenant identity may be derived from a client-controlled publication fallback..

### [M02 — Security, Identity & Multi-Tenancy](milestones/M02-security-identity-tenancy.md)

**الاعتماد:** M01 (audit from M00) | **الحجم:** XL

Ship deny-by-default principal, policy and real tenant isolation boundaries for every supported app data surface.

**نطاق التنفيذ:** Identity: distinguish platform operators from application owners, staff, end users and service accounts; auth adapters and optional MFA/SSO.؛ Authorization: RBAC, resource and field permissions, row-level policy checks, extensible ABAC with default deny.؛ Trusted context propagation: app/tenant/principal identities through API, generated local services, workers, websocket, storage and cache.؛ PostgreSQL RLS: ENABLE/FORCE as appropriate; transaction-local trusted context on same connection; non-BYPASSRLS roles.؛ Role separation: runtime DML vs migration owner vs approved plugin schema provisioning; remove broad public CREATE from app workers.؛ Security tests: IDOR/cross-tenant, request spoofing, pool reuse, cache leakage, alternate API, delayed jobs, exports and webhooks.؛ Audit/secrets: scoped machine credentials, encryption, rotation, denial logging and production edge verification..

**تسليمات:** packages/tenancy, policy-engine, principal-context and RLS adapter؛ RLS migration plan and real PostgreSQL negative-test matrix؛ Least-privileged runtime/provisioner roles and staging evidence.

**بوابة القبول:** Cross-app and cross-tenant reads/writes are denied under actual nonowner PG role.؛ Missing/forged tenant context fails closed through every supported execution surface.؛ SET LOCAL uses the same transaction connection and leaks no tenant context across pooled connections.؛ Existing production prelaunch controls undergo new staging/security evidence and sign-off..

### [M03 — Universal Schema & Data Engine](milestones/M03-schema-data-engine.md)

**الاعتماد:** M01–M02 | **الحجم:** XL

Turn typed application resources into reviewable PostgreSQL schemas without depending on publishing models.

**نطاق التنفيذ:** Universal resource DSL: text, numbers, money, datetime, enum, media, relations, localization, JSON and Studio documents.؛ Canonical IR and registry: one versioned representation for code-first, visual builder and agent tools.؛ Relational rules: indexes, unique constraints, foreign keys, concurrency tokens, soft delete and deterministic pagination.؛ Schema compiler: produce migrations, schema manifests, validation rules and change reports.؛ Storage strategy: physical Postgres tables for transactional data plus bounded dynamic models; avoid JSONB-only design.؛ Schema evolution: expand/contract, backfill, safe renames, compatibility windows and destructive-change approvals.؛ Security coupling: every generated tenant-owned resource requires consistent ownership/policy/RLS semantics..

**تسليمات:** packages/schema-engine, resource-contracts, migration-planner and postgres adapter؛ Resource DSL specification with migration safety rules؛ CRM schema fixture for customers/deals/activities.

**بوابة القبول:** CRM schema compiles to real relations, constraints and versioned migrations.؛ Additive migration and backfill retain live fixture records; unsafe destructive changes require approval.؛ Resource introspection does not leak forbidden fields or tenant data.؛ A new domain resource is independent from Publication and Posts..

### [M04 — API & Admin Generation Engine](milestones/M04-api-admin-generator.md)

**الاعتماد:** M03 | **الحجم:** XL

Provide Payload-class productivity: secure generated REST/OpenAPI, TypeScript clients and Admin CRUD from one resource definition.

**نطاق التنفيذ:** CRUD operations compiler: typed operations, validation, optimistic concurrency, safe filters and list pagination.؛ REST/OpenAPI generator: documented endpoints, errors, versioning and authenticated exposure controls.؛ Typed application SDK: generated client with scopes and stable error model.؛ Host-rendered Admin UI: resource forms, list views, filters, details, relations and declarative metadata.؛ Authorization binding: row, field, relationship and bulk/export projections enforced server-side.؛ Extension lifecycle: authorized hooks and validated custom actions without bypassing permissions.؛ Performance guardrails: resource limits, unbounded query prevention, rate limits and external consumer tests..

**تسليمات:** packages/api-generator, admin-view-generator and typed client generator؛ Secure generated CRM REST/OpenAPI/Admin UI؛ Sample clean consumer and generated API conformance tests.

**بوابة القبول:** CRM CRUD/UI/API can be generated with no handwritten route or basic form code.؛ Field/record policies apply consistently across list, detail, search, exports and mutations.؛ New service works outside monorepo and tests pass in a clean environment.؛ Query complexity and tenant data exposure negative tests pass..

### [M05 — Modular Runtime & Plugin Platform](milestones/M05-module-plugin-runtime.md)

**الاعتماد:** M01–M04 | **الحجم:** XL

Extend existing trusted Vibress plugins into a stable general Module SDK with fully tested lifecycle and upgrade/recovery.

**نطاق التنفيذ:** Unified manifest: dependencies, permissions, data resources, APIs, jobs, events, admin contributions and migrations.؛ Dependency/compatibility solver: required/optional modules, version constraints, incompatible capabilities and ABI versions.؛ Lifecycle: discover, validate, install, configure, activate, disable, migrate, observe and retire.؛ Trusted admission: immutable artifact digests, signed release/publisher evidence, lockfiles and operator approval separate from activation.؛ Safe upgrade: plan, preflight, approve, quiesce, migrate, activate, observe, forward-fix/recover and rollback where feasible.؛ Public SDK: compatibility matrix, package publishing, conformance harness and independent example plugin.؛ Trust tiers: privileged reviewed Tier-1 ESM versus future OS-isolated Tier-2 for untrusted code..

**تسليمات:** Versioned Module/Plugin SDK with conformance tests؛ Installer/upgrader runbook plus crash/restart/restore fixtures؛ Independent inventory extension and compatibility registry.

**بوابة القبول:** Independent plugin builds/installs/upgrades without core changes.؛ Tampered bytes, incorrect signer, unexpected capabilities and revoked releases fail closed.؛ Interrupted upgrade recovers/forward-fixes without silent data loss.؛ Tier-1 Node execution is never represented as an untrusted-code sandbox..

### [M06 — Actions, Workflows & Business Services](milestones/M06-actions-workflows.md)

**الاعتماد:** M03–M05 | **الحجم:** L

Enable durable business logic and payment/notification workflows beyond CRUD, reusing Vibress BullMQ and outbox.

**نطاق التنفيذ:** Actions: commands/queries with typed inputs, server-side policies and transactions.؛ Workflow primitives: durable state, approvals, waits, retries and compensating actions where applicable.؛ Transactional outbox/inbox: state + event in one PG transaction, dedupe and at-least-once consumers.؛ Tenant-scoped jobs: propagate verified app/tenant context and idempotency through BullMQ.؛ Provider adapters: mail, storage, webhooks, payments, search and notifications.؛ Billing/entitlements: decouple subscription state and quotas from payment provider and platform cloud billing.؛ Fault injection: duplicate Stripe webhook, queue loss, worker crash, failed mail, interrupted workflow..

**تسليمات:** packages/action-engine, workflow-engine, jobs and billing/entitlements ports؛ Approval, purchase/inventory and webhook reference flows؛ Durable consumer and disaster-recovery tests.

**بوابة القبول:** Business state and outbox writes are atomic on the same database transaction.؛ Duplicate delivery cannot duplicate entitlements or paid orders in tested scenarios.؛ Workers recover deterministically from interruption and preserve tenant isolation.؛ Actions run with published domain contracts independent from CMS-specific entities..

### [M07 — Developer CLI, SDK & Application Templates](milestones/M07-cli-sdk-templates.md)

**الاعتماد:** M03–M06 | **الحجم:** L

Provide reproducible self-hostable creation, extension and upgrade of applications via a public SDK, CLI and templates.

**نطاق التنفيذ:** CLI: vibress create/add/generate/doctor/upgrade --plan/upgrade --apply/verify with dry-run and safe defaults.؛ Public app SDK: typed queries/actions/resources, identity, events, storage and notifications.؛ Templates: minimal, SaaS, CRM, admin/dashboard, CMS; later real-estate, booking and commerce.؛ Clean installed consumers: compile/run with published/packed packages outside monorepo.؛ Upgrade UX: codemods, compatibility checks, handwritten vs generated ownership and restore guidance.؛ Developer docs: quickstart, API and Plugin SDK, migration and production checklist.؛ Golden apps: CMS, CRM, real estate, booking and commerce using only public framework APIs..

**تسليمات:** packages/cli, app-sdk and templates with docs؛ Five clean installed golden applications؛ Versioned module and app upgrade conformance suite.

**بوابة القبول:** A CRM app is created and boots in a clean environment without kernel edits.؛ Adding and upgrading an external module works through documented public APIs.؛ All templates run their auth/tenant/security tests as generated.؛ Handwritten customizations survive code regeneration or produce an explicit merge conflict..

### [M08 — v1 Production Certification & Public Release](milestones/M08-v1-release.md)

**الاعتماد:** M00–M07 | **الحجم:** XL

Release stable, self-hostable, independently assessed code-first Vibress Platform v1.0 with reproducible evidence.

**نطاق التنفيذ:** Independent security audit: identity, permissions, tenant RLS, plugin trust, generated endpoints and uploads.؛ Compatibility matrix: CMS + Studio history and previous app/client/plugin versions.؛ Performance: repeatable p50/p95/p99, startup, memory, migrations and job latency under disclosed workloads.؛ DR drills: database/object/queue backups, restore, migration recovery and measured RPO/RTO.؛ Supply chain: SBOM, provenance/signatures, dependency and image scans, security advisory policy.؛ Release docs: compatibility matrix, support, semver, operator guide, developer tutorial.؛ Go/no-go board: immutable SHA, tested artifacts, reproducible commands, independent approval..

**تسليمات:** v1.0 release candidate and complete support/runbooks؛ Independent threat/audit report and remediations؛ Public benchmarks, recovery evidence and QA ledger.

**بوابة القبول:** No known unresolved Critical/High issue within audited scope before GA.؛ Final immutable build passes Golden App, CMS and Studio compatibility matrix.؛ Actual staging verifies RLS/roles, backup restoration, migrations, TLS and recovery.؛ Release explicitly signed off; passing CI alone does not certify a production system..

### [M09 — Visual Application Builder](milestones/M09-visual-builder.md)

**الاعتماد:** M03,M04,M07; GA after M08 | **الحجم:** XXL

Let non-developers build secure apps visually using exactly the same canonical app resource IR as code-first.

**نطاق التنفيذ:** Visual data modeler: models/fields/relations/policies and safe migration preview.؛ Form builder: layouts, conditional inputs, validated fields, files and dynamic relations.؛ Data tables and dashboards: filters, metrics, charts, row actions and dashboards.؛ Page/layout builder: routing, navigation, reusable design tokens, themes and responsive components.؛ Action/data bindings: secure preview, workflow wiring and explicit server runtime permissions.؛ Visual-code synchronization: IR ownership, generated regions, version history and export review.؛ Accessibility/RTL/IME and collaboration: real devices and recovery as an acceptance gate..

**تسليمات:** apps/builder and packages/ui-engine/visual-builder؛ Canonical visual schema and export-import contract؛ No-code CRM demo and user acceptance test plan.

**بوابة القبول:** A noncoder creates and deploys a CRM to staging without handwritten CRUD.؛ Visual changes produce reviewable versioned resource definitions; custom code is never silently lost.؛ Generated preview and production both enforce resource/tenant policies server-side.؛ A11y, keyboard, RTL and real mobile test matrix meets accepted quality budget..

### [M10 — AI-Native Development Platform](milestones/M10-ai-native.md)

**الاعتماد:** M07; integrations with M09 | **الحجم:** XL

Make agents productive but tightly permissioned developers of resources, modules, migrations, interfaces and tests.

**نطاق التنفيذ:** Agent SDK: typed inspect/create/update/validate commands against public application DSL.؛ MCP server with scoped principal and tool capabilities; no arbitrary tenant selectors.؛ Skills/AGENTS.md: ADR-aware guidance for modules, migrations, test plans and security.؛ Approval flow: diffs, destructive migration preview, dependency changes and privileged operations.؛ Constrained runtime: no unrestricted production credentials, shell or secret access.؛ Evaluation harness: pinned tasks across CRM, booking, real estate; record fixes, costs, regressions and violations.؛ Visual compatibility: apply changes to same canonical resource IR, not separate agent state..

**تسليمات:** packages/agent-kit + scoped MCP tools؛ Agent policy and approval integration؛ Reproducible agent task evaluation suite.

**بوابة القبول:** Agent can generate and test a CRM module without kernel edits.؛ Unauthorized tools and production database changes are denied independent of prompt wording.؛ Privileged actions produce principal/app/tenant auditable records.؛ Model/tool versions and reproducibility limitations are recorded with benchmark evidence..

### [M11 — Vibress Cloud & Deployment Control Plane](milestones/M11-cloud-control-plane.md)

**الاعتماد:** M07,M08 | **الحجم:** XXL

Provide optional preview/staging/production deployments while preserving 100% self-hosted runtime portability.

**نطاق التنفيذ:** Control plane: org/project/app/env/installations distinct from tenant inside app.؛ Artifact-based build/deploy: reproducible images and promotions with digests and health checks.؛ Secrets/isolation: per-environment credentials, scoped deployer roles and network boundaries.؛ Networking: domains, TLS, ingress, CSRF/CORS/edge rules and service-to-service authentication.؛ Operations: logs, traces, alerts, backup, queue management, incident and recovery.؛ Billing of cloud usage: quotas and metering distinct from application subscriptions.؛ Deploy adapters: Docker baseline, optional Kubernetes or external clouds when tests justify..

**تسليمات:** apps/console + packages/deployment/adapters؛ Preview→staging→production deployment workflow؛ Cloud runbooks and self-hosted conformance test.

**بوابة القبول:** A pinned app image promotes across environments with isolated secrets.؛ Rollback and forward-fix restore a previously tested functional state without losing newer user data.؛ Framework/Golden App continue running self-hosted without Cloud credentials.؛ Operations report measurable recovery and alerts tied to immutable release IDs..

### [M12 — Marketplace, Ecosystem & Platform 2.0](milestones/M12-marketplace-ecosystem.md)

**الاعتماد:** M05,M08; M11 for cloud flows | **الحجم:** XL

Scale extension development through governed marketplace, publisher trust, enterprise needs and transparent external benchmarks.

**نطاق التنفيذ:** Registry: immutable plugin/template versions, compatibility, dependencies and deprecation.؛ Marketplace UX: discovery, release inspection, explicit operator admission and install approval.؛ Publisher program: verified identity, release signatures, provenance and revocation.؛ Supply-chain/security: SBOM, scans, advisories, moderation, safe update/recovery.؛ Enterprise adapters: SSO, policy controls and dedicated tenant database as real demand dictates.؛ Community: public roadmap, contribution contract, support versions and governance.؛ Comparative benchmarks: transparent tasks against Payload, WordPress, Wix, Ghost and low-code peers..

**تسليمات:** Registry + publisher portal + admission/test policy؛ External developer conformance and security review pipeline؛ Public comparable benchmark harness and release governance.

**بوابة القبول:** External author builds, signs, submits and updates a module via documented SDK.؛ Untrusted/unreviewed listing does not imply executable admission.؛ Revocation prevents new admissions and defines existing fleet response.؛ Marketing comparisons include exact task, hardware, source commits and limitations..


## إصدارات المنتج المستهدفة

**Alpha (M00–M04)** لبناء Backend وREST وAdmin آمن؛ **Beta (M00–M07)** مع الوحدات والـCLI؛ **GA v1.0 (M00–M08)** بعد تدقيق مستقل ومهام استعادة؛ ثم Visual Builder وAI وCloud وMarketplace كمنتجات تبنى على العقود ذاتها.

## المبادئ الثابتة

عدم كسر CMS وStudio؛ الفصل بين Application/Tenant/Publication؛ RLS مثبت بالاختبار لا بالافتراض؛ تعديلات البيانات المدمرة تتطلب Preview وموافقة؛ اعتماد نسخ وتقارير وقبول صريح لكل Milestone؛ والتزام الاستضافة الذاتية. **هذه خطة مقترحة، وليست بيان اكتمال أو شهادة إنتاج.**
