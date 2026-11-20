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
| Accountable owner | Agent 01 — Principal Software Architect / Engineering Director / Engineering Integration Lead (local execution only); Agent 06 independent certification OPEN |
| ADR / public contract | TBD |
| Immutable implementation commit SHA | Final branch HEAD at handoff; exact SHA/tree, preserved commits and CI run IDs are recorded in the consolidated M03 handoff report. Earlier activation point: `7574067236a35650e16eaabe1ff281dfa86d9bb0` (tree `a8962ebf9fb3efe723ce882008afb43492f7ece9`) |
| CI checks and test fixtures | Dedicated M03 push run `44809868253` (all 4 physical + 4 normative-physical + normative-functional scenarios green at the activation SHA); full repository CI push run `44809868247`; successor-SHA results recorded in the consolidated report |
| Security/tenancy and migration evidence | Full integration 834 passed / 14 CI-gated skips; role-atomic 19/19; schema-engine 92/92; fresh replay 61 migrations / 111 public tables; production dependency audit clean; development advisory dispositioned below |
| Deployment/restore evidence | Dedicated owned-PG16 PITR/rewind matrix passed in CI; no deployment performed and no production-grade durability claimed |
| Independent reviewer and decision | **OPEN — not certified (Agent 06; FUNC-01/FUNC-02 remain independently unresolved)** |

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
- B03 local checkpoint: `settleExperimentalDomains` is a read-only, repeatable-read settlement across three durable domains. It refuses registry-head/ACTIVE-revision disagreement, backfill chunks without admitted targets or inconsistent chunk/progress totals, witnesses unknown to the authority, and COMMITTED/ROLLED_BACK witness-count disagreements; it returns a deterministic sha256 over the canonical settlement summary, so repeated calls on unchanged evidence are byte-identical. Witness signatures are verified by the recovery authority (epoch key) during recovery; settlement binds evidence text to the authority-admitted record rather than claiming key custody. Verified on disposable PG16 with a real provisioning + backfill + signed business commit, idempotent repeat, forged chunk, forged witness, registry tamper and runtime denial. `inspectExperimentalOperations` classifies every durable provisioning/business operation with its installation/database/epoch/revision provenance, and `continueExperimentalOperation` settles an interrupted `UNCERTAIN` operation through the existing operation-specific signed evidence authorities: the caller must supply the exact quiescent-database observation and its administration signature, the authority re-observes live state around the signed head, unknown/in-flight/forged/unsigned requests raise `M03_CONTINUATION_REFUSED`, terminal operations replay as read-only `ALREADY_SETTLED`, and the result is durable across an authority restart. Continuation never re-admits, repairs by inference, advances lifecycle state or bypasses administration; activation remains a separate operator step.
- A01 trusted-write checkpoint: `enforceBoundedJson` is the mandatory pre-SQL guard for bounded JSON (`json`/`media`/`localized`): it measures the serialized UTF-8 bytes and deepest container depth, sums total object keys, refuses values that JSON cannot represent faithfully (undefined/functions/bigints/NaN/Infinity/Date/Map/class instances/cycles/array holes/accessors/enumerable symbol keys) and refuses invalid bound configuration. `validateMoney` requires both the exact amount and an ISO-4217 member currency, refuses one-sided nullability, exponent/separator/padding forms, fractional digits beyond `scale` (PostgreSQL would round them) and integer digits beyond `precision - scale`. `JSON_BOUND_ENFORCEMENT` and `MONEY_ENFORCEMENT` state the boundary explicitly: PostgreSQL CHECK enforces JSON storage bytes and currency shape, the numeric type enforces exactness/overflow, while JSON depth/keys, fractional exactness, pair nullability and currency membership are application-enforced because no privileged validation routine is approved. Verified by 10 new schema-engine tests (77/77 package-wide); no trusted M03 write path currently accepts JSON or money values (the leaf adapter and backfill remain text-only), so this is the executable guard for those writers, not a claim of database-level depth/key enforcement.
- A02 local checkpoint: the versioned leaf adapter now issues opaque pagination cursors bound to the manifest revision and ordering, supports keyset traversal ordered by `id` or `(code,id)`, and refuses cursors from a different revision/order, forged/tampered cursors and legacy bare-UUID cursors. Verified on disposable PG16 alongside version CAS, scoped uniqueness, soft deletion and tombstone retention. Beyond the six fixed columns, up to twelve additional optional exact scalar fields (`text` with optional `maxLength`, `boolean`, `datetime`) are persisted and returned; values are normalized by declared type, `null` clears a field, partial updates touch only supplied keys, unknown/unknown-typed values are refused, and all reads/writes remain tenant-scoped. Verified on disposable PG16 including type refusals (wrong type, over-length text, malformed datetime, embedded NUL), partial update preservation, null clearing, cross-tenant invisibility and stale-token refusal. Declared relations to same-ownership resources are persisted with the compiler-generated composite `(tenant_id, id)` foreign key: required relations refuse omission or clearing, optional relations may be omitted or cleared, and a target from another tenant is refused by PostgreSQL (`23503`). Verified on disposable PG16 including required/optional persistence, repointing, clearing, malformed values and cross-tenant refusal. Compound indexes and non-scalar field types beyond relations remain unimplemented.
- C05 local checkpoint: the typed `DEDICATED_PG16_TYPED_V2` portable content/migration identity is installation-neutral across two real dedicated installs, the V1→V2 transition parent digest equals the V1 content digest, and additive optional `date`/`integer`/`decimal` columns install on both databases with the exact physical digest. Additive `money` still requires review because its currency companion carries a CHECK; that evolution gate is preserved.
- C03 local checkpoint: legacy CMS mutations write their outbox row through the existing `DrizzleOutboxRepository` inside the same transaction as the content row (`runInTransaction`, not a nested uninstrumented `db.transaction`), so a forced outbox-insert failure rolls the model creation back with no orphan row. Event ids are deterministic per logical occurrence and repository inserts dedupe on replay (`ON CONFLICT (id) DO NOTHING`), which is insert-idempotency only — no exactly-once delivery claim. Verified on disposable PostgreSQL with the CMS service suite and the outbox suite (atomic commit, rollback, replay dedupe).
- B05 local checkpoint: `compileRenameIntent(current, proposed, intent, scope)` emits a pure, versioned `M03_RENAME_INTENT_V1` artifact only when the caller supplies an explicit rename intent; renames are never inferred from schema drift. It refuses a missing/empty rationale, missing/same-name/unknown/colliding columns, a required destination, a type change, unrelated drift, a missing current revision and a scope mismatch (`RENAME_INTENT_REFUSED`). The artifact declares `authorization: "NONE"`, `destructive: false`, an EXPAND statement rendered for installer review, a `SIGNED_BOUNDED_BACKFILL_REQUIRED` backfill phase, a NULL-count VALIDATE predicate and a deliberately non-executable CONTRACT phase, so the destructive drop is never part of the artifact; the digest is deterministic over the canonical body. Verified by five schema-engine unit tests (67/67 package-wide); the frozen provisioning operator and its evolution gates are unchanged.
- B06 local checkpoint: `moduleNamespaceName` derives `v3_mod_<24 hex>` exclusively from the verified application, installation and module identity and refuses reserved database names (`public`, `information_schema`, `pg_*`), platform/core prefixes (`v3_`, `platform_`, `vibress_`) and malformed module ids. `reserveExperimentalModuleNamespace` re-verifies the single non-revoked installation trust row (application, installation, database, OID and the already-reserved core namespace), then atomically inserts the immutable reservation row, creates the installer-owned schema with runtime `USAGE` only, and verifies the catalog (zero objects, zero default ACLs, no privileged functions). Replay verifies instead of duplicating (`ALREADY_RESERVED`); forged reservation rows and stolen derived namespaces are refused (`MISMATCH`/`COLLISION`); a pre-existing foreign schema rolls the whole transaction back with no reservation row. Verified on disposable PG16 with a real dedicated installation and a real runtime role. The reservation binds identity, not a resource revision, and no root-trust operational proof is claimed.
- Final local checkpoint 2026-11-19 (branch `experiment/m03-remaining-functional-exec-20261119`, twenty local commits from baseline `96442be5`, all thirteen protected commits preserved): normative suite 24 passed / 2 physical-only skipped on Node 24.22.3 against disposable PG 16.16 on 127.0.0.1:5434 with `M03_FAULT_UPSTREAM_PORT=5434`; full `tests/integration` suite 646 passed, 0 failed, 186 skipped across 51 files, plus two suites (`platform-schema-migration-operator`, `platform-schema-migration-fault-injection`) refusing at setup by their deliberate 5433-only disposable-fixture guard — the local 5434 cluster is not admitted and the guard was not bypassed. Fresh-database historical replay on the disposable cluster applied 60 migrations and created 109 public tables before the scratch database was dropped. Schema-engine 77/77; READY V2 admission predicate 4/4; CMS + outbox suites 21/21; content-modeler 82/82. Workspace typecheck 75/75 projects; root lint exit 0; explicit-any 193/220. Platform-reference browser E2E 8/8. The main `tests/e2e` browser suite is BLOCKED, not passed: its `pnpm dev` webServer aborted because the reference app refuses an inherited `DATABASE_URL` ("must not receive DATABASE_URL; run the provisioning executable separately"), so admin on port 7777 was never served; the run reported 14 passed, 156 failed (all connection-refused to 7777) and 47 not run, and none of it counts as M03 evidence. Full `pnpm test:unit` discovery without suppression on Node 24.22.3 against PG 5434: 2746 passed, 7 skipped, 1 failed — `real-plugin-execution.test.ts` Test H (quarantine after three crashes inside a 30 s window), which passes 43/43 when rerun alone; it is classified as timing-sensitive under suite-wide CPU contention and is not counted as passing in the full run. Dependency audit reports one high and two moderate advisories, all in the dev-only Nx toolchain (`nx` 23.1.1, patched >=23.2.1; minimatch via the same tooling); no runtime dependency advisory, and the toolchain upgrade is deferred to a separately authorized change. Unchanged local blockers: A01 JSON `maxDepth`/`maxKeys` are application-enforced (no privileged validation routine is approved); A02 supports optional scalars and required/optional relations but not compound indexes or non-scalar types beyond relations; A04 bounded per-tenant dynamic storage has no executable contract; B05 covers explicit non-destructive rename preparation only; B07/C02 need an executed physical PITR restore for an epoch-2 READY V2 authority; C01 legacy CMS mapping and C04 rolling-deploy verification are not exercised end to end (J08 covers real mixed-version artifacts and worker downgrade refusal only). No push, CI run, independent review or release authorization exists for these local commits.

| Epic | Evidence / status | Remaining mandatory limitation |
| --- | --- | --- |
| E01 | TESTED_RESTRICTED — exact integer/decimal/money, date, bounded JSON/text, media and localized columns verified on real PostgreSQL; CORE V1 digests unchanged; trusted-write guards enforce JSON depth/keys, JSON byte bounds, money ISO-4217 membership, fractional exactness and two-sided nullability with an explicit application-vs-PostgreSQL enforcement boundary | no trusted M03 write path accepts JSON/money yet; Studio document schema validation beyond bounded JSON; richer types outside the declared list; product-level localization/media semantics |
| E02 | TESTED_RESTRICTED — persistent 12-state revision lifecycle with CAS, immutable transition history, installer admission, parent supersession and successive recovery-epoch reattestation at the lifecycle level; DB_COMMITTED is distinct from globally ACTIVE | lifecycle reattestation driven by an executed physical PITR restore, revocation propagation to running workers, lifecycle-to-drift reconciliation |
| E03 | TESTED_RESTRICTED — scoped PK/UQ/FK and indexes; version CAS, soft deletion, revision-bound keyset cursors over `id` and `(code,id)`; up to twelve optional scalar (`text`/`boolean`/`datetime`) fields with type normalization, partial update and null clearing; required/optional relations with composite tenant-scoped foreign keys | compound indexes, non-scalar field types beyond relations, generalized constraints beyond the leaf adapter, later-data backfill behaviour |
| E04 | TESTED_RESTRICTED — semantic catalog V1 and compiler | wider outputs/types; partition and trigger-link negative cases |
| E05 | TESTED_RESTRICTED — typed physical storage incl. exact numeric/date/jsonb and CHECK constraints | bounded per-tenant dynamic storage implementation |
| E06 | TESTED_RESTRICTED — optional additive field and signed bounded backfill with durable per-target admission, forward-only progress and terminal completion; explicit rename intent compiles to non-executable expand/backfill/validate phases with a deterministic digest and refuses inference | reviewing and executing the contract/drop phase after operator approval, re-running a completed backfill after later data growth, independent PITR durability of backfill outcomes |
| E07 | TESTED_RESTRICTED — RLS and exact ACL drift tests; introspection implementation pending new CI | distributed admission and full introspection verification |
| E08 | TESTED_RESTRICTED — isolated installer, namespace, authority checks; deterministic module namespace reservation with installation binding, atomic immutable persistence, collision/forged-row refusal and exact catalog verification | complete root-trust operational proof, module-to-revision resource binding |
| E09 | TESTED_RESTRICTED — drift and actual recovery cases; read-only idempotent cross-domain settlement of provisioning, backfill and business evidence with contradiction refusal; authenticated continuation of interrupted operations with provenance, exact signed evidence, idempotent restart continuity and safe refusal | split-write reconciliation, unsettled installer/backfill/business outcomes after non-quiescent or externally repaired state |
| E10 | TESTED_RESTRICTED — independent CRM/Inventory | portable checksums across topology, real legacy mapping/backfill |
| E11 | TESTED_RESTRICTED — four real artifacts, signed jobs and payload binding; V2 admission predicate binds the ACTIVE parent revision (unit tested only); legacy CMS mutations and their outbox rows commit atomically with deterministic-event-id replay dedupe | authenticated READY V2 provisioning journey, lifecycle epoch reattestation, in-flight compatibility, actual recovery resume |

No Epic is marked FUNCTIONALLY_COMPLETE. Exact final CI, independent Agent 06 verdict, and external governance remain required. No risk acceptance.


## Final integrated reconciliation — 2026-11-20 (supersedes stale execution statuses above)

This section supersedes only the *execution statuses* recorded in the earlier local checkpoints above; the original acceptance criteria, historical RED/GREEN evidence and all preserved commits remain intact. No epic is independently accepted. Status vocabulary: **IMPLEMENTED** (code exists), **LOCAL_TESTED** (executed on the owned disposable topology), **CI_VERIFIED** (executed on the exact candidate SHA by push-triggered GitHub Actions), **TESTED_RESTRICTED** (fixture-bound evidence with an explicit residual), **INDEPENDENT_REVIEW_PENDING**, **BLOCKED_BY_POLICY**, **BLOCKED_BY_INFRASTRUCTURE**.

### Work packages A/B/C

| Package | Status | Evidence and residual |
| --- | --- | --- |
| A01 | TESTED_RESTRICTED / INDEPENDENT_REVIEW_PENDING | Money and bounded JSON on create/update/CAS/signed backfill, media ownership, localized fallback and Studio document limits on real PG16. JSON depth/key budgets, fractional exactness, pair nullability and currency membership remain application-enforced; no privileged validation routine is approved. |
| A02 | TESTED_RESTRICTED | Version CAS, soft deletion, declared scoped uniques, compound index ordering, bounded cursors, relation-aware writes and optional scalars. Compound index *evolution* and non-scalar types beyond relations are not supported. |
| A03 | TESTED_RESTRICTED | Frozen CORE V1 digests unchanged; manifest/IR/provisioning/physical identity deterministic; rename intent is a pure signed artifact. Destructive CONTRACT execution is BLOCKED_BY_POLICY pending operator approval. |
| A04 | TESTED_RESTRICTED | Real PG16 profile-revision binding, create/update CAS, soft delete, keyset pagination, per-tenant budget and query refusal. No payload filtering/ordering indexes; in-place profile evolution refused. |
| B01 | TESTED_RESTRICTED / CI_VERIFIED (physical matrix) | Persistent lifecycle CAS, immutable history, installer admission, `DB_COMMITTED` vs `ACTIVE`, concurrency, supersession; normative physical CI matrix passes preserved/rewound revisions and data. |
| B02 | TESTED_RESTRICTED | Successive recovery epochs reattest the single `ACTIVE` revision atomically with combined append-only history; epoch/sequence replay is refused. True physical epoch-2 driver is CI-only. |
| B03 | TESTED_RESTRICTED | Repeatable-read cross-domain settlement with contradiction refusal; authenticated continuation for PROVISIONING and BUSINESS operations across authority restart. Backfill is not an admitted continuation kind. |
| B04 | TESTED_RESTRICTED | Durable target/chunk ledger, conflict/completion/replay refusal, plus a real wire-level COMMIT-ACK loss test showing exactly one progress record, pending authority, restart continuity and safe replay refusal. Backfill-specific authenticated continuation is BLOCKED_BY_POLICY (kind unsupported); no independent PITR durability claim. |
| B05 | IMPLEMENTED / BLOCKED_BY_POLICY | Explicit rename intent, signed bounded backfill and VALIDATE phases execute; CONTRACT/drop remains deliberately non-executable pending operator approval. |
| B06 | TESTED_RESTRICTED | Deterministic immutable module namespace reservation with installation binding, catalog verification, collision/forged-row refusal, plus a new post-reservation catalog-drift fail-closed test. Provisioning generated resources *inside* a module namespace is not implemented: the verifier requires zero objects, so module-to-revision resource binding remains a documented limitation. |
| B07 | TESTED_RESTRICTED / BLOCKED_BY_INFRASTRUCTURE | Dedicated physical CI exercises READY_V2 scoped advance/activation and a fresh signed operation under V2; the parent-ACTIVE installer predicate is unit-tested. A generic authenticated principal+tenant V2 transaction fence for the reference API/worker is not available in the existing authority contracts and was not invented. |
| C01 | TESTED | Additive migration 0061, publication identity preservation, idempotent operator-only mapping, digest/drift refusal and reconnect continuity on real PG16. Canonical adoption requires an ADR for append-only/update semantics, rebind/forward-fix policy, a TRUNCATE defense decision and C01-specific dump/restore evidence. |
| C02 | TESTED_RESTRICTED | Persisted membership revocation closes reference API and worker admission in both artifact versions; physical recovery-admission journey remains CI-gated. |
| C03 | TESTED | Mutation + outbox event commit atomically, stable scoped event ids, retry, stale-claim reclaim, consumer dedupe and replay. At-least-once semantics only; no exactly-once claim. |
| C04 | TESTED_RESTRICTED | Real V1/V2 API and worker binaries, queued V1 job consumed by V2 worker across live expansion, worker restart compatibility, and a new real failed-attempt/retry assertion with exactly one effect. No production rolling deployment; no V1/V2 outbox dispatcher artifacts. |
| C05 | TESTED | Installation-neutral portable typed-V2 identity across two real dedicated installs; V1→V2 transition parent matches V1 digest. |

### Journeys J01–J08

| Journey | Status |
| --- | --- |
| J01 / J02 | CI_VERIFIED / TESTED_RESTRICTED — signed CRM, exact catalog, scoped relations, RLS, CAS and cursors on real PG16. |
| J03 | TESTED — independent installation isolation and portable identity across dedicated installs. |
| J04 | TESTED_RESTRICTED — additive expansion, competing CAS, drift, lock refusal, immutable history. |
| J05 | TESTED_RESTRICTED — lost COMMIT acknowledgment, durable unknown, authenticated exact committed evidence. |
| J06 | CI_VERIFIED (dedicated physical matrix) — preserved/rewound physical revisions, data, and signed business witnesses; no production durability claim. |
| J07 | TESTED_RESTRICTED — bounded signed business commit/rollback and lost acknowledgments. |
| J08 | TESTED_RESTRICTED — genuinely different API/worker artifacts, signed jobs, old queued jobs, live expansion, retry and worker restart; rolling deployment not performed. |

### Epic status matrix

| Epic | Status | Limitation |
| --- | --- | --- |
| E01 | TESTED_RESTRICTED | Application-vs-PostgreSQL enforcement boundary; no trusted JSON/money write path yet. |
| E02 | CI_VERIFIED (mechanics) / INDEPENDENT_REVIEW_PENDING | Physical epoch-2 lifecycle reattestation is CI-only; revocation propagation to running workers is not claimed. |
| E03 | TESTED_RESTRICTED | No compound index evolution or generalized constraints beyond the leaf adapter. |
| E04 | TESTED_RESTRICTED | Wider outputs/types and partition/trigger-link negatives not claimed. |
| E05 | TESTED_RESTRICTED | A04 is bounded dynamic storage, not a generalized storage engine. |
| E06 | TESTED_RESTRICTED / BLOCKED_BY_POLICY | Rename CONTRACT/drop non-executable; no independent PITR durability for backfill outcomes. |
| E07 | TESTED_RESTRICTED | Distributed admission and full introspection verification outstanding. |
| E08 | TESTED_RESTRICTED | Module-to-revision resource binding and root-trust operational proof outstanding. |
| E09 | TESTED_RESTRICTED | Non-quiescent or externally repaired split-write reconciliation and backfill continuation unsupported. |
| E10 | TESTED_RESTRICTED | Real legacy mapping executed, but canonical migration adoption needs the 0061 policy ADR. |
| E11 | TESTED_RESTRICTED / INDEPENDENT_REVIEW_PENDING | READY V2 physical admission is partially evidenced; generic V2 reference transaction fence and actual recovery resume of the reference paths remain unresolved. |

### Final verification and advisory disposition

- Toolchain pinned: Node `24.22.3`, pnpm `11.22.0`, owned PostgreSQL `16.16` (`160016`), disposable Redis/MinIO/Mailpit, frozen lockfile.
- Local final candidate gates: schema-engine 92/92; unit 2762 passed / 7 skipped; integration 834 passed / 14 CI-gated skips; role-atomic 19/19; typecheck 75/75; lint exit 0; explicit-any 193/220; architecture 22/22; docs links 798; migration replay 61 migrations / 111 public tables; production audit clean; Platform Reference E2E 8/8; setup wizard 5/5; container build 5/5 images; full main browser suite independently passed on the GitHub runner (PR merge-ref run `44805636631`, e2e job success). Local full-suite browser runs were contention-sensitive; individual failing specs passed in isolation and no assertion was weakened.
- The 14 integration skips are the dedicated physical/CI groups plus opt-in role fault injection; the role group was executed separately (19/19). CI state was never spoofed.
- GHSA-g3hv-75wg-m249 (minimatch, moderate, dev tooling only): affected versions `>=7 <11.0.1`; only Nx/eslint/typescript-eslint 10.x edges were pinned to the already-resolved `11.0.3`, leaving legacy `3.1.5` and production dependencies unchanged. Production audit gate remains enforced; full audit is now clean.
- Governance: risk acceptance NONE; production release NO-GO; no canonical merge, tag, deployment, DELTA-08 activation, P07-RC-C adoption, M04 Batch 03 Runtime, or destructive CONTRACT execution. Policy A, P05/R1, P06/E2-A, the immutable `ab6afcdc` target and D1 (2517 ms, restricted scope) are preserved. M remains NOT DETERMINABLE.

## Program links

[Master roadmap](../README.md) · [Security gates](../SECURITY-AND-RELEASE-GATES.md) · [Governance](../DELIVERY-GOVERNANCE.md) · [Existing work](../EXISTING-ASSETS.md)
