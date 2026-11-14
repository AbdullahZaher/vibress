# M11 — Vibress Cloud & Deployment Control Plane

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 5 · **Size:** XXL (relative) · **Dependencies:** M07,M08 · **State:** Proposed, not certified.

## Outcome

Provide optional preview/staging/production deployments while preserving 100% self-hosted runtime portability.

## Workstreams and Epics

### M11-E01 — Control plane

Control plane: org/project/app/env/installations distinct from tenant inside app.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M11-E02 — Artifact-based build/deploy

Artifact-based build/deploy: reproducible images and promotions with digests and health checks.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M11-E03 — Secrets/isolation

Secrets/isolation: per-environment credentials, scoped deployer roles and network boundaries.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M11-E04 — Networking

Networking: domains, TLS, ingress, CSRF/CORS/edge rules and service-to-service authentication.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M11-E05 — Operations

Operations: logs, traces, alerts, backup, queue management, incident and recovery.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M11-E06 — Billing of cloud usage

Billing of cloud usage: quotas and metering distinct from application subscriptions.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M11-E07 — Deploy adapters

Deploy adapters: Docker baseline, optional Kubernetes or external clouds when tests justify.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- apps/console + packages/deployment/adapters
- Preview→staging→production deployment workflow
- Cloud runbooks and self-hosted conformance test

## Required acceptance gates

- [ ] A pinned app image promotes across environments with isolated secrets.
- [ ] Rollback and forward-fix restore a previously tested functional state without losing newer user data.
- [ ] Framework/Golden App continue running self-hosted without Cloud credentials.
- [ ] Operations report measurable recovery and alerts tied to immutable release IDs.

## Known risks and non-goals

- Avoid building an entire generic PaaS prematurely.
- Control plane must never inherit blanket tenant permissions in apps.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Control-plane/runtimes trust and safe deployment reversibility

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M11-E08 — Deployment privilege and data recovery contract

Separate platform admin/deployer from application end user and tenant, isolate per-environment secrets/network/DB, promote artifacts by digest, test operator break glass and secret revocation.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M11-E09 — Compatible promotion and forward-fix

Require expand-contract for database upgrades; application rollback supported only within validated schema compatibility window. For destructive change, block automated rollback and use documented forward-fix or restored backup with measured RPO/RTO.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] No app's control-plane actor, release artifact or secret can access another app's runtime without separately approved delegation.
- [ ] Recovery exercise demonstrates version/DB compatibility and honestly records any write-loss window instead of universal zero-loss promise.
- [ ] Self-hosted runtime and Golden CRM work without Vibress Cloud token or hosted control-plane dependency.

**Implementation constraint:** Cloud is optional; v1 Framework GA does not require shipping a PaaS or Kubernetes adapter.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M11-E10 — Tenant offboarding and control-plane data rights

Define data location, data/tenant export, deletion/retention/backup boundaries, break-glass operator access and incident evidence across hosted control plane and each application installation.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] Cloud-controlled tenant data export/deletion cannot access other installations, and residual encrypted backups/queues have disclosed expiration windows.
- [ ] Managed service SLOs and RPO/RTO are verified independently from self-hosting support statements.

**Scope note:** Never claim complete legal compliance or instant erasure solely from a database delete call.

## Milestone closure evidence ledger

| Evidence | Status / link |
| --- | --- |
| Accountable owner | TBD |
| ADR / public contract | TBD |
| Immutable implementation commit SHA | TBD |
| CI checks and test fixtures | TBD |
| Security/tenancy and migration evidence | TBD |
| Deployment/restore evidence | TBD |
| Independent reviewer and decision | **OPEN — not certified** |

## Program links

[Master roadmap](../README.md) · [Security gates](../SECURITY-AND-RELEASE-GATES.md) · [Governance](../DELIVERY-GOVERNANCE.md) · [Existing work](../EXISTING-ASSETS.md)
