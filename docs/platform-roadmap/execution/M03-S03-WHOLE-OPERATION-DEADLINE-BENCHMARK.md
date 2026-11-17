# M03-S03 — Whole-Operation Deadline Benchmark

## Current Agent04 benchmark certification — supersedes historical pending labels below

### Three-run independent quantitative sizing update (supersedes earlier two-run values)

Latest completed exact-source [CI #44154251306](https://github.com/AbdullahZaher/vibress/actions/runs/44154251306) at benchmark HEAD ff05592c374d512a1526c016acc748f33cf8693f, synthetic checkout d8bdc1e293fbb7dc7fe6eea70931ea5b90365539, artifact [#14361185666](https://github.com/AbdullahZaher/vibress/actions/runs/44154251306/artifacts/14361185666) **SUCCESS**: 1335/1335 unique raw records, Node 24.22.3, PostgreSQL 16.16 (160016), immutable disposable Docker image sha256:3cbd775daa28461ef484ed88ca1e5a5a72ff126e196deeebce6fec764edf1200. Normal 1000/1000 successful p99 **24.4188ms**; contention 90/100 successful p99 **926.4373ms** and ten deliberate PostgreSQL 55P03 lock-timeout denials; 30ms each-direction TCP proxy p99 **2296.6552ms**, max **2297.1253ms**. Real cancel 20/20, termination 10/10, lost COMMIT ACK 8/8 -> INDETERMINATE then independent committed recovery. Cancellation-to-classification p99 **7.7803ms**, rollback ACK p99 **0.3701ms**, lost-ACK recovery p99 **6.8595ms**.

**Three-run conditional lab sizing:** Max eligible successful profile-specific p99 **2298.0869ms** (Run2), maximum observed successful lifecycle **2298.1778ms** (Run2), maximum observed cancellation/rollback reserve ceil(7.7803 + 0.3701 + 100 unverified margin) = **109ms** (Run3). Candidate A **2408ms**, Candidate B **2517ms**, **preferred technical proposal B=2517ms in the precisely stated disposable test lab ONLY**. The historical two-run **2405/2511ms** below is superseded. Both revised candidates have **0/3492 in-sample** exceeds among 1164 eligible successful requests per run, not independent validation of a true production false-timeout SLO. No approved owner numeric deadline, no IAM/DBA human sign-offs.

**Frozen 2408/2517ms held-out validation:** additional test-only benchmark executes eight normal successes, eight actual 500ms table-lock successes, and four deliberately expired pre-COMMIT budget denials per candidate, with physical catalog/journal checks. Status **PENDING exact-HEAD CI** until the separate frozen cohort completes. There is NO production supervisor.



**Updated: 2026-11-17. OWNER POLICY A SELECTED by user for restricted development/disposable scope. Numeric deadline NOT approved; IAM/DBA human signatures MISSING.** The earlier historical text below describes PR #203 and earlier reports **as they stood before this explicit owner policy selection**. It must not be used to revoke the owner's current selection or to claim a numeric deadline is approved.

**Technical test-only verdict: PASS** on two complete independent GitHub Actions jobs, each 1335/1335 unique machine-readable attempts. No production-code change, privileged grant or canonical PR #198 modification. PostgreSQL16.16 (160016), Node24.22.3, isolated GitHub Actions ubuntu-24.04. **Representative environment: LIMITED (no real DNS/TLS, region RTT, production loads or pool contention).**

**Complete sizing and reliability report:** [M03-S03-DEADLINE-SIZING-RECOMMENDATION.md](M03-S03-DEADLINE-SIZING-RECOMMENDATION.md) — 22 sections, full metric table, statistical caveats, profile definitions and exact numeric conditional proposals.

### Source and raw evidence pinned to actually executed code

| Subject | Expanded run 1 | Expanded run 2 |
| --- | --- | --- |
| Branch HEAD at run | 9e00ad92e428cb64a7f6d4a86ddb2e38e1943867 | 185afb9ccad8b8ec28a8c6b923a1e69f93d98914 |
| Exact synthetic checkout SHA | 660eb29be9b703ac45eb05d268167b8c4a0f853a | a748ff6a4c52e3488125960f0fc83616cde9d93a |
| CI status | [#44151684946](https://github.com/AbdullahZaher/vibress/actions/runs/44151684946) **SUCCESS** | [#44151913933](https://github.com/AbdullahZaher/vibress/actions/runs/44151913933) **SUCCESS** |
| All six sanitized JSONL/JSON files | [Artifact #14359801508](https://github.com/AbdullahZaher/vibress/actions/runs/44151684946/artifacts/14359801508) | [Artifact #14359611993](https://github.com/AbdullahZaher/vibress/actions/runs/44151913933/artifacts/14359611993) |
| Attempt records | 1335 | 1335 |
| Normal APPLIED (p99 end-to-end) | 1000/1000 (42.1438ms) | 1000/1000 (45.7440ms) |
| Successful contention (p99 end-to-end) | 90/100 (936.883ms) | 90/100 (947.981ms) |
| Injected lock_timeout failures | 10/100 55P03 | 10/100 55P03 |
| Actual TCP transport 30ms one-way (p99) | 2286.4865ms (n=12) | 2298.0869ms (n=12) |
| ACK extra +200ms (ACK p99) | 201.3809ms | 200.981ms |
| Cancellation SQLSTATE 57014 + rollback verified | 20/20 | 20/20 |
| Terminated backend and fresh observer | 10/10 | 10/10 |
| Lost COMMIT ACK -> INDETERMINATE -> COMMITTED | 8/8 | 8/8 |
| Pre-COMMIT deliberately exhausted budget, no journal | 8/8 | 8/8 |
| External unexpected index/CHECK | 12/12 fail-closed CATALOG_DRIFT | 12/12 fail-closed CATALOG_DRIFT |
| Candidate A derived in each run | 2392ms | 2405ms |
| Candidate B derived in each run | 2497ms | 2511ms |

The two **latest-run** measured candidate values combine to a conservative **FINAL CONDITIONAL LAB PROPOSAL**: Historical two-run Candidate A **2405ms**, Candidate B **2511ms**, superseded by three-run **2408ms / 2517ms**, preferred **2517ms** for the restricted test topology ONLY. Formula: max observed eligible profile-specific end-to-end p99 plus cancellation/rollback reserve = A; maximum eligible observed success plus twice reserve = B. Earlier two-run reserve was 106ms (superseded; three-run maximum 109ms): ceil(5.045ms cancel-to-classification p99 + 0.252ms rollback ACK p99 + explicitly assumed unvalidated 100ms scheduler margin). Three-run A=ceil(2298.0869+109)=2408ms. Three-run B=ceil(2298.1778+2×109)=2517ms. Both have zero exceeded eligible successes among the 3492 selected in-sample attempts (1164 each across three runs), **not an independent statistical 1%-SLO validation**. No owner SLO is approved.

**Critical limitation:** The candidate budget is a **client result/admission policy proposal**; the test-only per-query guard does not cancel an in-flight query by itself. 4 deliberately exhausted attempts per candidate per run denied new DDL/COMMIT and verified zero completed journal, but their **total cleanup lifecycle exceeded the numeric deadline** (~2.7–2.8 seconds). Do not claim the candidate bounds physical rollback or even callback return time. COMMIT dispatched and ACK lost must remain INDETERMINATE pending trusted fresh connection. The native per-statement lock_timeout=2000ms, statement_timeout=10000ms, idle_in_transaction_session_timeout=15000ms do not form a universal total timeout. More stringent production supervisor requires separately approved implementation and tests.

**Reproduction:** Existing dedicated benchmark workflow now executes 1000 normal +100 lock contention + expanded TCP, connection faults, cumulative waits, cancellation, crash/COMMIT and test-only candidate retests. It fails closed if any required expanded profile count differs or if the fixture teardown fails, and exports the six required artifacts. The Docker Compose PostgreSQL image uses a floating 16-alpine patch tag; actual server patch 16.16 is recorded, but immutable image digest and production topology remain unavailable.

**Outstanding governance:** AG06-S03-08 OPEN P2; AG06-S03-10 OPEN P3 (55P03 / 40P01 / 57014 sanitized operational classification). Numeric deadline approval PENDING; independent IAM human PENDING; DBA human PENDING; production supervisor NOT INTEGRATED. **MERGE NOT AUTHORIZED / PRODUCTION NO-GO.** Historical successful suites for findings S03-01 through S03-07 are preserved in their exact earlier scope.

---


**Date:** 2026-11-17 (Asia/Riyadh)  
**Authority:** Agent 04 technical evidence only; Policy A/B, global deadline and operational SLO **NOT APPROVED**  
**Release:** NO-GO · AG06-S03-08 OPEN · Merge NOT AUTHORIZED

**Original canonical PR #198:** b5cfc0687076c86a7450a8a785a072f6e63ad289  
**Unapproved Policy A source PR #203:** 6bf94cc45babd7c73593295900d791a2f03f7a72; confirmed 5 commits descendant of original canonical SHA  
**Independent benchmark Draft PR #204:** https://github.com/AbdullahZaher/vibress/pull/204  
**Current benchmark code and checkout SHA:** see current PR #204 head and CI artifact provenance; **do not conflate HEAD with GitHub synthetic PR merge SHA**.

## 1. Prior evidence and limitations

The previous 350/350 successful specialist PostgreSQL verification represents **repeated correctness tests, not independent latency measurements**. Previously observed ~1.1s expiry fixture, ~2s lock-timeout negative, 21-test fault suite wall time and 4s client connection guard cannot be used as whole-request p99.

The actual restricted operator uses READ COMMITTED, 2s per-lock lock_timeout, 10s per-statement statement_timeout, and 15s idle-in-transaction timeout. These are not additive or universal end-to-end bounds. The currently proposed Policy A final read occurs after target ACCESS EXCLUSIVE and before DDL. **No approved global timeout, cancellation contract or human IAM/DBA signatures exists.**

## 2. Disposable environment and measured workload

Runner: ubuntu-24.04 in GitHub Actions; localhost Docker PostgreSQL 16, explicit disposable DSN at 127.0.0.1:5433/vibress; Node v24.22.3. **Actual PostgreSQL patch number and Node version MUST be observed in CI**. Existing compose.dev.yml PostgreSQL 16-alpine tag is not digest-pinned; Docker resolved immutable image ID should be captured on future topology validation.

Actual migrations **0059 + 0060** create a real operator journal, trusted identity roster, independent non-superuser author/approver/operator/runtime login, bound application and installation. The authorized plan is a real optional ADD_FIELD website text without default on an existing application-owned table, with two seeded rows and checksums. The large table profile adds 10,000 synthetic rows (10,002 total).

The test creates **one independent disposable installation database**, not a multi-tenant production deployment. Each normal attempt uses a **fresh authenticated operator connection**, executes the **real production operator code** through COMMIT acknowledgment and connection disposal, and only then resets its physical column/registry/journal from the isolated superuser **outside the measured interval**. Repeated catalog DDL on the same warm relation is a **hot-cache synthetic benchmark**, not 1,000 independent installations. No production records, secrets, roles or infrastructure touched.

**Monotonic clock:** process.hrtime.bigint starts before connection acquisition. Every SQL query is instrumented in a test-only PG client proxy (no runtime code modification). Data includes full elapsed request, connection, transaction BEGIN, installation and approval advisory fences, registry FOR UPDATE, target ACCESS EXCLUSIVE, approval checks including final pre-DDL, privilege/catalog scans, row counts, real ALTER TABLE, registry CAS, journal insert, COMMIT ACK, rollback if applicable, and client connection disposal. Measurements are **client-observed await duration**, not exclusive server CPU/trace timing.

**Required attempt counts:** 1,000 uncontended true migrations, 100 independent external table-lock contention attempts, 12 cumulative test-only 4ms per-SQL client scheduling delay attempts, 12 large-table attempts and 3 warmups (warmups excluded from normal distribution). Contention holds **120ms, 900ms or 2200ms** after the operator's actual LOCK TABLE statement barrier. 2200ms exceeds the existing 2000ms lock cap and is expected to fail safely. This is an explicit injected workload, **not** evidence of realistic production contention distribution. 4ms client delay is software scheduling injection, **not physical DNS, TLS or network packet latency**.

**No executed production-shaped tests** for external DNS/TLS, regional RTT, high QPS, heterogeneous table sizes/indexes/constraints, full slow catalog under representative schema, concurrent competing operator/advisory locks, actual revoked approval during benchmark, backpressure, real network COMMIT delay or budget cancellation. Independent prior SIGKILL/TCP/lost-COMMIT correctness suite is **not** whole-operation timing proof.

## 3. How to reproduce in an exclusively disposable environment

Requires Node v24.22.3, pnpm 11.22.0, disposable GitHub Actions worker or isolated Docker project. Workflow: .github/workflows/m03-s03-whole-operation-benchmark.yml.

Use a *disposable runner only*: pnpm install --frozen-lockfile; pnpm --filter @vibress/plugin-sdk build; docker compose -f compose.dev.yml up -d --wait postgres. Then execute with DATABASE_URL=postgresql://vibress:vibress@127.0.0.1:5433/vibress and M03_S03_NORMAL_ATTEMPTS=1000, M03_S03_CONTENTION_ATTEMPTS=100:

pnpm exec vitest run --no-file-parallelism tests/integration/m03-s03-whole-operation-benchmark.test.ts --testTimeout=900000 --hookTimeout=120000

After verified fixture cleanup, tear down only the **owned disposable Compose project** using docker compose -f compose.dev.yml down --volumes --remove-orphans. **Do not run volume teardown on shared/production infrastructure.**

## 4. Raw machine-readable benchmark evidence

GitHub Actions artifact **m03-s03-whole-operation-benchmark** (30-day retention) contains:

- **provenance.json**: exact checked-out SHA, PR HEAD SHA, Node version; distinguish PR merge source.
- **raw-attempts.jsonl**: abstract case ID, workload profile, outcome, monotonic elapsed and connection duration, per-stage duration/count and allowlisted SQLSTATE, no raw SQL, actor credentials or customer data.
- **summary.json**: p50/p95/p99/max, separate successful-operation and all-attempt distributions, counts of outcomes/SQLSTATE, per-SQL-stage distributions, explicit source and topology warning.

CI must reject incomplete normal/contended sample matrices; it must never mark a run PASS if the test, checksum, row integrity or fixture cleanup fails. No percentile is accepted from a run whose required case count has not been completed.

**Executed results: AVAILABLE for these two disposable local benchmark runs only.** Source and checkout SHAs, raw sample counts and aggregate percentiles are verified in Section 4A below. This is not proof of production topology or of an approved execution budget.

## 4A. Measured evidence — two complete executable runs

**The original pre-fix CI #44139179569 FAILED at ESLint before measurement. It is NOT benchmark evidence.** The corrected workflow then executed two complete independent GitHub Actions jobs using the same test-only operator instrumentation and isolated PostgreSQL 16:

| Provenance | Run A | Run B (current report's measured baseline) |
| --- | --- | --- |
| GitHub Actions | [#44139586272](https://github.com/AbdullahZaher/vibress/actions/runs/44139586272) | [#44139725010](https://github.com/AbdullahZaher/vibress/actions/runs/44139725010) |
| PR head at that run | c991368a33d4294068587fc2451c4b9d8487d959 | 712a2a842e97b76d7d6c486919ed5a3c0c2aaa67 |
| **Actual checked-out synthetic merge** | **0cb905230638e889b964aeb2a0487a2cac3e9c87** | **c0f6e070b0bf5e1b609523f18ab009438c7e8db3** |
| PG16 server_version_num | 160016 (PG 16.16) | 160016 (PG 16.16) |
| Node version | v24.22.3 | v24.22.3 |
| Workflow verdict | SUCCESS, fixture/volume cleanup PASS | SUCCESS, fixture/volume cleanup PASS |
| Raw artifact (30-day retention) | [Artifact #14352569979](https://github.com/AbdullahZaher/vibress/actions/runs/44139586272/artifacts/14352569979) | [Artifact #14354815507](https://github.com/AbdullahZaher/vibress/actions/runs/44139725010/artifacts/14354815507) |
| **Unique raw attempt records** | **1,127** | **1,127** |

Each run contains 1,000 normal + 100 independently blocked target-table operations + 12 simulated client-delay + 12 larger seeded-table + 3 warmup samples. **1,000 normal real migrations succeeded in each run; 90/100 blocked ones succeeded, 10/100 were denied after actual PG lock_timeout (SQLSTATE 55P03) with no completed journal.** All 12 synthetic 4ms-per-SQL delay and 12 seeded-table operations succeeded, plus warmups.

### End-to-end operation distributions — milliseconds

Results include connection acquisition, the real S03 Operator preflight, approval/lock/DDL/registry/journal/COMMIT acknowledgment and connection disposal. Percentiles calculated separately for completed successful operations versus ALL attempts, with nearest-linear rank interpolation.

| Workload / cohort | n | p50 | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| A normal, successful | 1,000 | 34.7442 | 38.5988 | 43.9495 | 53.4477 |
| B normal, successful | 1,000 | 18.1891 | 21.1542 | 24.0058 | 42.0199 |
| A contention, ALL outcomes | 100 | 159.0336 | 2017.6953 | 2018.0935 | 2018.2339 |
| B contention, ALL outcomes | 100 | 144.7109 | 2011.3843 | 2012.1077 | 2012.3336 |
| A contention, successful only | 90 | — | — | 941.2738 | — |
| B contention, successful only | 90 | 143.9907 | 924.2816 | 925.1673 | 925.5559 |
| A 4ms simulated per-SQL client delay | 12 | — | — | 179.2080 | — |
| B 4ms simulated per-SQL client delay | 12 | 167.4167 | 171.4980 | 171.4994 | 171.4998 |
| A 10,002-row fixture | 12 | — | — | 40.3197 | — |
| B 10,002-row fixture | 12 | 21.4595 | 22.9364 | 23.0236 | 23.0454 |

**Critical variance:** run A normal p99 is **43.9495 ms** and run B p99 is **24.0058 ms**, despite nominally identical disposable topology, with no actual region-crossing RTT or TLS. This between-run performance variation alone disqualifies treating a single localhost p99 as a stable production upper bound. The repeated operation is on one hot relation with repeated test-only DDL resets; neither 1,000-count result proves production p99.

### Stage distributions — B run, milliseconds

| Monitored phase | p50 | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Connection acquisition (normal) | 2.8663 | 3.2097 | 3.7891 | 9.9600 |
| Target ACCESS EXCLUSIVE (uncontended normal) | 0.1172 | 0.1932 | 0.2364 | 3.3131 |
| Effective privilege check (normal) | 4.4581 | 5.3429 | 5.8715 | 10.1080 |
| Catalog inspection (normal) | 2.6270 | 2.9935 | 3.2290 | 9.0029 |
| ADD_FIELD statement (normal) | 0.3961 | 0.5788 | 0.6158 | 0.7650 |
| COMMIT query through ACK (normal) | 0.2135 | 0.2876 | 0.3372 | 0.5465 |
| Target ACCESS EXCLUSIVE (100 forced contention cases) | 120.9509 | 2000.7565 | 2000.7921 | 2000.9303 |
| Connection acquisition (100 forced contention cases) | 3.7054 | 4.0310 | 5.0932 | 7.6790 |

The raw JSON also includes initial approval, approval advisory lock, registry FOR UPDATE, post-DDL CAS, journal insertion, rollback and full elapsed. In **10 forced lock-timeout cases**, rollback query durations were **0.231–0.498 ms** in B; this is only a measured round-trip for ROLLBACK, **not** the guarantee that an interrupted transaction physically completed rollback. No deadlock SQLSTATE 40P01 or COMMIT uncertainty occurred in these measurement runs; those negative behaviors have separate correctness tests.

### Error classification and operational follow-up

- **10 / 100 contention attempts** intentionally held an external relation lock for 2200 ms after a deterministic entry barrier. PostgreSQL issued SQLSTATE **55P03** at the existing 2000ms lock cap. These attempts ended in **UNAUTHORIZED**, the current operator's generic external error class, with verified absent completed journal. **Do not mislabel these as invalid actor authorizations in production metrics**; Agent 02/03 must independently decide whether a distinct LOCK_TIMEOUT classification is required, without widening approvals.
- **0 / 1000** normal attempts timed out in either run; **0 / 100** forced contention trials produced a deadlock; no INDETERMINATE was observed. These zeros apply only to the exact controlled workloads, not real outage/COMMIT paths.
- No end-to-end cancellation watchdog, recovery classification latency or late/lost COMMIT ACK is measured. Previous on-wire failure tests prove safe recovery behavior only for their separate test scope. DNS/TLS, production connection pool, unapproved/expired approvals during benchmark, external noncooperating ALTER, concurrent different plans and slow catalog under realistic data still lack latency distributions.

**Raw proof location:** GitHub CI artifact raw-attempts.jsonl (1,127 sanitized records per run), summary.json and provenance.json. Each was fetched and independently re-counted; 55P03 counts and stage distributions were cross-checked against raw records, not copied from a single summary line.

## 5. Deadline sizing and enforceability

**Owner-approved SLO:** MISSING. **Final candidate duration:** NOT DETERMINABLE for production. **Policy A:** recommended but NOT APPROVED. **AG06-S03-08:** OPEN.

Measured local p99 (even at 1,000 trials) cannot prove a production p99. Before proposing finite candidate values, require topology variance, actual network latency (DNS, TLS, connection pool and proxy), expected lock contention and cancellation/rollback/COMMIT ACK reserve, acceptable false-timeout frequency, owner SLO and workload class. Any eventual two numeric alternatives must state all assumptions, predicted exceedance risk *on measured profiles only*, timeout/abort semantics and monitoring, and be separately signed by owner, IAM and DBA.

A client-side monotonic budget can classify a response and prevent **new** operations before COMMIT, but PostgreSQL 16 per-statement and idle timeouts do **not** guarantee that physical transaction completion, TCP response delivery or server cleanup meets the same deadline. COMMIT dispatched with lost/late ACK must be **INDETERMINATE** pending new-session journal+catalog+registry reconciliation; never blindly replay DDL or claim rollback without proof. Earlier real COMMIT wire-loss correctness tests do not measure budget compliance.

## 6. Independent validation and residual risk

Agent 02: confirm PostgreSQL instrumentation, actual dataset/topology, query/lock behavior, safe server timeout caps and cancellation semantics. Agent 05: expiry/revocation linearization under any future watchdog. Agent 03: ensure test-only instrumentation cannot be invoked by runtime, no SQL/secrets in CI artifacts. Agent 06: rerun on frozen exact SHA, review percentiles and unsigned release claims. Agent 01: owner SLO and final policy/number/signature only after sufficient evidence.

**Decision (2026-11-17): Benchmark PASS in the disposable lab (2 complete runs); Representative Environment LIMITED; Normal latency AVAILABLE; Lock contention AVAILABLE in controlled artificial profiles; COMMIT ACK latency AVAILABLE only on loopback; cancellation and unknown-COMMIT evidence INCOMPLETE; Deadline NOT DETERMINABLE; Policy/deadline approval PENDING; AG06-S03-08 OPEN; Merge NOT AUTHORIZED; Production NO-GO.**

## Primary source review, 2026-11-17

- PostgreSQL 16 lock_timeout, statement_timeout, idle-in-transaction timeouts: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 advisory/table locking: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 pg_stat_activity lock wait events: https://www.postgresql.org/docs/16/monitoring-stats.html
- PostgreSQL 16 wire protocol/COMMIT: https://www.postgresql.org/docs/16/protocol-flow.html
- Node v24 monotonic timer: https://nodejs.org/download/release/v24.11.0/docs/api/process.html
- Node v24.22.3 release (2026-11-11): https://nodejs.org/en/blog/release/v24.22.3
