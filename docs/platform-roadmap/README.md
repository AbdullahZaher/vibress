# Vibress Universal Application Platform — Master Development Roadmap

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

## Vision and strategy

Turn Vibress into a **general-purpose, open-source application development framework**: CRM, SaaS, real estate, commerce, booking, education and publishing must be possible **without modifying platform kernel for each new project**. Preserve Vibress CMS and standalone Vibress Studio. Do not fork Payload or replace the existing TypeScript/Fastify/Drizzle/PostgreSQL/BullMQ stack without proven need.

Three coherent products: **Vibress Framework** (public code-first kernel + SDK), **Vibress Studio / App Builder** (independent Lexical editor and future schema-driven visual app builder), and **optional Vibress Cloud** (deployment control plane, never a dependency for self-hosted runtime).

## Review and decision status

**Review result:** [PR #151 architecture/security findings (2026-11-14)](REVIEW-FINDINGS-2026-11-14.md) identifies high-impact planning gaps; the documentation has been revised, **not the runtime**. The review is advisory pending owner approval. [Mandatory ADR decisions](ARCHITECTURE-DECISION-GATES.md), [isolation and schema migration contract](DATA-ISOLATION-AND-MIGRATIONS.md), and the [explicit v1 scope](V1-SCOPE-AND-RELEASE-CRITERIA.md) must be approved before implementation is treated as ready. This English set is the **normative current plan**; the earlier Arabic overview is informational and may lag behind new gates.

**Recommended v1 deployment mode:** one Application per Installation; each application may host several isolated tenants in PostgreSQL when explicitly supported. Shared execution of unrelated customer apps in a privileged process is *not* an assumed v1 guarantee; see ADR-PLAT-001.

## Core principles

1. Modular monolith before microservices; clear public contracts and dependency boundaries.
2. CMS is an optional module/application, not the runtime's root identity.
3. Project, Application, Installation, Environment, Organization, Tenant, Principal and Publication are distinct concepts.
4. Canonical application resource IR drives TypeScript code-first, visual and AI interfaces.
5. Secure by default: RBAC/ABAC, real PostgreSQL tenant RLS for supported scoped tables, audited service actions, isolated DB roles.
6. Reliable upgrades: semver, compatibility gates, additive migrations, preview/approval/restore. No data loss.
7. Trusted reviewed plugins first; untrusted code isolation must be real OS/process isolation.
8. Preserve existing CMS/Studio semantics with adapters and pinned fixtures.
9. Evidence-based releases and independent review; never infer certification from a green CI check alone.
10. Open-source self-hosting remains complete; managed cloud is optional.

## Waves

| Wave | Milestones | Business objective |
| --- | --- | --- |
| **1 — Foundation & Security** | M00–M02 | Stable baseline, general kernel, verified identity/isolation |
| **2 — Universal Application Engine** | M03–M06 | Generic resources → data/API/admin; plugins, workflows |
| **3 — Developer Platform & v1** | M07–M08 | CLI, SDK, templates, golden apps, independent GA acceptance |
| **4 — Visual & AI Development** | M09–M10 | No-code application construction and governed agent workflows |
| **5 — Cloud & Ecosystem** | M11–M12 | Optional hosting, marketplace and external ecosystem |

## Master milestones

| ID | Milestone | Size | Depends on | Status |
| --- | --- | --- | --- | --- |
| [M00](milestones/M00-engineering-baseline.md) | Engineering Baseline & Architecture Governance | M | None | **Proposed** |
| [M01](milestones/M01-universal-kernel.md) | Universal Application Kernel | XL | M00 | **Proposed** |
| [M02](milestones/M02-security-identity-tenancy.md) | Security, Identity & Multi-Tenancy | XL | M01 (audit from M00) | **Proposed** |
| [M03](milestones/M03-schema-data-engine.md) | Universal Schema & Data Engine | XL | M01–M02 | **Proposed** |
| [M04](milestones/M04-api-admin-generator.md) | API & Admin Generation Engine | XL | M03 | **Proposed** |
| [M05](milestones/M05-module-plugin-runtime.md) | Modular Runtime & Plugin Platform | XL | M01–M04 | **Proposed** |
| [M06](milestones/M06-actions-workflows.md) | Actions, Workflows & Business Services | L | M03–M05 | **Proposed** |
| [M07](milestones/M07-cli-sdk-templates.md) | Developer CLI, SDK & Application Templates | L | M03–M06 | **Proposed** |
| [M08](milestones/M08-v1-release.md) | v1 Production Certification & Public Release | XL | M00–M07 | **Proposed** |
| [M09](milestones/M09-visual-builder.md) | Visual Application Builder | XXL | M03,M04,M07; GA after M08 | **Proposed** |
| [M10](milestones/M10-ai-native.md) | AI-Native Development Platform | XL | M07; integrations with M09 | **Proposed** |
| [M11](milestones/M11-cloud-control-plane.md) | Vibress Cloud & Deployment Control Plane | XXL | M07,M08 | **Proposed** |
| [M12](milestones/M12-marketplace-ecosystem.md) | Marketplace, Ecosystem & Platform 2.0 | XL | M05,M08; M11 for cloud flows | **Proposed** |

## v1 minimum and expansion boundaries

The first general-purpose release is **not** blocked on five complete Golden Apps, a Wix-class builder or a complete PaaS. **Mandatory:** existing CMS compatibility plus a newly generated CRM; minimum trusted Module SDK, authenticated REST/OpenAPI/admin, PostgreSQL RLS, CLI, durable job/outbox and independent release review. Real Estate, Booking and Commerce are staged *reference tracks* rather than full GA gates unless a capability is explicitly marketed in GA. See [v1 scope](V1-SCOPE-AND-RELEASE-CRITERIA.md).

## Release boundaries

| Release target | Mandatory milestones | What ships |
| --- | --- | --- |
| **Platform Alpha** | M00–M04 | Nonproduction preview of resource→Postgres→REST/OpenAPI→admin; reviewed threat model and tenant gating |
| **Platform Beta** | M00–M07 | Minimum trusted modules/workflows, external SDK/CLI, CMS + CRM reference fixtures |
| **Platform v1.0 GA** | M00–M08 | Explicit security/recovery assessment and GO/NO-GO for a self-hosted code-first v1 |
| **Platform Builder** | M09 | Visual model/forms/tables/page construction atop same IR |
| **Platform AI** | M10 | Scoped agents, MCP, skills, approvals and evaluation harness |
| **Vibress Cloud** | M11 | Optional projects and environment deployment control plane |
| **Platform 2.0** | M12 | Marketplace, publisher/revocation program and transparent benchmarks |

## Critical path and verification

`M00 → M01 → M02 → M03 → M04 → (M05, M06, M07) → M08`. Early threat-model/CLI/design prototypes are allowed but do not bypass milestone gates. **First defining test:** a self-contained CRM app with customers/deals/activities, organizations/roles and RLS must boot via public contracts **without importing posts, publications or newsletters, or changing kernel**.

Every milestone requires typed public contracts; CI/build/typecheck; integration/negative tests; compatibility and data migration evidence; recovery/rollout plan; documented deployment and reviewer acceptance. See [Governance](DELIVERY-GOVERNANCE.md) and [Security gates](SECURITY-AND-RELEASE-GATES.md).

## Related documentation

- [Review findings and remediation register](REVIEW-FINDINGS-2026-11-14.md)
- [Mandatory architecture decision gates](ARCHITECTURE-DECISION-GATES.md)
- [Tenant isolation and migration authority contract](DATA-ISOLATION-AND-MIGRATIONS.md)
- [Explicit v1 release scope and phased delivery](V1-SCOPE-AND-RELEASE-CRITERIA.md)
- [Earlier Arabic overview — informational, not authoritative until synchronized](README.ar.md)
- [Target architecture](PLATFORM-ARCHITECTURE.md)
- [Governance and Definition of Done](DELIVERY-GOVERNANCE.md)
- [Security and production gates](SECURITY-AND-RELEASE-GATES.md)
- [Risk register and dependencies](RISKS-AND-DEPENDENCIES.md)
- [Golden applications and benchmark methodology](GOLDEN-APPLICATIONS.md)
- [Existing-code traceability](EXISTING-ASSETS.md)
- [GitHub milestone issue tracker](MILESTONE-TRACKER.md)

## Evidence separation

Existing [CMS roadmap](../13-roadmap/implementation-phases.md), [plugin platform v3 plan](../08-plugins/plugin-platform-master-roadmap-v3.md), [dependency rules](../01-architecture/dependency-rules.md), [2026-11-13 security review](../../SECURITY-REVIEW.md), and [Studio readiness](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/production-readiness.md) remain authoritative for their own decisions and historical status. This master plan does **not** rewrite them or claim their gates are closed.
