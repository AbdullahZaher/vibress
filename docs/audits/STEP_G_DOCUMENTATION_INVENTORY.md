# Step G: Documentation & Product Claims Inventory

**Date:** 2026-09-15  
**Auditor:** Antigravity Autonomous Release Agent  
**Step:** Step G (Documentation / Product Claims Truth Reconciliation)  
**Status:** COMPLETE  

---

## 1. Executive Objective

The objective of this inventory is to enumerate all root and repository-level documentation files, user manuals, developer guides, release reports, and metadata manifests within Vibress. Each document is classified by target audience, documented scope, and audited for architectural, operational, and performance assertions against actual source code and verified test fixtures.

---

## 2. Documentation Catalog & Scope Classification

| Document Path | Document Purpose | Target Audience | Primary Technical Assertions |
| :--- | :--- | :--- | :--- |
| `README.md` | Primary open-source landing document | End-users, Developers, Evaluators | Architecture topology, Next.js runtime, Studio editor features, plugin extensibility, quality verification counts. |
| `CONTRIBUTING.md` | Developer onboarding and workflow guide | Open-source contributors | Monorepo structure, database migration workflow, code standards, PR checklist, container topology. |
| `SECURITY.md` | Security disclosure policy and posture | Security researchers, Operators | Supported versions, vulnerability reporting protocol, fail-closed boundaries, auth lifecycle SLAs. |
| `CHANGELOG.md` | Chronological record of release changes | All stakeholders | Version history, categorized features (`v1.0.0` GA release). |
| `docs/release/V1.0.0_RELEASE_NOTES.md` | Official release announcement notes | Public, Press, Community | GA release capabilities, architecture diagram, security features, verified quality test results. |
| `VIBRESS_V1.0.0_RELEASE_REPORT.md` | Formal engineering release sign-off report | Release Engineering, Auditors | Complete verification gates, baseline commit SHA, package alignment, container readiness, DR drill results. |
| `.github/whats-new.json` | In-app feature announcement feed | End-users, Studio editors | Active feature release notices (version 1 schema, collaborative Studio editor). |
| `docs/01-architecture/overview.md` | Core system architectural doctrine | Engineers, Architects | Modular monolith design rationale, service boundaries, database and Redis topology. |
| `docs/08-plugins/plugin-sdk.md` | Plugin developer API and lifecycle guide | Plugin authors, Developers | Capability permission model, in-process trusted execution, hook dispatch, publication isolation. |
| `docs/developer/plugin-sdk.md` | Developer-facing plugin SDK documentation | Plugin authors, Developers | Plugin manifest structure, hook registration, capability scopes. |
| `docs/deployment/SELF_HOSTING.md` | VPS and bare-metal self-hosting runbook | System Operators, DevOps | Docker deployment, environment configuration, reverse proxy setup, backup & restore. |
| `docs/deployment/PRODUCTION.md` | Production operations and security hardening | Production Operators | Non-root containers, internal network isolation, secrets hygiene, rate limiting. |
| `docs/deployment/DOCKER.md` | Container architecture and network topology | DevOps, Infrastructure | Multi-service Compose spec, health checks, volume mounts, port bindings. |
| `docs/deployment/TROUBLESHOOTING.md` | Operational diagnostic playbooks | Support, Operators | Common failure modes, DB locks, Redis disconnection, container crash loop recovery. |

---

## 3. Discovered Documentation Drift & Contradictions

During rigorous code cross-referencing, the following divergences were identified between written documentation and actual workspace reality:

### 3.1 Next.js Runtime Framework Version
- **Documented Claim:** `README.md` (line 43), `docs/release/V1.0.0_RELEASE_NOTES.md` (line 11), and `VIBRESS_V1.0.0_RELEASE_REPORT.md` (line 5) describe the public web frontend as **Next.js 14 SSR**.
- **Code Reality:** `apps/web/package.json` explicitly pins:
  ```json
  "next": "^15.5.24",
  "eslint-config-next": "^15.5.24"
  ```
- **Reconciliation Action:** Update all occurrences across `README.md`, `V1.0.0_RELEASE_NOTES.md`, and `VIBRESS_V1.0.0_RELEASE_REPORT.md` to declare **Next.js 15 SSR**.

### 3.2 System Architecture Terminology (Microservices vs Modular Monolith)
- **Documented Claim:** `CONTRIBUTING.md` (line 77) states `- docker/ — Production Dockerfiles for all microservices.`
- **Code Reality:** The system architecture is authoritatively defined as a **containerized modular monolith**. All domains execute within modular host applications sharing PostgreSQL 16 (Drizzle ORM) and Redis 7 (BullMQ). True microservices would entail separate databases, distributed sagas, and network RPC per domain, which Vibress explicitly disavows.
- **Reconciliation Action:** Strike "microservices" from `CONTRIBUTING.md`; update to "containerized application services" or "modular monolith services".

### 3.3 Plugin Runtime & Sandboxing Model
- **Documented Claim:** `README.md` (line 24) claims "Sandboxed plugin architecture".
- **Code Reality:** Step F architectural audit proved that Node.js `node:vm` / `vm.createContext()` is deprecated and officially disavowed by the Node.js security team as a security boundary against hostile code. Vibress enforces a **Trusted Plugin Architecture** (Tier 1 bundled plugins & Tier 2 admin-verified plugins) with granular capability permission checks (`hasCapability`) and publication isolation.
- **Reconciliation Action:** Align `README.md` to state **"Trusted plugin architecture (Tier 1 bundled & Tier 2 admin-verified)"** with capability-based permission gating.

### 3.4 Test Suite Scope & Counts
- **Documented Claim:** `README.md` (line 137), `V1.0.0_RELEASE_NOTES.md` (line 102), and `VIBRESS_V1.0.0_RELEASE_REPORT.md` (line 162) state `1,074 tests across 135 files`.
- **Code Reality:** Following production hardening across Steps D, E, and F (including multi-publication tenant isolation, studio collaboration, and plugin security test suites), the full test suite contains **158 test files** and **1,258 total tests** (1,253 active, 5 intentionally skipped).
- **Reconciliation Action:** Update test count assertions across release notes, README, and release reports to reflect the verified suite metrics.

### 3.5 Database Migration Head
- **Documented Claim:** Historical reports cite migration `0025_staff_invitations_and_password_resets.sql`.
- **Code Reality:** Migration `0026_multi_publication_tenant_isolation.sql` is the authoritative migration head establishing multi-tenant schema invariants across all 14 publication-owned tables. Zero new migrations may be introduced.
- **Reconciliation Action:** Explicitly affirm migration 0026 as the authoritative schema head.

---

## 4. Verification Protocol

All reconciliations will be backed by:
1. Direct file edits eliminating stale claims.
2. An automated consistency guard test (`tests/integration/documentation-truth.test.ts`) that asserts:
   - Next.js 15 SSR is asserted in package.json and docs.
   - Zero occurrences of "microservices" in architecture descriptions.
   - No untruthful "hostile VM sandboxing" claims.
   - `.github/whats-new.json` validates against schema.
   - Migration 0026 is confirmed as the migration head.
