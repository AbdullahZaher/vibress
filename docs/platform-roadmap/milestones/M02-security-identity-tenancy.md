# M02 — Security, Identity & Multi-Tenancy

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 1 · **Size:** XL (relative) · **Dependencies:** M01 (audit from M00) · **State:** Proposed, not certified.

## Outcome

Ship deny-by-default principal, policy and real tenant isolation boundaries for every supported app data surface.

## Workstreams and Epics

### M02-E01 — Identity

Identity: distinguish platform operators from application owners, staff, end users and service accounts; auth adapters and optional MFA/SSO.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E02 — Authorization

Authorization: RBAC, resource and field permissions, row-level policy checks, extensible ABAC with default deny.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E03 — Trusted context propagation

Trusted context propagation: app/tenant/principal identities through API, generated local services, workers, websocket, storage and cache.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E04 — PostgreSQL RLS

PostgreSQL RLS: ENABLE/FORCE as appropriate; transaction-local trusted context on same connection; non-BYPASSRLS roles.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E05 — Role separation

Role separation: runtime DML vs migration owner vs approved plugin schema provisioning; remove broad public CREATE from app workers.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E06 — Security tests

Security tests: IDOR/cross-tenant, request spoofing, pool reuse, cache leakage, alternate API, delayed jobs, exports and webhooks.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M02-E07 — Audit/secrets

Audit/secrets: scoped machine credentials, encryption, rotation, denial logging and production edge verification.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/tenancy, policy-engine, principal-context and RLS adapter
- RLS migration plan and real PostgreSQL negative-test matrix
- Least-privileged runtime/provisioner roles and staging evidence

## Required acceptance gates

- [ ] Cross-app and cross-tenant reads/writes are denied under actual nonowner PG role.
- [ ] Missing/forged tenant context fails closed through every supported execution surface.
- [ ] SET LOCAL uses the same transaction connection and leaks no tenant context across pooled connections.
- [ ] Existing production prelaunch controls undergo new staging/security evidence and sign-off.

## Known risks and non-goals

- RLS is explicitly disabled in current security review; do not claim otherwise.
- Plugin runtime DDL grants are currently wider than desired and need dedicated authorization.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

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
