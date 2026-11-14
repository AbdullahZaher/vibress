# Platform v1 Scope, Release Gate and Roadmap Simplification

> **Proposed release cut, not a shipped feature or production approval.** This file explicitly separates universal-platform *v1 mandatory* capability from advanced optional modules and future releases.

## v1 GA — mandatory capability set

| Domain | Minimum evidence-backed v1 target | Exit proof |
| --- | --- | --- |
| General kernel | Application per installation; versioned contracts, app/tenant/principal vocabulary; no publishing core imports | Independent CRM boots without kernel edits and current CMS fixtures pass |
| Identity / security | Default deny RBAC, scoped resource policy, real PG RLS for supported intra-app multi-tenant resources, separate DML/DDL role | Cross-tenant HTTP/worker/database tests and independent audit |
| Data / upgrades | Typed resource DSL, real relational schema, safe migration compiler, plan/preflight, nondestructive evolution and backfill | CRM customer/deal/activity migrations preserve fixture data |
| APIs / admin | REST/OpenAPI/typed TS SDK, generated basic forms/tables with server-side field/row policy | Clean client and admin E2E from resource definitions |
| Custom web application surface | **One authenticated custom server action + typed HTTP endpoint + end-user UI route** owned by the external CRM, with SSR/cache safety and no privileged kernel imports | Clean external front-end/route integration and no kernel modifications |
| Modules | Stable minimum **trusted** module contract, signed/approved artifact handling, compatibility matrix, basic lifecycle and safe migration approval; no Tier-2 | Independent inventory module installs/upgrades with crash-recovery evidence for supported operations |
| Actions | Transactional action boundary, tenant-aware worker, durable event/outbox, deduped webhooks, minimal service adapter(s) | Booking-approval or inventory state flow + duplicate-event fault test; full billing product not mandated |
| DX | `create`, `add`, `doctor`, `upgrade --plan`, packaged SDK, minimal/CRM/CMS template | Clean external install and generated regression checks |
| Release | Deployment/rollback/forward-fix plan, backup restore, support matrix, SBOM/supply chain, actual staging + independent security review | Immutable commit/artifacts, explicit GO/NO-GO by release owner |

**Application types:** v1 proves a code-first, data-backed web/SaaS/admin workload; it does **not** prove support for arbitrary operating systems, native mobile runtime, games or every database. See [Application Runtime Contract](APPLICATION-RUNTIME-AND-EXTENSIBILITY.md).

**Mandatory Golden Applications:** (1) **existing Vibress CMS** backwards compatibility, (2) **new clean CRM** independent of publishing. Booking-like workflow can be a focused test fixture; full Booking/Commerce/Real Estate products do not block GA unless their claims are advertised at release.

## Not mandatory for first GA

- Full Visual App Builder, external marketplace, untrusted Tier-2 plugin execution, built-in AI agent tools or Cloud; **arbitrary untrusted custom backend code**.
- General GraphQL and every database engine/SQL provider.
- Complete commerce/booking/real-estate products, advanced business workflow designer, full PaaS, or arbitrary plugin migrations.
- All enterprise SSO/SCIM features or granular ABAC policies beyond the defined v1 policy profile.

These remain in M09–M12 or explicit post-v1 modules; their absence must be disclosed honestly in release docs.

## Progressive delivery

1. **Proof gate A (M00–M02):** accepted architecture topology, independent task app, proven tenant isolation and role split.
2. **Proof gate B (M03–M04):** CRM resource → PostgreSQL → REST/OpenAPI → admin with negative authorization coverage.
3. **Proof gate C (M05–M07):** external trusted module, minimal actions/jobs, SDK/CLI, clean CRM and CMS.
4. **GO/NO-GO gate (M08):** actual staging, independent security assessment, repeated migration and DR runs, pinned versions and supported operating constraints.
5. **Post-GA (M09+):** UI builder, AI agents, optional cloud and marketplace, each with independent risk and launch gates.

Proof gates are about executable code and evidence, not the existence of planning documents.

## Terminology and certifications

Use **Production Readiness Review / GA Decision** for M08; do **not** imply accreditation by a standards body, complete WCAG compliance, or verified exploit-free status from internal review. A GA claim requires an explicit audit scope, finding severity policy, named release decision-maker and dated immutable evidence. No universal guarantee of "zero data loss" in every upgrade; measure supported recovery scenario and RPO/RTO.

## Data, legal and operations evidence

v1 requires a testable authorized tenant export/offboarding policy, retention/audit/backup runbooks and owner-review of relevant legal/contractual obligations; no blanket compliance claim. The release owner must publish a supported topology, event version support policy, observed RPO/RTO and SLI/SLO targets based on measurements rather than arbitrary numbers. See [data lifecycle](DATA-LIFECYCLE-AND-OPERATIONS.md).

## Additional v1 security and release proofs (third review)

- **Effective DB ACL:** PUBLIC/inherited EXECUTE and SECURITY DEFINER audited, multiple RLS policy compositions verified, TRUNCATE and REFERENCES denied to ordinary runtime; inspect upgrades from old CMS/plugin baseline.
- **Physical app isolation:** two installed apps with separate database and scoped Redis/storage credentials cannot cross boundaries; one app owner code is trusted only within its own installation. Tenant isolation applies to end users inside a supported app, not malicious same-process arbitrary SQL.
- **Cross-app integration:** services communicate via scoped/signed API/events rather than shared SQL/queues; include token revocation, replay/SSRF tests.
- **Upgrade matrix:** old/new API/worker/SDK/web/schema/event/module versions tested under rolling deployments; blocked downgrade/forward-fix scenarios documented with measured recovery.
- **Developer validation and operators:** owner/capacity and first adopter hypothesis, real clean-install feedback and documented support/SLO budgets before public competitive claims.

See [third review](THIRD-REVIEW-AND-RATING-2026-11-14.md), [Postgres rights](POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [installation trust](APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [upgrade matrix](UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

## Fourth-pass minimum product exclusions and recovery proof

**Generated SQL views and tenant-owned materialized reporting are not v1 mandatory features.** If included, supported PostgreSQL versions must pass explicit owner-context/`security_invoker`, materialized snapshot and tenant denial tests; otherwise the compiler/API must reject this feature. See [view authorization and backup contract](RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md).

**Full-database backup ≠ tenant export.** A scoped application user may not see all records under RLS; the release must prove complete backup/restore with an independently audited role and per-tenant counts/checksums. Nested transactional action failure and rollback-only behavior must match the real [transaction runner](../../packages/database/src/transaction/transaction-runner.ts).

**Mandatory legacy compatibility scenario:** one upgraded CMS with at least two publications and any `pub_default` data, plus a separate new CRM installation. See [explicit mapping](LEGACY-CMS-IDENTITY-AND-MIGRATION.md). [First slice](EXECUTION-FIRST-SLICE.md) prioritizes proof and owners without committing to unresourced delivery dates.

## Product success measurements

Measure time-to-first-working-secure-app on fresh hardware, public SDK usability, edits to kernel needed per independent module (target **zero**), contract migration success, tenant break-out failures (target **zero in defined matrix**), version compatibility, incident recovery and p95 under disclosed load. M00 must set benchmark budgets before calling any system faster/better than Payload, WordPress, Ghost or Wix.
