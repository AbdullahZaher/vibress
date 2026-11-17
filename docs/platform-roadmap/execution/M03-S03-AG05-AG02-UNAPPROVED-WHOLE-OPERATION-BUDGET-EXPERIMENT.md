# M03-S03 — Expiry Policy and Whole-Operation Deadline Enforcement Verification

**STATUS: BLOCKED — UNAPPROVED IMPLEMENTATION EXPERIMENT ONLY.**  
**Document:** M03-S03-AG05-AG02-BUDGET-EXPERIMENT-2026-11-17  
**Reviewer roles:** Agents 05 + 02 (IAM, PostgreSQL concurrency and engineering; **not** Agent 06's independent final certification).  
**Report date:** 2026-11-17.  
**Repository:** https://github.com/AbdullahZaher/vibress  
**Canonical PR:** https://github.com/AbdullahZaher/vibress/pull/198 — `b5cfc0687076c86a7450a8a785a072f6e63ad289` (OPEN/DRAFT; source UNCHANGED).  
**Source PR:** https://github.com/AbdullahZaher/vibress/pull/203 — latest independently checked `6bf94cc45babd7c73593295900d791a2f03f7a72` (OPEN/DRAFT; policy still PROPOSED).  
**Previously verified Policy A operator SHA:** `2c31ed9119b88a7aff0ae8bd4c16638294a74cda`.  
**Experimental implementation SHA:** **`eef874f69924cf25223ad1290e0cc958fa46e3e8`**; tree **`e556ab3e7188f88b50891ff75698c9d3c4a7c74b`**.  
**Audited original operator blob:** **`31b1e862f594434944fec516f768265baf794525`** — unchanged by the experiment.  
**Migration 0060 blob:** **`d8b1e50a0a4dd347fde235ae7cb1a12468249719`** — unchanged.

## 1. Mandatory prerequisite: FAIL CLOSED

Reviewed [Owner P02 proposal](https://github.com/AbdullahZaher/vibress/blob/6bf94cc45babd7c73593295900d791a2f03f7a72/docs/platform-roadmap/execution/M03-S03-APPROVAL-EXPIRY-AND-DEADLINE-DECISION.md), [Issue #197 P01 decision record](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6953244253), and [Agent01 owner review](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6954866770). All explicitly say **Policy A/B NOT APPROVED**, **whole-operation numerical deadline NOT APPROVED**, and required named accountable owner/IAM/DBA signoffs NOT VERIFIED. [Agent06 review #5942420824](https://github.com/AbdullahZaher/vibress/pull/198#pullrequestreview-5942420824) retains REQUEST CHANGES. The owner's conditional willingness to approve after prerequisites is **not** the missing specific approval.

No duration was selected as a release default. The values **1 ms, 600 ms, 700 ms and 1200 ms** appearing in the new tests are deliberately tiny **TEST-ONLY FAULT FIXTURE THRESHOLDS**, **NOT** an owner recommendation or production time budget. An executable approved contract **cannot** be delivered without approval. Therefore the work below is a separately isolated, intentionally unapproved experiment and must **NOT** be integrated or deployed.

Agent04 independently ran large localhost-only PG16 latency benchmarks on Draft [PR #204](https://github.com/AbdullahZaher/vibress/pull/204); the evidence [Issue #197 comment #6956154868](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6956154868) explicitly concludes **NUMERIC DEADLINE NOT DETERMINABLE** without production-like RTT/TLS, SLO, cancellation/COMMIT reserve. Its separately reported normal p99 changed from ~44 ms to ~24 ms across runs. These are **not** valid inputs for an owner-approved fixed deadline. This benchmark was read as a cited contributor record, not independently reprocessed in this review.

## 2. Exact changes and compatibility

Source commit `6bf94cc45babd7c73593295900d791a2f03f7a72` → experimental `eef874f69924cf25223ad1290e0cc958fa46e3e8`: **exactly three changed paths**:

1. **ADDED** `packages/database/src/platform-schema-operation-budget-experiment.ts` — private, non-exported, test-only cumulative budget decorator with mandatory explicit input. No API/worker/plugin/runtime import or CLI integration.
2. **MODIFIED** `tests/integration/platform-schema-migration-operator.test.ts` — five additional real PostgreSQL negative tests using the existing isolated installation/author/approver/operator/runtime fixture and a separately authenticated test-admin cancellation channel.
3. **ADDED** `.github/workflows/m03-s03-experimental-deadline.yml` — an isolated-branch-only PG16 CI gate checking pinned operator/migration blobs, patched Node, lint, full TypeScript, 5 × 5 targeted real-PG repetitions and original full operator/fault test suites.

No changes to: Canonical IR v1, Manifest v1, Change Plan v1, migration 0059 or 0060, approval provenance, role grants, catalog owner/privilege inspection, SQL renderer, target locking, completed-only journal, physical schema contract, production CLI or runtime authority. The experiment is **NOT** imported through the runtime database index.

## 3. Authorization and lock ordering actually retained

**Unchanged production operator order:** `BEGIN ISOLATION LEVEL READ COMMITTED` → installation-scoped advisory transaction lock → installation registry row `FOR UPDATE` → approval-specific advisory transaction lock → authenticated approval and independent author/approver verification → target `ACCESS EXCLUSIVE` → authoritative catalog/ACL/journal/seed count prechecks → `clock_timestamp()` final exact approval check (isolated proposed Policy A) → one optional scalar ADD COLUMN without default → post-DDL checks → digest CAS → completed journal → COMMIT.

Migration 0060 approval issuer INSERT obtains registry `FOR SHARE` before shared approval advisory; the revocation trigger shares that exact approval-key lock. The operator does **not** acquire approval-row `FOR UPDATE` directly. Noncooperating DDL can invert table/registry ordering and produce a PostgreSQL deadlock; previous source-pinned independent Agent02 test detected SQLSTATE `40P01` 5/5 with fail-closed journal integrity.

The deadline decorator executes **no additional SQL statement between the final DB approval timestamp check and the DDL**. DB `clock_timestamp()` continues to govern approval expiry; monotonic process time governs only elapsed operation time. The proposed Policy A allows expiry strictly after the valid final pre-DDL decision to be nonretroactive; **this behavior has not been formally authorized**, and Policy B remains unimplemented.

## 4. Experimental cumulative budget design (NOT a production guarantee)

- `startExperimentalBudget(fixtureDurationMs)` rejects missing, nonfinite, fractional or nonpositive values and disallows `NODE_ENV=production`; it creates an immutable `process.hrtime.bigint()` start token. The test demonstrates creating that token **before opening a new database connection**. **No default** exists.
- A transparent test-only `ClientBase.query` decorator checks the **remaining cumulative budget** before every SQL dispatch, without resetting at BEGIN, registry lock, approval lock or target lock. It also measures whether each SQL response arrived after the total budget.
- A pending query crossing the test budget triggers an **external callback** to a separately connected PostgreSQL test control channel. The test control channel checks the *same exact* PID, database, role and **full microsecond-resolution `backend_start::text`** before requesting `pg_cancel_backend`; it grants the runtime role nothing.
- Merely requesting PG cancel is **not** claimed to be rollback proof. The experiment waits for the original pending SQL call to settle and for an actual acknowledged `ROLLBACK` before returning `DEADLINE_EXCEEDED`. Failure to prove cancellation/rollback or a pending COMMIT => **`INDETERMINATE`**, never fabricated success.
- After **COMMIT is SENT**, missing or late ACK is `INDETERMINATE` even if the physical DB already committed. A fresh session must reconcile journal/registry/catalog; no blind DDL replay. A late successful backend commit cannot be revoked by JavaScript timers, socket closure or a subsequent ROLLBACK.
- Original PostgreSQL `lock_timeout=2s`, `statement_timeout=10s`, `idle_in_transaction_session_timeout=15s` are preserved. They complement, but **do not dynamically consume the remaining global budget**. Out-of-band cancellation is a test-injected callback, **not** an approved deployed independent watchdog or proven production-role topology.

**Definitive limitation:** the current standalone test module is a *bounded operator experiment*, NOT the final production-ready whole-operation supervisor. It has no production CLI wiring, approved numeric policy, pre-connection secure service wrapper, dynamic PostgreSQL remaining-time GUC settings, independent production watchdog escalation/quarantine, durable independent failed-attempt audit or proven production rollback service. No hard server-side transaction or COMMIT-ACK deadline through network partition/crash can be guaranteed.

## 5. Executed exact-source evidence

**Final audit run:** [GitHub Actions #44140361447](https://github.com/AbdullahZaher/vibress/actions/runs/44140361447) **SUCCESS** for exact experimental `eef874f69924cf25223ad1290e0cc958fa46e3e8`. Runner observed **Node v24.22.3** and **real disposable PostgreSQL 16.16** (`server_version_num=160016`). `pnpm install --frozen-lockfile`, experimental-file ESLint, root `pnpm typecheck`, and plugin SDK build **PASS**.

| Executed test stage | Repeat | Outcome | Actual security assertion |
| --- | ---: | --- | --- |
| `EXP-BUDGET-01` explicit pre-connect start and already-expired budget | 5 | 5/5 PASS | No operator DDL, completed journal or seeded-row change |
| `EXP-BUDGET-02` actual PG installation advisory lock wait | 5 | 5/5 PASS | Test-supervisor cancels exact backend, ROLLBACK is acknowledged, DEADLINE_EXCEEDED |
| `EXP-BUDGET-03` actual target `ACCESS EXCLUSIVE` lock wait | 5 | 5/5 PASS | Canceled query, acknowledged ROLLBACK; no DDL, journal or row loss |
| `EXP-BUDGET-04` **server COMMIT succeeded; ACK artificially delayed** | 5 | 5/5 PASS | `INDETERMINATE` instead of false `APPLIED`; physical journal/catalog commit observed; later `ALREADY_APPLIED` |
| `EXP-BUDGET-05` after physical DDL and INSERT journal but before COMMIT | 5 | 5/5 PASS | Expiry triggers verified ROLLBACK, original manifest, no added column, no completed journal |
| Complete operator/identity/expiry suite (includes 5 new tests) | 1 | **51/51 PASS** | Original 46 cases remain successful, including Policy A test-only expiry boundary |
| Agent04 real PostgreSQL fault-injection/recovery suite | 1 | **21/21 PASS** | Backend kill, SIGKILL, TCP loss, lost wire COMMIT ACK, catalog drift, journal and replay |

**Total:** **97/97 individual test executions PASS**, consisting of 25 targeted repetitions + 51 full-operator + 21 fault tests. This is **72 distinct test definitions** (51 + 21), not 97 unique scenarios. Prior [Agent02 independent 350/350](https://github.com/AbdullahZaher/vibress/actions/runs/44107572462) was executed on earlier proposed Policy A source with the **same untouched operator blob**, and is historical supplementary evidence; those 350 repetitions **were not re-run here**.

No completed failed-test journal, no changed seeded-row checksum, and **`DISPOSABLE_DB_LEAK_COUNT=0`**. Docker Compose isolated PostgreSQL containers and volumes were stopped and removed in workflow cleanup.

### Audit trail of initial failed experimental harness

- [Run #44138506578](https://github.com/AbdullahZaher/vibress/actions/runs/44138506578): blocked by test-only ESLint `no-useless-assignment`, corrected without editing the production operator.
- [Run #44138701631](https://github.com/AbdullahZaher/vibress/actions/runs/44138701631): **2/5 pass, 3/5 fail** because the test cancel callback compared PostgreSQL `backend_start` as JavaScript `Date`, discarding sub-millisecond precision, yielding false backend mismatches and correct conservative `INDETERMINATE` rather than `DEADLINE_EXCEEDED`. A delayed-ACK fixture also surfaced an unhandled expected rejected Promise.
- Corrected the **test harness** to compare full `backend_start::text`, attach expected rejection handlers synchronously, and retained the original strict negative assertions. [Run #44139459315](https://github.com/AbdullahZaher/vibress/actions/runs/44139459315) succeeded 5/5 targeted, 51/51 full operator, 21/21 fault cases. Final [#44140361447](https://github.com/AbdullahZaher/vibress/actions/runs/44140361447) repeated the 5-target set five times and succeeded.

### Exact experimental commands (GitHub runner; LOCAL DISPOSABLE ONLY)

```bash
node --version                  # v24.22.3
pnpm install --frozen-lockfile
pnpm --filter @vibress/plugin-sdk build
pnpm exec eslint packages/database/src/platform-schema-operation-budget-experiment.ts tests/integration/platform-schema-migration-operator.test.ts
pnpm typecheck
docker compose -f compose.dev.yml up -d --wait postgres
docker compose -f compose.dev.yml exec -T postgres psql -At -U vibress -d vibress -c 'SHOW server_version_num'  # 160016

# Exactly five repeats, with independent disposable DB/roles each time.
for n in 1 2 3 4 5; do
  pnpm exec vitest run --no-file-parallelism tests/integration/platform-schema-migration-operator.test.ts -t "EXP-BUDGET"
done

# Original regression suites, never weakened or excluded.
pnpm exec vitest run --no-file-parallelism tests/integration/platform-schema-migration-operator.test.ts
pnpm exec vitest run --no-file-parallelism tests/integration/platform-schema-migration-fault-injection.test.ts
docker compose -f compose.dev.yml down --volumes --remove-orphans
```

Do not execute the commands against production or a shared database. The exact branch-only workflow and supporting source at the pinned SHA are authoritative: https://github.com/AbdullahZaher/vibress/blob/eef874f69924cf25223ad1290e0cc958fa46e3e8/.github/workflows/m03-s03-experimental-deadline.yml .

## 6. Remaining conditions and security risk register

1. **AG06-S03-08 P2 BLOCKING — owner security contract missing.** No named accountable human owner/IAM/DBA approval of Policy A/B, its precise expiry semantics, exact finite duration/unit, start, client success classification or residual risks. P01/P02 are **proposals**. **No approval or risk waiver** issued.
2. **No production whole-operation deadline implementation.** This experiment is only a private decorator. No approved CLI/operator supervisor that includes actual connection/TLS, cumulative dynamic PG timeouts, cancellation escalation, backend fencing, fresh-session production-grade reconciliation or committed durable failure audit. Actual hard DB COMMIT timing across partitions is impossible to assert using a JS timer.
3. **Rollback / COMMIT ambiguity:** physical DB may commit after client deadline. A timed-out or severed socket does not prove rollback. Requires independent backend-fenced recovery, explicit `INDETERMINATE`, and operator credential quarantine on uncertainty. Existing Agent04 recovery is disposable test harness, not a proven production service.
4. **Agent04 new classification finding:** in the canonical operator, actual PostgreSQL lock-timeout SQLSTATE `55P03` is currently sanitized externally as `UNAUTHORIZED`. This does **not** authorize DDL, but conflates availability/lock contention with an IAM denial. Agent03/Agent02 must review safe separated error/audit classifications without exposing SQL/PII or weakening authorization. See [benchmark handoff](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6956154868). Severity requires independent appraisal.
5. **Native PostgreSQL ownership and user trust:** the dedicated operator table owner can perform additional native DDL outside the TypeScript renderer if its credential is compromised. Pooled logins do not prove human approvals. Production effective privilege inventory, connection security, identity lifecycle and backup/PITR restore rehearsal remain unverified.
6. **Mandatory test matrix incomplete for final acceptance:** no owner-approved cumulative contract to test. Not separately exercised here: each registry/approval row-lock deadline boundary, arbitrary slow catalog scan, real process SIGKILL while total budget expires, production connection/TLS delay, cumulative many-short-SQL delays, deployed watchdog outage, verified terminate/escalation, production recovery RTO, P99 topology/SLO and 350 replays on the new experimental SHA. The original PG16 fault suite and earlier exact-operator 350-run evidence remain available.
7. **Release cross-domain gates:** independent Agent03 + Agent04 signoffs, new Agent06 review of the exact future integrated canonical SHA, 4/4 release-bearing CI, rollback/PITR and monitoring are not satisfied by this experiment. [Draft PR #198](https://github.com/AbdullahZaher/vibress/pull/198) must remain unchanged and Draft.

**Required owner action:** Formally approve A or B with accountable human IAM/DBA concurrence; derive and approve a finite integer deadline from representative measurements and business SLO. The documented Agent04 localhost numbers are not sufficient. Then assign a *new* production-grade implementation (do **NOT** cherry-pick this prototype as-is) on a controlled branch, integrate only independently reviewed deltas into PR #198, execute complete exact-SHA PG16/fault/CI/rollback/monitoring gates and require independent Agent06 review.

## 7. Final Agent05 + Agent02 decision

| Required gate | Verdict |
| --- | --- |
| **Policy Approval** | **MISSING** |
| **Deadline Approval (numeric and semantics)** | **MISSING** |
| **Authorization Expiry** | **PASS in prior isolated unapproved Policy A PG16 tests; no approved canonical policy** |
| **Whole-Operation Deadline** | **INCOMPLETE for approved release**; exploratory cancellation/classification cases 25/25 PASS |
| **Deadlock Handling** | **PASS only for prior verified unchanged-operator disposable PG16 tests** |
| **Catalog Drift** | **PASS in retained fault/identity suites** |
| **Crash / COMMIT Recovery** | **PASS in tested disposable contexts**; deployed recovery not certified |
| **Security Regression** | **PASS within experimental subset**: 51/51 + 21/21 plus 25/25 repeated |
| **Experimental Remediation SHA** | **eef874f69924cf25223ad1290e0cc958fa46e3e8** |
| **Ready for Controlled Integration** | **NO** |
| **Independent Agent 06 Certification** | **PENDING** |
| **Merge** | **NOT AUTHORIZED** |
| **Production** | **NO-GO** |

**Risk/rollback:** no production effects occurred, no production secrets/role grants/migrations touched; the experiment can be discarded by not integrating its isolated branch. All disposable PostgreSQL DBs/containers/volumes were cleaned and the runner reported zero leaked fixture DBs. No High/Critical risk was accepted.

## Primary references researched 2026-11-17

- PostgreSQL 16 time functions: https://www.postgresql.org/docs/16/functions-datetime.html
- PostgreSQL 16 READ COMMITTED and statement snapshots: https://www.postgresql.org/docs/16/transaction-iso.html
- PostgreSQL 16 explicit relation/advisory locking and deadlocks: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 timeout configuration: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 `pg_cancel_backend` and `pg_terminate_backend`: https://www.postgresql.org/docs/16/functions-admin.html
- node-postgres connection/query timeouts: https://node-postgres.com/apis/client
- Official Node.js 24.22.3 LTS security release (2026-11-11): https://nodejs.org/en/blog/release/v24.22.3
- Accountable owner/P02 proposal, Agent06 review, Agent04 benchmark and exact-source GitHub Actions links above.

**Separation of duties:** This report is an engineering experiment and specialist handoff. It is NOT an Agent06 independent verdict, an IAM/DBA human signature, a risk acceptance, or authorization to merge or deploy.
