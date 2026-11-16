# M06 — Actions, Workflows & Business Services

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 2 · **Size:** L (relative) · **Dependencies:** M03–M05 · **State:** Proposed, not certified.

## Outcome

Enable durable business logic and payment/notification workflows beyond CRUD, reusing Vibress BullMQ and outbox.

## Workstreams and Epics

### M06-E01 — Actions

Actions: commands/queries with typed inputs, server-side policies and transactions.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M06-E02 — Workflow primitives

Workflow primitives: durable state, approvals, waits, retries and compensating actions where applicable.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M06-E03 — Transactional outbox/inbox

Transactional outbox/inbox: state + event in one PG transaction, dedupe and at-least-once consumers.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M06-E04 — Tenant-scoped jobs

Tenant-scoped jobs: propagate verified app/tenant context and idempotency through BullMQ.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M06-E05 — Provider adapters

Provider adapters: mail, storage, webhooks, payments, search and notifications.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M06-E06 — Billing/entitlements

Billing/entitlements: decouple subscription state and quotas from payment provider and platform cloud billing.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M06-E07 — Fault injection

Fault injection: duplicate Stripe webhook, queue loss, worker crash, failed mail, interrupted workflow.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/action-engine, workflow-engine, jobs and billing/entitlements ports
- Approval, purchase/inventory and webhook reference flows
- Durable consumer and disaster-recovery tests

## Required acceptance gates

- [ ] Business state and outbox writes are atomic on the same database transaction.
- [ ] Duplicate delivery cannot duplicate entitlements or paid orders in tested scenarios.
- [ ] Workers recover deterministically from interruption and preserve tenant isolation.
- [ ] Actions run with published domain contracts independent from CMS-specific entities.

## Known risks and non-goals

- No general exactly-once external side effect guarantee; require idempotency.
- Avoid building an entire Temporal-like system before genuine requirement.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## v1 minimal durable workflows and failure semantics

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M06-E08 — Bounded v1 reliable action slice

Deliver one representative tenant-aware action+outbox+worker flow and a minimal stateful approval flow. Full billing provider matrix, visual workflow editor and broad adapter catalog are deferred until explicitly supported.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] Outbox and command mutation are committed atomically; consumer effects are idempotent on repeat delivery and retained after worker crash.
- [ ] At least one durable workflow and webhook duplicate test demonstrate tenant scope and deterministic recovery.
- [ ] M06 deliverables distinguish mandatory v1 primitives from optional commerce/automation modules in future releases.

**Implementation constraint:** No exactly-once end-to-end delivery guarantee and no demand for an entire general-purpose workflow orchestration engine before v1.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M06-E09 — Versioned event envelopes and poison-event handling

Use event ID, schema version, application/tenant context, causation/request IDs and explicit consumer compatibility. Test dead-letter/quarantine, safe replay, duplicate deliveries and retention of sensitive job payloads.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] A v1 producer/consumer version upgrade and replay succeeds or fails explicitly, without silent schema misinterpretation or tenant mixing.
- [ ] Dead-letter retry and event retention have documented safety bounds, owner and test evidence.

**Scope note:** At-least-once delivery and external provider idempotency require separate policies; a version number alone is not event authorization.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M06-E10 — Cross-installation service integration and event replay

Define per-target audience/scopes, signed or authenticated outbound/inbound API/events, token expiry/revocation, webhook idempotence, SSRF/egress limits, schema-versioned replay and dead letters. Never share another app's SQL/Redis credentials.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] Service app A cannot read app B through shared SQL or queues; specifically granted API/event exchange works only with scoped audience/credentials.
- [ ] Old/new producer/worker/event versions either interoperate according to tested window or fail safely in DLQ without data/tenant cross-talk.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

## Fourth-pass acceptance: transaction and outbox failure contract

Apply to **M06-E01/E08** and **M02-E08** using the real [transaction runner's nesting rules](../../../packages/database/src/transaction/transaction-runner.ts) and [proposed contract](../RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md).

- [ ] Nested transaction calls cannot independently commit or roll back without an approved savepoint design; an inner error caught by the outer action cannot silently commit forbidden partial state.
- [ ] A nested app/tenant/principal scope switch is denied; retries use a new verified transaction with stable idempotency.
- [ ] Business state and outbox remain atomic under swallowed child error, SQL-aborted transaction, worker retry and duplicate webhook fixtures.

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
