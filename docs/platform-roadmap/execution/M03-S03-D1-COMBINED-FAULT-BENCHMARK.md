# M03-S03 — D1 Combined-Fault PostgreSQL 16 Benchmark and Recovery Verification

**Date:** 2026-11-17 (Asia/Riyadh)  
**Scope:** Agent 02 PostgreSQL transaction/recovery technical verification + Agent 04 quantitative measurement technical verification, **restricted disposable PG16.16**.  
**Release decision:** **REQUEST CHANGES / NO-GO**; human DBA and IAM signatures **PENDING**; canonical source/production unmodified.  
**Owner approval:** Policy A / FINAL_PRE_DDL + D1=**2517ms** in the limited **single-stressor, development/disposable** class [P04](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959358323). New combined-fault topologies are **adversarial extensions not implicitly approved owner production/service workloads**. D2 NOT APPROVED.

## 1. Immutable Git provenance and scope

| Source | Identity and effect |
| --- | --- |
| Canonical Draft [PR #198](https://github.com/AbdullahZaher/vibress/pull/198) | `b5cfc0687076c86a7450a8a785a072f6e63ad289` — untouched, OPEN/DRAFT |
| Owner-P04 Policy A Draft [PR #203](https://github.com/AbdullahZaher/vibress/pull/203) | `1fb5e1600fd2300d7509ec998ff3b1fa1fff5078` |
| Agent04 benchmark Draft [PR #204](https://github.com/AbdullahZaher/vibress/pull/204) | `aa8d55f3e6769e877edd371bfeab6e8f5ac16a0a` |
| Final tested isolated branch | `experiment/m03-s03-ag02-ag04-d1-combined-fault-20261117` |
| **Exact tested source SHA** | **`f4948b1e07d584206da8931bed6845d50b124169`** |
| Current new experiment delta relative to #204 | **ONLY** `tests/integration/m03-s03-whole-operation-benchmark.test.ts`, `scripts/platform/m03-s03-benchmark/transport-latency-proxy.ts`, **new** `.github/workflows/ag02-ag04-m03-s03-d1-combined-fault.yml` |
| Operator source blob (unchanged) | `31b1e862f594434944fec516f768265baf794525` |
| CLI source blob (unchanged) | `a0e337680d2a73c1016f60b0506ecfdcf73388c2` |
| Migration 0060 source blob (unchanged) | `d8b1e50a0a4dd347fde235ae7cb1a12468249719` |
| Infrastructure | GitHub Ubuntu 24.04 independent runners, disposable docker-compose `postgres`, PG **16.16 / 160016**, Node **v24.22.3** |
| Exact full [CI #44173978347](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347) | **SUCCESS**: [job 134360270149](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/job/134360270149) and [job 134360270467](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/job/134360270467), each 11 focused Vitest tests PASS, ESLint/typecheck PASS, test-only branch and exact source validated, **0 leaked disposable databases** |

**Historic sources remain attributed:** Agent04 exact run [#44155976796](https://github.com/AbdullahZaher/vibress/actions/runs/44155976796) had 1375 unique real-PG samples including 1000 normal and 100 controlled relation contention on a **different benchmark SHA** `66af2e217b565ae552832a0399b6a96cd3259728`; Agent02 [#44167248343](https://github.com/AbdullahZaher/vibress/actions/runs/44167248343) added real cancellation/rollback verification 18 repeated target cases and 52 original operator+21 fault cases. Those are historical baseline and regression evidence, **NOT** 1375 new attempts on the final SHA.

## 2. Reproducibility and sanitized artifacts

The push-triggered workflow checks exactly the preserved operator, CLI and migration blob hashes, installs pinned pnpm graph, checks Node24.22.3 and PG16.16, then executes:

```bash
pnpm install --frozen-lockfile
pnpm --filter @vibress/plugin-sdk build
pnpm exec eslint tests/integration/m03-s03-whole-operation-benchmark.test.ts scripts/platform/m03-s03-benchmark/*.ts
pnpm typecheck
docker compose -f compose.dev.yml up -d --wait postgres
pnpm exec vitest run --no-file-parallelism tests/integration/m03-s03-whole-operation-benchmark.test.ts -t "AG02-AG04 D1" --testTimeout=420000 --hookTimeout=120000
docker compose -f compose.dev.yml down --volumes --remove-orphans
```

**Never run against external or production PostgreSQL**: test-only benchmark `beforeAll` refuses non-local and non-disposable DB URLs, and requires dedicated disposable PG16. Source is **not** imported by API/worker/runtime. Do not run these destructive disposable fixture migrations against a shared database.

The exact successful run archived **separately for each independent runner**:

- [Artifact #14368349717 — independent run 1](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/artifacts/14368349717), ZIP SHA256 `9f2bd705a865bddeb1179a5d0fe8ba0456ad63742bdd36c0e34ea03c4fbaa0c4`, **91 unique raw attempt IDs**.
- [Artifact #14368369399 — independent run 2](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/artifacts/14368369399), ZIP SHA256 `ccd4a39054f4fc408990b3dfd731c0c3ea62186b0eb47e62a3359a95bc80b12b`, **91 unique raw attempt IDs**.

Every ZIP contains **six requested sanitized files**: `source-provenance.json`, `combined-fault-raw-attempts.jsonl`, `combined-fault-summary.json`, `commit-admission-candidates.json`, `cancellation-recovery-timings.json`, `d1-pg06-regression.json`.

The downloaded raw evidence was independently decompressed and recalculated, checking exact source SHA, success/failure codes, stage durations, per-profile counts and distinct IDs. Stage timestamps use `process.hrtime.bigint()` relative to T0 before connection: connection begin/end, BEGIN, installation advisory, registry row, approval advisory, target ACCESS EXCLUSIVE, catalog/effective privileges, final approval, DDL, registry CAS/journal, COMMIT query, T13 ACK **only when definitively received**, T14 classification and T15 disposal. On lost ACK, the failed COMMIT query's measured duration is **not** a definitive ACK time. On test-only pre-COMMIT refusal, the observed "COMMIT stage" is an **attempted adapter call** with `commit_dispatched=false`, **NOT** wire transmission.

### Recorded scenario matrix

| Real PG16 / real TCP profile | Attempt count per runner | Combined total | Actual results |
| --- | ---: | ---: | --- |
| 5ms one-way TCP +60ms ACK response | 6 | 12 | 12 APPLIED, all observed T14 within D1 |
| 5ms TCP +200ms ACK | 6 | 12 | 12 APPLIED, within D1 |
| 15ms TCP +60ms ACK | 6 | 12 | 12 APPLIED, within D1 |
| 15ms TCP +200ms ACK | 6 | 12 | 12 APPLIED, within D1 |
| 30ms TCP +60ms ACK | 12 | 24 | 24 APPLIED, within D1 |
| 30ms TCP +200ms ACK | 12 | 24 | 24 APPLIED, within D1, narrow observed headroom |
| 30ms TCP +200ms ACK +25ms event loop stall | 5 | 10 | 10 APPLIED, observed T14 max **2501.4067ms** |
| 30ms TCP +200ms ACK + real parallel PostgreSQL CPU query | 3 | 6 | 6 APPLIED, observed T14 max **2477.8728ms** |
| 30ms TCP + real 500ms ACCESS SHARE blocker | 5 | 10 | 10 physical commits and **10 late APPLIED** |
| 30ms TCP + real 900ms ACCESS SHARE blocker | 5 | 10 | 10 physical commits and **10 late APPLIED** |
| 30ms TCP + 3 genuine 250ms installation/registry/table blockers | 4 | 8 | **8 late APPLIED** |
| **30ms TCP +200ms ACK +500ms table lock** | 4 | 8 | **8 late APPLIED** |
| **30ms TCP +200ms ACK +900ms table lock** | 4 | 8 | **8 late APPLIED** |
| 30ms TCP + genuine table lock + out-of-band verified 57014 cancellation | 5 | 10 | 10 cancelled query, genuine physical rollback, original backend gone |
| 30ms TCP + **wire-protocol COMMIT-ACK drop** | 4 | 8 | 8 INDETERMINATE; 8 fresh-session **COMMITTED** |
| **TEST ONLY** owner-D1 expired after DDL/journal, adapter refuses COMMIT | 4 | 8 | 8 no COMMIT transmitted, source conservatively INDETERMINATE, original backend gone, fresh physical rollback |
| **Total recorded attempts** | **91** | **182** | **44 late APPLIED** in unmodified non-D1 operator, 10 real cancellations, 8 actual lost ACK, 8 guarded pre-COMMIT refusals |

The **4 D1-PG06 repetitions** (2 per independent runner) and synthetic margin equality assertions are **additional Vitest assertions**, not included in the 182 attempt JSONL count. In every D1-PG06, PostgreSQL COMMIT physically completed and returned a definite ACK, but the test-only client wrapper held delivery to the operator long enough for old code to return **late APPLIED** at T14 max **2631.3530ms**; a TEST-ONLY fail-closed classifier recorded `COMMITTED_LATE`. No deployed supervisor or automatic retry was introduced.

### Key maxima independently recalculated

| Combined profile | n | Max T12/pre-COMMIT observed (ms) | Max definitive COMMIT query/ACK (ms) | Max T14 (ms) |
| --- | ---: | ---: | ---: | ---: |
| 30ms TCP +200ms ACK | 24 | 2221.2326 | 261.5452 | **2482.7942** |
| 30ms TCP +200ms ACK +25ms JS scheduler stall | 10 | 2240.0674 | 262.0083 | **2501.4067** |
| 30ms TCP +200ms ACK +real PG CPU load | 6 | 2216.5227 | 262.3236 | **2477.8728** |
| 30ms TCP +500ms lock | 10 | 2691.3798 | 61.3125 | **2752.7114** |
| 30ms TCP +900ms lock | 10 | 3094.0748 | 61.7478 | **3155.3667** |
| 30ms TCP + 3 short consecutive locks | 8 | 2880.6919 | 63.7762 | **2944.4875** |
| 30ms TCP +200ms ACK +500ms lock | 8 | 2691.6036 | 262.4921 | **2953.0551** |
| 30ms TCP +200ms ACK +900ms lock | 8 | 3092.0857 | 261.6301 | **3353.4188** |

These measurements are observed maxima from **two disposable hot-cache runner jobs**, not physical upper bounds. The joint profiles demonstrate that successful D1 synchronous outcome **cannot be promised for every offered combined workload** under the approved 2517ms; safe implementation should refuse before COMMIT when unable to meet admission criteria rather than re-label late APPLIED.

## 3. Transaction safety and cancellation/recovery

### Cancellation in real combined contention

For **10** cases, an independent trusted test-admin first confirmed exact operator PID, database, login and microsecond-preserved `backend_start::text`. The controller polled `pg_stat_activity` until the operator was **actually waiting in a PG Lock state on target LOCK TABLE**, then issued `pg_cancel_backend`. Accepted signal was **not** treated as rollback. Source query failed SQLSTATE **57014**, original client transaction ended, original backend was observed gone and an independent fresh PG connection verified absent DDL column, original registry manifest digest, **zero completed operator journal**, unchanged seeded-data checksum. External old operator still reports generic `UNAUTHORIZED`, which is a separate `AG06-S03-10` error-classification defect.

**Measured restricted combined-cancellation group (n=10):**

| Stage measured | p50 ms | p95 ms | p99 ms* | Observed max ms |
| --- | ---: | ---: | ---: | ---: |
| Independently scoped `pg_cancel_backend` signal dispatch/return (NOT complete rollback) | 1.0606 | 1.1139 | 1.1345 | 1.1396 |
| Fresh trusted catalog/registry/journal reconciliation (after source connection disposal) | 8.9981 | 9.4228 | 9.4974 | 9.5160 |
| T0-to-T14 failure classification (includes 30ms transport and intentionally held lock) | 1181.5103 | 1220.3128 | 1220.6342 | 1220.7146 |
| T0-to-T15 client disposal (includes intentionally held lock) | 1181.8071 | 1220.5839 | 1220.9103 | 1220.9919 |

*p99 is sample descriptive only with n=10; **not enough for a robust high-confidence SLO**. The test did not separately time every control-channel failure mode, network partition, failed rollback ACK, stale backend or watchdog loss. Those remain BLOCKED design requirements. Do not award the application role any `pg_signal_backend` or superuser authority.

### Unknown COMMIT and backend fencing

**8** real wire-level dropped COMMIT ACK cases via chained TCP proxies returned `INDETERMINATE`. The on-wire proxy actually observed PostgreSQL server's COMMIT CommandComplete and intentionally never forwarded it. A **fresh trusted connection** verified one completed journal, exact expected registry digest and physical optional column before classification **COMMITTED**; no blind replay. Fresh reconciliation n=8 p50 **9.4882ms**, p95 **9.8589ms**, p99 **9.9037ms**, max **9.9149ms**, local observer available; **not a network-partition recovery bound**.

**8** test-only pre-COMMIT budget refusals used an explicitly **HYPOTHETICAL M=300ms (NOT approved or recommended)** and expired the actual 2517ms guard after physical DDL/journal statements but **before** the adapter transmitted SQL COMMIT. The existing core sets `commitAttempted=true` before its `query("COMMIT")`, so it emits `INDETERMINATE` without running its normal explicit ROLLBACK path. The harness therefore **waited until exact original backend PID+backend_start disappeared**, then independently verified no DDL column, original manifest, zero completed journal and unchanged seeded checksum. All **8/8 PASS** for narrow physical **rollback-by-terminated-transaction**; **no acknowledged ROLLBACK query** is claimed. T14 could reach **2630.3538ms**, T15 **2633.6044ms**—correct evidence that T15 can occur after D1. A later application supervisor must distinguish "COMMIT was dispatched" from "COMMIT method was entered" and provide an explicit backed-up rollback/fence sequence.

**Mandatory reconciliation algorithm:** Authenticate original installation/operator identity; ensure the original backend cannot still perform a late COMMIT (PID+backend_start+database+role, connection quarantine or provable backend termination); use a **fresh trusted observer**; compare exact installation/operation/plan digest, registry/manifest prev/new digests, live PostgreSQL catalog owner and mapped column/indices/constraints/trigger state, completed-only journal cardinality and provenance. Output COMMITTED, ALREADY_APPLIED, definitely ROLLED_BACK only with conclusive evidence, INDETERMINATE when outcome/old backend is still active, or HALT_UNRECONCILABLE if evidence is inconsistent or trust/recovery access unavailable. A subsequently reconciled COMMITTED result does **not** retroactively make late T14 compliant with D1.

## 4. Operational objectives — research proposals, NOT D2

Observational local source and outcome metrics:
- Fresh observer after cancellation: **n=10**, p50 8.9981ms, p95 9.4228ms, p99 9.4974ms, max 9.5160ms.
- Fresh observer after lost COMMIT ACK: **n=8**, p50 9.4882ms, p95 9.8589ms, p99 9.9037ms, max 9.9149ms.
- Fresh observer after pre-COMMIT guard/backend fencing: **n=8**, p50 9.0523ms, p95 9.3325ms, p99 9.3956ms, max 9.4114ms.

**Agent04 measurement recommendation:** no hard T15/RTO guarantee from these small loopback samples. Collect >=100 per scenario across independently recreated fixtures and controlled failure states including cancel never delivered, lost ROLLBACK ACK, watchdog TCP broken, process SIGKILL and original backend still live, then derive separately:
`cancellation_initiated`, `server_query_settled`, `rollback_acknowledged`, `backend_fenced`, `fresh_connection_acquired`, `catalog/registry/journal_reconciled`, `connection_quarantined`, `physical_cleanup_complete`, `classification_audited`. A time-limited controller must fail closed / escalate to qualified DBA and remain INDETERMINATE if authority or observation fails. No numerical SLO was set by the Project Owner for these recovery states. `D2` is explicitly NOT APPROVED.

## 5. Timeout architecture and operational safety

Current exact existing Operator: `SET LOCAL lock_timeout=2000ms`, `statement_timeout=10000ms`, `idle_in_transaction_session_timeout=15000ms`; CLI `connectionTimeoutMillis=4000ms`, client `query_timeout=12000ms`. These are phase controls and do not bound one 2517ms pre-connection-to-T14 cumulative operation.

Any later *authorized* nonproduction implementation must preserve immutable T0 before connect, clamp connection timeout to remaining positive finite budget, bound per-step PG local statement/lock timeouts by remaining and a separately approved positive M, avoid reinitializing the clock or setting new blocking SQL between fresh Policy A final authorization and DDL, verify pre-COMMIT admission, treat T13 and T14 as independent success gates and escalate safely on after-dispatch ambiguity. Client-only timeout does not prove server-side cancellation, rollback or backend termination. Do not set timeout `0` when it means disabled.

**AG06-S03-10 P3:** currently `55P03` lock_timeout and `57014` externally fall into generic `UNAUTHORIZED`; recommend separate sanitized `LOCK_TIMEOUT`, `QUERY_CANCELED/DEADLINE_EXCEEDED`, `DEADLOCK_DETECTED` for `40P01`, real IAM `UNAUTHORIZED`, and `INDETERMINATE` for unknown COMMIT. No SQL text, credentials, actor secrets or automatic DDL retry.

**Safety invariants preserved:** one optional existing-table ADD_FIELD only; no default, CREATE_RESOURCE, tenant DDL or destructive DDL; trusted plan digest and distinct individual author/approver/operator identities; installation and approval advisory locks plus registry `FOR UPDATE`, `ACCESS EXCLUSIVE` target, final fresh `clock_timestamp()` approval; migrations 0059/0060 and physical DDL+manifest CAS+completed journal atomicity; no runtime DDL privileges. New benchmark source changes no production Operator, CLI, SQL renderer, migrations, grants, roles, storage, or installation deployment.

## 6. Distinct technical review conclusions

**Agent 04 — quantitative measurement lead verdict: MEASUREMENTS SUPPORTED / NUMERIC M NOT SUPPORTED.** Two independent GitHub-hosted runners and source-pinned 182 real PG16 attempt records, consistent stage timing and raw data, explicit representative limits. The old 109ms scheduling/cancellation reserve was **NOT** a validated COMMIT-ACK admission margin. A sampled p99 (particularly n=6/8/10/12/24) does not bound a requested 99th percentile with sufficient confidence; no TLS/DNS/WAN, production load, guaranteed event loop or WAL worst-case. The hypothetical M300 sensitivity predicts several refusals even among actually on-time measured 30ms+200ms profiles, but that is **not** an approved false-timeout probability. **M=NOT DETERMINABLE**.

**Agent 02 — database reliability lead verdict: REQUEST CHANGES.** Real 57014 query cancellation and physical rollback/fenced backend, wire COMMIT-ACK ambiguity and fresh journal/catalog/registry reconciliation passed in the restricted lab, but original source demonstrably violates D1 T14 in 44 successful combined executions and 4 extra D1-PG06 injected-late classifications. The test-only guard's 8 physical rollbacks after backend disappearance show a possible fail-closed *admission* path but expose source's pre-dispatch `commitAttempted` ambiguity. No full watchdog, trusted role fencing service, independent human DBA/IAM approvals, exact numeric admission M, or integrated D1 source. **Do not authorize integration.**

**Unresolved cross-review differences:** none on the factual 182 recorded attempts, the timing calculations, D1 violation, physical PostgreSQL results or unapproved status. Both specialist hats **decline to select a numeric M** because the joint workload assumptions and statistical safety threshold are not externally authorized; this is a cooperative technical assessment, not independent human signatures or separation-of-duties approval.

## 7. Formal handoff and gate

Owner P04 approval remains *restricted*; human independent PostgreSQL DBA [request #6959199526](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526) **PENDING**, independent human IAM [#6959197756](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959197756) **PENDING**, latest Agent06 canonical [review #5944132056](https://github.com/AbdullahZaher/vibress/pull/198#pullrequestreview-5944132056) **REQUEST CHANGES**.

Before implementation: Agent01 obtains an explicit supported combined-stressor scope and acceptable refusal/latency SLO or preserves the existing narrower single-stressor contract; Agents 02/04 prove or reject a numeric ACK admission reserve M with enough held-out samples for that scope; Agent05/IAM authorizes independently scoped watchdog identity and checks roster deactivation/approval revocation under cancellation; DBA independently approves separate T15/recovery/fencing targets. After those gates, a nonimplementing Agent06 must audit the **new exact integrated SHA**, fresh 4-job CI and real PostgreSQL faults. Nobody may promote this experimental branch directly to canonical PR #198.

**Final:** Agent02 `REQUEST CHANGES` · Agent04 `MEASUREMENT VALID / M NOT DETERMINABLE` · `AG06-S03-08 OPEN P2` · `AG06-S03-10 OPEN P3` · Human DBA/IAM `PENDING/PENDING` · Integration `NOT AUTHORIZED` · Merge `NOT AUTHORIZED` · Production `NO-GO`.

## Verified official documentation researched 2026-11-17

- PostgreSQL 16 client/statement/lock/idle timeout semantics: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 locks and deadlocks: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 cancellation/termination authority: https://www.postgresql.org/docs/16/functions-admin.html
- PostgreSQL 16 wire protocol COMMIT/ReadyForQuery: https://www.postgresql.org/docs/16/protocol-flow.html
- PostgreSQL 16 WAL COMMIT behavior: https://www.postgresql.org/docs/16/wal-async-commit.html
- PostgreSQL 16.16 official release 2026-11-12: https://www.postgresql.org/docs/release/16.16/
- Node.js v24.22.3 official security release 2026-11-11: https://nodejs.org/en/blog/release/v24.22.3/
- node-postgres client/driver behavior: https://node-postgres.com/apis/client
