# M05 — Modular Runtime & Plugin Platform

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 2 · **Size:** XL (relative) · **Dependencies:** M01–M04 · **State:** Proposed, not certified.

## Outcome

Extend existing trusted Vibress plugins into a stable general Module SDK with fully tested lifecycle and upgrade/recovery.

## Workstreams and Epics

### M05-E01 — Unified manifest

Unified manifest: dependencies, permissions, data resources, APIs, jobs, events, admin contributions and migrations.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M05-E02 — Dependency/compatibility solver

Dependency/compatibility solver: required/optional modules, version constraints, incompatible capabilities and ABI versions.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M05-E03 — Lifecycle

Lifecycle: discover, validate, install, configure, activate, disable, migrate, observe and retire.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M05-E04 — Trusted admission

Trusted admission: immutable artifact digests, signed release/publisher evidence, lockfiles and operator approval separate from activation.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M05-E05 — Safe upgrade

Safe upgrade: plan, preflight, approve, quiesce, migrate, activate, observe, forward-fix/recover and rollback where feasible.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M05-E06 — Public SDK

Public SDK: compatibility matrix, package publishing, conformance harness and independent example plugin.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M05-E07 — Trust tiers

Trust tiers: privileged reviewed Tier-1 ESM versus future OS-isolated Tier-2 for untrusted code.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- Versioned Module/Plugin SDK with conformance tests
- Installer/upgrader runbook plus crash/restart/restore fixtures
- Independent inventory extension and compatibility registry

## Required acceptance gates

- [ ] Independent plugin builds/installs/upgrades without core changes.
- [ ] Tampered bytes, incorrect signer, unexpected capabilities and revoked releases fail closed.
- [ ] Interrupted upgrade recovers/forward-fixes without silent data loss.
- [ ] Tier-1 Node execution is never represented as an untrusted-code sandbox.

## Known risks and non-goals

- Plugin v3 existing M0–M6 roadmap IDs and evidence remain separate from master M00–M12.
- Existing staged upgrade plans are not proof of completed fleet execution.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Corrected plugin SDK, executable host and upgrade scope

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M05-E08 — Existing SDK publication and ABI reconciliation

Audit @vibress/plugin-sdk (currently private), runtime SDK_VERSION, semver and old plugin-core consumers; define a published-compatible package boundary without a competing SDK.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M05-E09 — Real plugin execution and crash-safe state

Audit/deprecate synthetic ExtensionHost result path, prove vetted module handler execution and stage/approve/quiesce/migrate/activate/observe/recover transitions across API/Worker replicas.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] Published SDK passes packed install and TypeScript declaration tests independent of the monorepo; ABI/version mismatches are rejected.
- [ ] Genuine trusted plugin hooks/actions execute and pass negative tests; synthetic execution paths are not claimed as runtime functionality.
- [ ] Minimal trusted Module SDK + operator-reviewed migration and recovery is sufficient for v1; untrusted marketplace Tier-2 execution is not a prerequisite and stays disabled.

**Implementation constraint:** Existing Plugin Platform M0–M6 documents and statuses are not renumbered; signed ESM still has privileged Node rights.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M05-E10 — Public module/event ABI version fence

Define module capability/route/action/event schema version negotiation, deprecation policy and runtime downgrade rejection for incompatible external consumers.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.
### Additional blocking exit checks

- [ ] A real external module pinned to an old supported API/ABI executes safely or is denied by explicit compatibility failure; no synthetic hook success.
- [ ] Event/handler schema compatibility, revocation and tenant-context guards are included in module conformance tests.

**Scope note:** Do not treat published module metadata or a plugin's TypeScript types as proof of application-scoped runtime enforcement.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M05-E11 — Operator-trusted plugin and grant/ABI upgrade compatibility

Prove signed trusted Tier-1 plugin admission and upgrades across app/runtime/SDK/DB versions; explicitly distinguish privileged Node plugin code from an untrusted sandbox and prevent installer role leakage.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] Plugin installer cannot retain unrestricted privileged DB grants in ordinary API/worker mode; PUBLIC and SECURITY DEFINER privileges reviewed.
- [ ] Version-skew and signer/ABI mismatches fail admission or recover as specified, including crashed upgrade and stale worker tests.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

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
