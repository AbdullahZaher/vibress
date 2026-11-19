# M03 — Universal Schema & Data Engine

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

**Wave:** 2 · **Size:** XL (relative) · **Dependencies:** M01–M02 · **State:** Proposed, not certified.

## Outcome

Turn typed application resources into reviewable PostgreSQL schemas without depending on publishing models.

## Workstreams and Epics

### M03-E01 — Universal resource DSL

Universal resource DSL: text, numbers, money, datetime, enum, media, relations, localization, JSON and Studio documents.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E02 — Canonical IR and registry

Canonical IR and registry: one versioned representation for code-first, visual builder and agent tools.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E03 — Relational rules

Relational rules: indexes, unique constraints, foreign keys, concurrency tokens, soft delete and deterministic pagination.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E04 — Schema compiler

Schema compiler: produce migrations, schema manifests, validation rules and change reports.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E05 — Storage strategy

Storage strategy: physical Postgres tables for transactional data plus bounded dynamic models; avoid JSONB-only design.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E06 — Schema evolution

Schema evolution: expand/contract, backfill, safe renames, compatibility windows and destructive-change approvals.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.

### M03-E07 — Security coupling

Security coupling: every generated tenant-owned resource requires consistent ownership/policy/RLS semantics.

**Completion proof:** public contract/implementation diff, risk review, named tests, migration/compatibility impact, immutable PR+CI evidence and sign-off.


## Deliverables

- packages/schema-engine, resource-contracts, migration-planner and postgres adapter
- Resource DSL specification with migration safety rules
- CRM schema fixture for customers/deals/activities

## Required acceptance gates

- [ ] CRM schema compiles to real relations, constraints and versioned migrations.
- [ ] Additive migration and backfill retain live fixture records; unsafe destructive changes require approval.
- [ ] Resource introspection does not leak forbidden fields or tenant data.
- [ ] A new domain resource is independent from Publication and Posts.

## Known risks and non-goals

- Automatic rename inference can silently destroy data; never assume equivalence.
- Complex financial/order records should preserve strong relational constraints.

## Execution and PR slicing

1. ADR and contract design with explicit back-compat and tenant/security boundaries.
2. Small working vertical slice using tests-first where feasible; no general framework rewrite.
3. Feature-specific implementation behind safe defaults and migration/rollout controls.
4. Postgres/contract/integration/security/E2E/external consumer tests as appropriate.
5. Review logs, recovery/restore runbooks, docs and independent exit acceptance.

## Migration trust and executable schema guarantees

**Roadmap review correction:** These items were identified in [PR #151 findings](../REVIEW-FINDINGS-2026-11-14.md). They are **proposed implementation and acceptance work**, not completed runtime remediation. Relevant cross-cutting contracts: [ADR gates](../ARCHITECTURE-DECISION-GATES.md), [tenant/DB authority](../DATA-ISOLATION-AND-MIGRATIONS.md), [v1 scope](../V1-SCOPE-AND-RELEASE-CRITERIA.md).

### M03-E08 — DDL trust boundary and namespace reservation

Validate canonical resource IR and identifiers; reserve namespaces per app/module; reject raw untrusted SQL, unsafe expressions and cross-app models. Run generated DDL only through a separate installer with approval.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### M03-E09 — Migration drift, concurrency and compatibility

Record checksums; verify live DB drift; lock concurrent migrations; apply lock/statement budgets; preview data backfill; define expand-contract windows and operator-approved forward-fix after irreversible changes.

**Evidence:** immutable implementation PR SHA, relevant negative/contract/migration tests, version fixtures, operator/maintainer review and deployment runbook where applicable.

### Additional milestone exit criteria (blocking)

- [ ] A malicious or malformed resource definition cannot cause arbitrary DDL, privilege escalation, unsafe default expression or another app's table alteration.
- [ ] Concurrent schema updates, drifted migration checksums and interrupted backfills fail safely with a recoverable operator plan.
- [ ] Dynamic resource and physical table strategies explicitly document tenant/security limits and migration tradeoffs.

**Implementation constraint:** An API user, visual editor or AI agent must never obtain DDL privileges simply by submitting a model descriptor.

## Second-pass quality and execution corrections (R17–R25)

The [independent second review and **8.0/10 roadmap-quality score**](../SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) identify planning gaps. This **does not certify code**; proposed constraints must be implemented and demonstrated. Relevant additional design contracts: [general application runtime](../APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and [data lifecycle](../DATA-LIFECYCLE-AND-OPERATIONS.md).

### M03-E10 — Topology-aware identity and schema compatibility

Select per-installation physical schema ownership and tenant discriminators; add application_id only where justified by physical deployment. Define deterministic resource migration and stable event/schema compatibility contracts.

**Evidence required:** code/ADR SHA, negative or contract test, runnable clean consumer where appropriate, owner and actual CI/restore result.

**Local progress (2026-11-19):** `compilePortableProvisioningIdentity` is profile-generic; the C05/J03 integration test now proves the typed `DEDICATED_PG16_TYPED_V2` content/migration digests are installation-neutral across two real dedicated installs and that the V1→V2 transition parent digest matches the V1 content digest, then installs the typed additive (optional date/integer/decimal) columns on both databases and verifies the exact physical digest. CORE V1 digest bytes remain frozen by `historical-v1-digests.test.ts`. Additive money columns still require review because their currency companion carries a CHECK; that refusal is preserved, not relaxed.
### Additional blocking exit checks

- [ ] Physical keys and scoped foreign keys match the approved per-installation topology, with tests of tenant isolation independent of unnecessary app_id duplication.
- [ ] Schema-version and migration-manifest checksums are stable across clean app installs and staged upgrades.

**Scope note:** Avoid forcing both app_id and tenant_id into every table without considering physical DB-per-application architecture.

## Third-pass security and feasibility acceptance (R26–R34)

The [third-pass review, R26–R34, and 8.0/10 **roadmap-only** rating](../THIRD-REVIEW-AND-RATING-2026-11-14.md) refine the conditions for this milestone. These are proposed future tasks, **not actual runtime remediation**. Supporting contracts: [PostgreSQL effective ACL and RLS](../POSTGRES-PRIVILEGE-AND-RLS-THREAT-MODEL.md), [app installation trust](../APP-INSTALLATION-TRUST-AND-OPERATIONS.md), [rolling compatibility](../UPGRADE-COMPATIBILITY-AND-DEPLOYMENT.md).

### M03-E11 — Mixed-version schema compiler and backfill compatibility

Design old/new API and worker compatible expand/backfill/contract migrations, registry and migration-plan digests, concurrent installer fencing and failure recovery.

**Required proof:** immutable implementation SHA, actual test (negative/compatibility/restore/clean consumer as applicable), environment/fixture and reviewer sign-off.

### Blocking exit checks

- [ ] Generated schema changes are tested against old and new API/worker and rollback/forward-fix fixtures with seeded rows and in-flight jobs.
- [ ] Safe installer stops on schema drift, concurrent operation or incompatible backfill and documents observed recovery rather than claiming automatic lossless downgrade.

**No certification by documentation:** an ADR approval or completed checklist does not verify production deployment or actual SQL permissions.

## Fourth-pass acceptance: safe schema outputs and legacy backfill

Apply these requirements to existing **M03-E04/E08/E09**. See [RLS/views](../RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md) and [CMS identity migration](../LEGACY-CMS-IDENTITY-AND-MIGRATION.md).

- [ ] The schema compiler rejects unapproved tenant-owned SQL views/materialized models by default. If supported, schema metadata carries verified view owner/invoker context, supported PG version and test fixtures.
- [ ] CMS publication-to-application mapping/backfill is additive, idempotent, validated with content/relations and has a forward-fix/restore runbook.
- [ ] Old/new API/worker compatibility and database migration evidence reconcile record counts and ownership under actual runtime permissions.

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

## Execution reconciliation — 2026-11-19

This section records evidence, not normative acceptance. All original criteria above remain intact and unchecked until independently verified. [Restricted baseline owner acceptance](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-7000748887) and [independent functional rejection](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-7002259332) remain authoritative. No release or M04 runtime authorization.

- RED: unchanged rejected implementation plus harness-only commits, exact SHA `f57f4fd5eaebcaa2efa17dba6fed11106534c552`, [actual PG16 job](https://github.com/AbdullahZaher/vibress/actions/runs/44480424600/job/135411037280): four accepted drift cases, four restored positive controls, six prior tests passed, two physical-only skipped.
- GREEN: `85c8d049e2d759d21901bbe06609a5cfbb7333d5`, [actual PG16 job](https://github.com/AbdullahZaher/vibress/actions/runs/44481211707/job/135413605637): 12 passing test definitions, two physical-only skipped. 19 ACL and 13 semantic drift scenarios rejected and restored. Protected ACL V1 and catalog semantic verification V1 do not change historical signed digests.
- Follow-on: `bb86e686ffc84e3c6842d515a9c61b71004620e2`, [actual functional job](https://github.com/AbdullahZaher/vibress/actions/runs/44481592914/job/135414872976): 12 passing, two physical-only skipped. Signed producer, persisted membership and payload-bound effect identity tested; protected runtime business admission verified. No distributed recovery fencing claimed.
- New internal metadata projection commit `110adf738d726819a1f5aeaab1f4645769672230` is implementation evidence only until exact-SHA CI. No public generated endpoint.
- Local worktree `experiment/m03-remaining-functional-exec-20261119` (from baseline `96442be5a1b02d3fbe922e082344f49f4fa854b0`, uncommitted): physical contract profile V2 adds exact `integer`, `numeric(p,s)` decimal/money (with `_currency` companion), `date`, bounded `jsonb`, bounded `text`, `media` (object with non-null string `url`) and `localized` (object map) columns with deterministic CHECK constraints. CORE V1 manifests keep profile V1 and byte-identical shape/digests. Evidence: schema-engine unit suite 61/61, including manifest/profile/CHECK/transition/refusal assertions; disposable-PG16 normative suite 16 passed, 2 physical-only skipped, with a new A01 case on real PostgreSQL asserting exact `format_type`/`pg_get_constraintdef`, valid persistence, tenant isolation, refusal of invalid currency/JSON/media/localized/text/date/numeric values, CHECK-drop drift refusal and supported additive evolution. No CI run, commit SHA, peer review or push exists for this work, so all Epic statuses below remain unchanged.
- B01 local checkpoint (same worktree, uncommitted at time of writing): persistent revision lifecycle `platform_schema_revision_states_v1` plus append-only `platform_schema_state_transitions_v1` (BEFORE UPDATE/DELETE trigger raises `M03_LIFECYCLE_HISTORY_IMMUTABLE`). Transitions are CAS on `(installation_id, revision_digest, state, state_version)` with authenticated operation/approval/epoch/head/sequence evidence. The installer refuses any revision without an operator `APPROVED` state, records `PROVISIONING` and `DB_COMMITTED` inside its DDL transaction, and records global `ACTIVE` admission plus parent `SUPERSEDED` only after COMMIT; a crash between COMMIT and ACTIVE therefore remains observable as `DB_COMMITTED`. Verified by a new optional-additive B01 case on disposable PG16: illegal/stale/epoch transitions refused, exactly one concurrent CAS winner, unapproved revision refused by the installer, six-step history, real parent supersession, terminal revocation, history immutability and runtime denial. Normative suite 17 passed, 2 physical-only skipped. No CI/SHA/push.

- B07 partial: the installer now accepts provisioning after a READY V2 authority only when the approval's parent is the single persisted lifecycle `ACTIVE` revision; identity, physical database, system identifier, timeline, epoch, ledger and approval head/sequence remain verified by the existing trust/approval path. Unit tests cover the binding predicate. No end-to-end READY V2 provisioning journey executed yet, and lifecycle epoch reattestation after PITR is still missing, so this is not a closed V2 admission claim.
- Normative suite after B01/B07: 17 passed, 2 physical-only skipped; V2 predicate 4/4. The installer now also enforces exactly one ACTIVE lifecycle row, equal to the registry head, so an orphan or forged ACTIVE revision blocks further installs (negative case executed).
- A03 historical digest preservation: a fixed CORE V1 manifest (single `invoices` resource, `text`/`boolean`/`datetime` fields) was compiled independently against baseline `96442be5a1b02d3fbe922e082344f49f4fa854b0` (extracted via `git archive`) and against current sources. Manifest, canonical IR, provisioning contract and portable identity digests were byte-identical; the four values are frozen in `packages/schema-engine/src/__tests__/historical-v1-digests.test.ts`. This is a local characterization fixture, not an independent certification.
- B02 local checkpoint: `reattestExperimentalLifecycleAfterRecovery` reattests an `ACTIVE` revision in one transaction — `ACTIVE → RECOVERY_PENDING` retains the pre-recovery epoch, `REATTESTED → ACTIVE` binds the replacement epoch, so the append-only history keeps every epoch. A new epoch or sequence may never rewind; an epoch already present in history cannot be replayed; non-`ACTIVE` revisions and the runtime role are refused. Verified on disposable PG16 with two successive recovery epochs (combined 12-entry history), epoch replay, sequence regression, unknown revision and runtime denial. Physical PITR still cannot be executed locally; this exercises the lifecycle mechanics only.
- B04 local checkpoint: durable per-target backfill ledger `platform_schema_backfill_targets_v1` admits exactly one value per `(installation, revision, tenant, resource, column)`, increments `chunks`/`affected_total` in the same transaction as the bounded row fill, marks the target `complete` when a chunk observes zero remaining rows, and never reopens it. A BEFORE UPDATE/DELETE trigger raises `M03_BACKFILL_TARGET_IMMUTABLE`; the runtime role has no access. Replaying a committed operation returns `ALREADY_COMMITTED` without double-counting progress; conflicting values are refused (`CONFLICT`) and completed targets refuse new chunks (`COMPLETE`). Verified on disposable PG16 including a concurrent conflicting pair, replay, completion, trigger refusal and runtime denial. This remains atomic DB checkpoints plus a durable target ledger, not independent PITR durability of backfill outcomes.
- B03 local checkpoint: `settleExperimentalDomains` is a read-only, repeatable-read settlement across three durable domains. It refuses registry-head/ACTIVE-revision disagreement, backfill chunks without admitted targets or inconsistent chunk/progress totals, witnesses unknown to the authority, and COMMITTED/ROLLED_BACK witness-count disagreements; it returns a deterministic sha256 over the canonical settlement summary, so repeated calls on unchanged evidence are byte-identical. Witness signatures are verified by the recovery authority (epoch key) during recovery; settlement binds evidence text to the authority-admitted record rather than claiming key custody. Verified on disposable PG16 with a real provisioning + backfill + signed business commit, idempotent repeat, forged chunk, forged witness, registry tamper and runtime denial. Uncertain outcomes are still resolved by the existing single-domain recovery APIs, not by settlement.
- A02 local checkpoint: the versioned leaf adapter now issues opaque pagination cursors bound to the manifest revision and ordering, supports keyset traversal ordered by `id` or `(code,id)`, and refuses cursors from a different revision/order, forged/tampered cursors and legacy bare-UUID cursors. Verified on disposable PG16 alongside version CAS, scoped uniqueness, soft deletion and tombstone retention. The adapter still supports only the documented six-column leaf with exact-code filtering.
- C05 local checkpoint: the typed `DEDICATED_PG16_TYPED_V2` portable content/migration identity is installation-neutral across two real dedicated installs, the V1→V2 transition parent digest equals the V1 content digest, and additive optional `date`/`integer`/`decimal` columns install on both databases with the exact physical digest. Additive `money` still requires review because its currency companion carries a CHECK; that evolution gate is preserved.
- C03 local checkpoint: legacy CMS mutations write their outbox row through the existing `DrizzleOutboxRepository` inside the same transaction as the content row (`runInTransaction`, not a nested uninstrumented `db.transaction`), so a forced outbox-insert failure rolls the model creation back with no orphan row. Event ids are deterministic per logical occurrence and repository inserts dedupe on replay (`ON CONFLICT (id) DO NOTHING`), which is insert-idempotency only — no exactly-once delivery claim. Verified on disposable PostgreSQL with the CMS service suite and the outbox suite (atomic commit, rollback, replay dedupe).

| Epic | Evidence / status | Remaining mandatory limitation |
| --- | --- | --- |
| E01 | TESTED_RESTRICTED — exact integer/decimal/money, date, bounded JSON/text, media and localized columns verified on real PostgreSQL; CORE V1 digests unchanged | Studio document schema validation beyond bounded JSON; richer types outside the declared list; product-level localization/media semantics |
| E02 | TESTED_RESTRICTED — persistent 12-state revision lifecycle with CAS, immutable transition history, installer admission, parent supersession and successive recovery-epoch reattestation at the lifecycle level; DB_COMMITTED is distinct from globally ACTIVE | lifecycle reattestation driven by an executed physical PITR restore, revocation propagation to running workers, lifecycle-to-drift reconciliation |
| E03 | TESTED_RESTRICTED — scoped PK/UQ/FK and indexes; version CAS, soft deletion, revision-bound keyset cursors over `id` and `(code,id)` | generalized constraints, concurrency tokens beyond the leaf adapter, later-data backfill behaviour |
| E04 | TESTED_RESTRICTED — semantic catalog V1 and compiler | wider outputs/types; partition and trigger-link negative cases |
| E05 | TESTED_RESTRICTED — typed physical storage incl. exact numeric/date/jsonb and CHECK constraints | bounded per-tenant dynamic storage implementation |
| E06 | TESTED_RESTRICTED — optional additive field and signed bounded backfill with durable per-target admission, forward-only progress and terminal completion; no reopening or clearing | re-running a completed backfill after later data growth, independent PITR durability of backfill outcomes, explicit rename and forward-fix |
| E07 | TESTED_RESTRICTED — RLS and exact ACL drift tests; introspection implementation pending new CI | distributed admission and full introspection verification |
| E08 | TESTED_RESTRICTED — isolated installer, namespace, authority checks | module namespace and complete root-trust operational proof |
| E09 | TESTED_RESTRICTED — drift and actual recovery cases; read-only idempotent cross-domain settlement of provisioning, backfill and business evidence with contradiction refusal | split-write reconciliation, unsettled installer/backfill/business outcomes via settlement |
| E10 | TESTED_RESTRICTED — independent CRM/Inventory | portable checksums across topology, real legacy mapping/backfill |
| E11 | TESTED_RESTRICTED — four real artifacts, signed jobs and payload binding; V2 admission predicate binds the ACTIVE parent revision (unit tested only); legacy CMS mutations and their outbox rows commit atomically with deterministic-event-id replay dedupe | authenticated READY V2 provisioning journey, lifecycle epoch reattestation, in-flight compatibility, actual recovery resume |

No Epic is marked FUNCTIONALLY_COMPLETE. Exact final CI, independent Agent 06 verdict, and external governance remain required. No risk acceptance.

## Program links

[Master roadmap](../README.md) · [Security gates](../SECURITY-AND-RELEASE-GATES.md) · [Governance](../DELIVERY-GOVERNANCE.md) · [Existing work](../EXISTING-ASSETS.md)
