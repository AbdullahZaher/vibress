# M03-S03 — Final Whole-Operation Deadline Sizing, PostgreSQL Reliability & Authorization Evidence

**Date:** 2026-11-17 (Asia/Riyadh). **Author:** Agent 04 (engineering evidence, not release authority).  
**Final release verdict:** NO-GO. AG06-S03-08 P2 OPEN. AG06-S03-10 P3 error-classification review pending.  
**Canonical:** [PR #198](https://github.com/AbdullahZaher/vibress/pull/198), unchanged b5cfc0687076c86a7450a8a785a072f6e63ad289.  
**Expiry policy:** [PR #203](https://github.com/AbdullahZaher/vibress/pull/203), latest independently seen c373ef12532c5232a8b68003e7fc3344dd464e62.  
**Benchmark:** [Draft PR #204](https://github.com/AbdullahZaher/vibress/pull/204), use its HEAD and completed exact CI artifact as source of truth.  
**Formal owner selection:** Policy A FINAL_PRE_DDL is selected by the human user for the one optional scalar ADD_FIELD in disposable/development environments. This is **not** independent human IAM or DBA sign-off; GitHub relay is not direct human authentication. No owner numerical deadline/SLO has been approved.  
**Independent review:** [Agent06 #5944132056](https://github.com/AbdullahZaher/vibress/pull/198#pullrequestreview-5944132056) REQUEST CHANGES. No integrated canonical deadline supervisor is certified.

## 1. Executive verdict

Agent04 is authorized to measure and issue conditional numeric development/test recommendations only. A client-side elapsed deadline is neither a PostgreSQL server transaction timeout nor a guaranteed physical COMMIT completion bound. Approval and merge remain blocked regardless of measured throughput.

## 2. Exact provenance

Historical benchmark source HEAD 927417d4c804550cec5a18479bcf9ff45450c9db, GitHub synthetic checkout SHA 151f430f5cff2ead7c1b366b803323b47852a375, successful [CI #44140690893](https://github.com/AbdullahZaher/vibress/actions/runs/44140690893), [artifact #14353079852](https://github.com/AbdullahZaher/vibress/actions/runs/44140690893/artifacts/14353079852). New expanded benchmark exact SHA and CI must be taken from its current provenance.json and validated CI run, not assumed from this report's earlier revision.

## 3. Historical raw-evidence validation

Independently decompressed and recomputed three historical GitHub ZIP artifact raw-attempts.jsonl files using NumPy linear percentile interpolation (not quoted from an unverified summary). Each contains exactly 1127 attempts: 1000/1000 normal APPLIED, 90/100 contended APPLIED, 10/100 injected 2200ms lock holds causing PostgreSQL SQLSTATE 55P03 (generic external UNAUTHORIZED), plus 12 artificial 4ms-per-statement delays, 12 large tables with 10002 rows, and 3 warmups.

| CI | Normal p50/p95/p99/max (ms) | Successful contention p99 (ms) |
| --- | --- | --- |
| #44139586272 | 34.7442 / 38.5988 / 43.9495 / 53.4477 | 941.2738 |
| #44139725010 | 18.1891 / 21.1542 / 24.0058 / 42.0199 | 925.1673 |
| #44140690893 | 28.8239 / 32.7747 / 40.5466 / 67.5817 | 934.8830 |

The last run's ALL-outcome contention p99=2015.6543ms includes failures and is not a successful latency percentile. Its localhost COMMIT ACK p99=9.9881ms, maximum 39.0694ms. Historical p99 varies 24–44ms across nominally equivalent hosts.

With 1000 within-run iid resamples (seed 414), descriptive bootstrap 95% p99 ranges were 41.3304–47.2981ms, 22.1476–24.7178ms and 36.7230–43.4555ms. Each is **conditional on that particular warm-cache runner**, not across-run variance or production uncertainty. Zero failures in 1000 independent trials would have a one-sided 95% exact binomial upper bound ~0.299%; independence/stationarity do not hold strictly for recycled DDL on one relation.


### Verified expanded runs (disposable, not production)

| Source | Run 1 | Run 2 |
| --- | --- | --- |
| Exact tested branch HEAD | 9e00ad92e428cb64a7f6d4a86ddb2e38e1943867 | 185afb9ccad8b8ec28a8c6b923a1e69f93d98914 |
| GitHub synthetic merge checkout | 660eb29be9b703ac45eb05d268167b8c4a0f853a | a748ff6a4c52e3488125960f0fc83616cde9d93a |
| Actions | [#44151684946](https://github.com/AbdullahZaher/vibress/actions/runs/44151684946) SUCCESS | [#44151913933](https://github.com/AbdullahZaher/vibress/actions/runs/44151913933) SUCCESS |
| Raw ZIP | [Artifact #14359801508](https://github.com/AbdullahZaher/vibress/actions/runs/44151684946/artifacts/14359801508) | [Artifact #14359611993](https://github.com/AbdullahZaher/vibress/actions/runs/44151913933/artifacts/14359611993) |
| Downloaded ZIP SHA-256 | 1b05095eee693ce1ab943700fdf564d3e6dcdf1b14773731f1cca4da4d107538 | 0249f107edef20e23e9483861a5ddee296681591cc9073aefbf0d0f9474f6941 |
| Runtime | Node v24.22.3 / PG 16.16 (160016) | Node v24.22.3 / PG 16.16 (160016) |
| Real recorded attempts | 1335, unique case IDs 1335 | 1335, unique case IDs 1335 |
| Local normal 1000 APPLIED p99 | 42.1438ms | 45.7440ms |
| Normal COMMIT-ACK p99 | 9.9019ms | 0.886ms |
| Physical TCP proxy 5ms one-way p99 (n=20) | 420.2374ms | 432.163ms |
| TCP proxy 15ms one-way p99 (n=20) | 1172.9078ms | 1184.294ms |
| TCP proxy 30ms one-way p99 (n=12) | 2286.4865ms | 2298.0869ms |
| Network 30ms observed max | 2286.5562ms | 2298.1778ms |
| Approved native ALTER on 900ms/120ms table locks | 90/100 applied | 90/100 applied |
| Controlled >2s locks | 10/100 55P03, no committed journal | 10/100 55P03, no committed journal |
| Three real consecutive 250ms waits p99 (n=12) | 789.1206ms | 795.946ms |
| Delayed COMMIT +60ms query ACK p99 (n=20) | 61.1166ms | 60.791ms |
| Delayed COMMIT +200ms query ACK p99 (n=10) | 201.3809ms | 200.981ms |
| cancel lock wait, SQLSTATE 57014 (n=20) | 20/20 safe verified rollback | 20/20 safe verified rollback |
| cancel-to-final-classification p99 | 4.3479ms | 5.045ms |
| rollback-ACK p99 (canceled, n=20) | 0.2626ms | 0.252ms |
| fresh read-only classification p99 after cancellation | 9.3999ms | 12.036ms |
| backend terminated, SQLSTATE 57P01 (n=10) | 10/10 backend gone, rollback verified | 10/10 backend gone, rollback verified |
| lost COMMIT ACK (n=8) | 8/8 INDETERMINATE then committed independently verified | 8/8 same |
| fresh observer p99 after lost COMMIT ACK | 9.7994ms | 12.307ms |
| Socket refused/authentication failed/blackhole | 8/8 each correctly classified | 8/8 each correctly classified |
| Extra index/CHECK not represented in canonical manifest | 12/12 CATALOG_DRIFT, no DDL journal | 12/12 same |
| Test-only A/B rerun (real 500ms table hold) | A 8/8, B 8/8 successful | A 8/8, B 8/8 successful |
| Test-only forced over-deadline pre-COMMIT rollback | A 4/4 and B 4/4 deny, no journal | A 4/4 and B 4/4 deny, no journal |
| CI | typecheck/lint/Vitest/1335 count/teardown/artifact PASS | typecheck/lint/Vitest/1335 count/teardown/artifact PASS |

**Raw audit:** Both ZIP archives were downloaded and recomputed independently using NumPy linear percentile interpolation; all records had unique case IDs and none contained credential strings, connection URLs, raw SQL, personal actor names or seeded sample content. Both complete runs produced all six required machine-readable artifacts. Initial failures are recorded below and must not be counted as passes.

**Historical failed engineering attempts:** #44150697043, #44150800409, #44150895433, #44150932671, #44151561870, #44151604347 failed because test-only proxy cleanup timing, a source variable typo, and an incorrect expectation that unmodeled indexes/constraints would be accepted. The production operator was NOT changed; CATALOG_DRIFT is the correct fail-closed result. Reruns above proved these issues fixed. The original historical #44139179569 failed ESLint before benchmark. No failed attempt is silently erased or re-labeled passing.

**Authorization limitation:** The owner-selected Policy A is valid for the specified restricted nonproduction policy only, independently from an unapproved numeric deadline. Exact canonical PR #198 still contains the pre-policy code blob 5b323911157fbffca3f48d0bcd604da0312609f8, whereas isolated PR #203 and benchmark #204 use the same proposed Policy-A operator blob 31b1e862f594434944fec516f768265baf794525. None of these benchmark tests deploys a deadline supervisor to the runtime.


### Third independent exact-code evidence — tightening the reserve

[CI #44154251306](https://github.com/AbdullahZaher/vibress/actions/runs/44154251306) **SUCCESS** on benchmark HEAD ff05592c374d512a1526c016acc748f33cf8693f, with synthetic checkout **d8bdc1e293fbb7dc7fe6eea70931ea5b90365539**, [artifact #14361185666](https://github.com/AbdullahZaher/vibress/actions/runs/44154251306/artifacts/14361185666). Independent raw ZIP SHA256 **ec4c25cd193caf4ef21abd625806f21e1a1ac60474e2782712517bedcb891a9b**, **1335/1335 unique** records, clean CI/fixture teardown. PostgreSQL server_version_num 160016, immutable Docker image ID **sha256:3cbd775daa28461ef484ed88ca1e5a5a72ff126e196deeebce6fec764edf1200**, Node 24.22.3.

Run3 normal successful p99 **24.4188ms** (1000/1000); real contended success p99 **926.4373ms** (90/100) with 10 intentional SQLSTATE 55P03; 30ms one-way TCP p99 **2296.6552ms** and maximum **2297.1253ms**, each n12; cancellation20 safe and independent rollback plus classification: cancel-to-classification p99 **7.7803ms**, ROLLBACK ACK p99 **0.3701ms**; 8 ambiguous COMMIT-ACK loss => INDETERMINATE, separate fresh COMMITTED; independent fresh reconcile p99 **6.8595ms**. No false APPLIED from 12 unexpected indexes/constraints.

The newer cancellation tail exceeds Run2's **5.045/0.252ms**; thus retain the **highest reserve across THREE runs**, not the older two-run number: R = ceil(7.7803 + 0.3701 + 100 unvalidated margin) = **109ms**.

Note: the third-run raw timeline reported T15 as a separate clock read slightly after total elapsed_ms in many rows. This was caught by independent raw-data validation and corrected in the subsequent benchmark harness. **Do not treat T15-T0 and the earlier elapsed_ms as bit-identical on Run3; the difference is measurement instrumentation overhead, not PostgreSQL latency.** A frozen numeric-candidate validation run now also asserts T15 equals the reported total for each profile.

## 4. New lab topology

Disposable GitHub ubuntu-24.04 with Node 24.22.3, Docker PostgreSQL 16 (verify full patch in logs), pnpm 11.22.0, real migration 0059/0060, one self-contained PostgreSQL database created at 127.0.0.1:5433 with owner-installed application, distinct authenticated individual AUTHOR and APPROVER, separately restricted OPERATOR and RUNTIME. Genuine canonical plan/manifest, optional mapped scalar ADD_FIELD website without default, physical table and seed checksum. One hot table and repeated admin reset outside measured intervals make it a synthetic microbenchmark, not equivalent to 1000 independently installed customers.

Real TCP proxy binds localhost only and delays actual payload bytes, 5/15/30ms one-way each direction, and optionally COMMIT responses by 60/200ms. No real production DNS/TLS, network hop/packet loss, QPS/pool variance, CPU/IO saturation or geographical RTT is represented.

## 5. Actual workloads

Original 1000 normal + 100 controlled contention remain mandatory every complete expanded run. Added target counts: 20/20/12 socket-level network scenarios at 5/15/30ms, 20/10 delayed COMMIT ACK +60/+200ms, eight each connection refused/bad password/blackhole timeout, twelve three-stage actual PG advisory/row/table waits, 20 real pg_cancel_backend, ten pg_terminate_backend, eight lost COMMIT ACK, twelve 25002-row indexed/constrained negative cases, and 40 synthetic candidate admission/replay trials. Counts and outcomes must be taken only from a successful exact SHA run. Index/constraint additions **not in the approved manifest must fail CATALOG_DRIFT**; they are a security-negative profile, not successful large-table DDL evidence. Do not relax the catalog guard for throughput.

## 6. Unbroken monotonic timeline

T0 request accepted BEFORE new TCP connection; T1 connect requested, T2 connected, T3 BEGIN acknowledged, T4 installation advisory obtained, T5 registry FOR UPDATE, T6 approval-specific advisory fence, T7 ACCESS EXCLUSIVE table lock, T8 catalog/privilege verified, T9 Policy A final clock_timestamp authorized, T10 DDL done, T11 registry CAS/journal inserted, T12 COMMIT dispatched, T13 COMMIT ACK returned, T14 result classified, T15 connection disposed. Commit-confirmed=T13−T0; total lifecycle=T15−T0. For unknown COMMIT, terminal classification and subsequent fresh-session reconciliation are separately timed. Client-observed timings do not reveal server WAL flush timing.

## 7. Network and acquisition

Fresh Client.connect measured inside the total. Test-controlled loopback TCP delay is explicitly an **emulated transport** profile. Client-side application sleeps are distinctly labeled and cannot stand in for packet RTT. Connection refused, authentication failure and blackholed startup have separately timed T0-to-error classifications; a failed connection is not authorization by the schema operator. No DNS/TLS handshake measured.

## 8. PostgreSQL contention

Actual 2s lock_timeout, 10s statement_timeout, 15s idle-in-transaction timeout retained unchanged. Installation/advisory and registry row and ACCESS EXCLUSIVE waits use real independent PostgreSQL sessions and deterministic stage barriers. 3×250ms cumulative waits are not a single statement taking 750ms. The historical 10/100 intentional 55P03 failures cannot be treated as production timeout frequency. Historical 40P01 correctness belongs to a separate audit, not this timed profile.

## 9. COMMIT acknowledgment

Measure COMMIT query dispatch→ACK as one client-observed interval; direct loopback and delayed 60/200ms actual response bytes. A dropped PostgreSQL CommandComplete ACK must result in INDETERMINATE, despite a committed journal/physical DDL on the server. No result may claim APPLIED just because COMMIT was sent, and no late COMMIT may be blind-replayed.

## 10. Cancellation and rollback

The test-only superuser may signal only the verified dedicated operator backend in its own disposable database. Measure signal-dispatch ACK (which is NOT transaction rollback proof), SQLSTATE 57014 query cancellation, rollback ACK, physical column absence, unchanged manifest, empty journal and seeded checksum, plus fresh-session definite classification. Never add pg_signal_backend rights to a production runtime to facilitate the benchmark.

## 11. Backend termination and reconciliation

Backend termination must be verified by missing PG backend PID before declaring that abandoned session unable to commit. On wire ACK loss, independently reconnect to the fixture DB and compare installation manifest digest, exact completed journal/plan digest and actual catalog column. COMMITTED means do not repeat DDL; ROLLED_BACK requires a *new* authorization check, and HALT_UNRECONCILABLE means stop/review. Reconciliation time is measured separately and no fixed production RTO is established.

## 12. Uncertainty

Network cohort n=12–20 and fault cohorts n=8–20 are too small for reliable production 99th-percentile estimates; report descriptive maxima and p99 **as observed**, not guaranteed bounds. Network delay is artificially stable; real TLS, proxies, saturated backend, WAN partitions and high-volume tables may substantially exceed measured durations. Do not sum separate p99 phases or pool successful and rejected lock cases.

## 13. Sizing methodology

The quantitative lab model uses end-to-end successful operation durations, and limits its workload to **one tested latency stressor at a time**: baseline, <=30ms each-direction TCP proxy, <=900ms table lock, 3×250ms sequential real locks, or <=200ms ACK delay. It excludes out-of-contract 2200ms locks and multiple simultaneous worst-case stressors.

Define P = maximum separately computed successful end-to-end p99 among these profiles; M = maximum observed successful end-to-end across these profiles.
Define R = ceil(measured cancellation-to-final-classification p99 + measured ROLLBACK acknowledgment p99 + **100ms unverified event-loop allowance**).
A = ceil(P + R), B = ceil(M + 2×R), both **integer milliseconds**, unapproved and conditional. The 100ms allowance is an explicit illustrative engineering assumption; it is not proven production clearance.
Replay the measured successful durations against A and B, count exceedances, and run real operator test-only monotonic admission with 8 normal and 8 real 500ms relation-lock attempts plus 4 deliberately exhausted budgets for EACH candidate. A test-only query admission check cannot guarantee safe in-flight cancellation or physical commit deadline.

## 14. Candidate A: Performance-oriented development/test

**Exact numerical recommendation: 2408 milliseconds (UNAPPROVED LAB ONLY)**. From the maximum across three independent runs of separately observed profile-specific successful end-to-end p99, 2298.0869ms (30ms each-direction TCP proxy; 12 trials), plus conservative *three-run maximum* cancellation/rollback reserve R=ceil(7.7803ms+0.3701ms+100ms)=109ms, so A=ceil(2298.0869+109)=2408ms. Observed exceedances among 3492 already-measured qualifying successful requests (1164 each of three runs) = **0/3492 (0%)**, an in-sample descriptive count, NOT an independently validated true false-timeout rate. Each prior run tested an additional 8 normal and 8 separate real 500ms relation-lock operations for its own derived A (Run1 A=2392ms; Run2 A=2405ms; Run3 A=2406ms); all passed. Each run also denied four deliberately exhausted budgets before COMMIT, with intact schema/registry/journal. Candidate A has little margin over the observed 2298ms network profile, about 110ms.

## 15. Candidate B: Conservative development/test

**Exact numerical recommendation: 2517 milliseconds (UNAPPROVED LAB ONLY)**. From M=max three-run observed qualifying successful end-to-end duration=2298.1778ms plus twice the maximum measured three-run reserve (2×109ms): B=ceil(2298.1778+218)=2517ms. Observed exceedances on the same 3492 qualifying successes = **0/3492** (in-sample only). The first run separately tested B=2497ms, the second B=2511ms and third-run tested B=2516ms, each with 8 normal and 8 real 500ms table-lock successes, plus four negative deadline exhaustion cases; no completed journal after negative trials. B gives ~219ms above the largest measured success but is not a guarantee that cancellation or physical transaction completion will finish by T15.

## 16. Preferred Agent04 technical recommendation

**Preferred technical recommendation: 2517 ms (Candidate B), CONDITIONAL and UNAPPROVED** for this specific disposable PostgreSQL16.16 / Node24.22.3 / GitHub ubuntu-24.04 lab, with at most ONE of the tested stressors (<=30ms one-way actual TCP byte-delay proxy, <=900ms independent table lock, three serial 250ms locks, or <=200ms extra ACK delay), no production TLS/DNS or persistent high-QPS workload. This maximizes observed margin while keeping a finite budget; Candidate A=2408ms is an option where performance matters more than variance. The distinction is **109ms**, only a small measured laboratory buffer, not proof of cross-environment robustness. Both values have 0/3492 *in-sample* exceedances; 8 normal + 8 actual 500ms lock runs for the **run-specific derived values** per CI confirm the test-only admission path in its own run, but 8 delayed workloads do not establish a p99. A fixed **2517ms** candidate and its **2408ms** alternative are now subject to independent test-only 8 normal + 8 genuine 500ms external relation-lock successes and 4 pre-COMMIT deadline-denial cases **for each candidate** on the benchmark branch; green exact-head CI and raw evidence must be verified before asserting those reruns PASS. No production-like combined network+lock profile has been tested, so this is **not** ready for production implementation.

## 17. SLO and false-timeout assumptions

No approved maximum end-to-end owner latency, acceptable false-timeout rate, cancellation time or RPO/RTO has been supplied. For the restricted model, **illustrative target only**: additional deadline false-timeouts no more than 1% among otherwise successful operations. Observed 0/N does NOT establish <=1% true risk at 95% confidence for small correlated samples. An exhausted pre-COMMIT budget prevents fresh DDL/COMMIT and demands verified rollback/termination or INDETERMINATE quarantine.

## 18. Security boundary

User-selected Policy A means final approval valid at fresh PostgreSQL clock_timestamp after all locks/catalog checks immediately before allowed ADD_FIELD. Expiry strictly afterwards is nonretroactive, but the independent whole-operation budget still applies. Revocation-provenance advisory locks, restricted SQL renderer, native ACL and journal CAS are unchanged. Test proxy never enters production API/worker/CLI source.

## 19. Residual findings

AG06-S03-08 remains **P2 OPEN**: no authorized numeric whole-operation deadline implementation or integrated canonical head. AG06-S03-10 remains **P3 ANALYZED / REMEDIATION RECOMMENDED**: PostgreSQL 55P03 LOCK_TIMEOUT, 40P01 DEADLOCK_DETECTED, 57014 QUERY_CANCELED are currently conflated with generic external UNAUTHORIZED in at least the existing operator path. Create sanitized distinct outcomes with specialist review; do not expose SQL/credentials/actor identities. Real network partition, lost ACK, retry fencing, timeout physical completion, workload distribution and production topology remain unproved.

## 20. Required independent authorities

**Agent01/Owner:** confirm owner SLO and acceptable false-timeout risk, select the exact numeric duration in signed scope-limited record. **Agent02/DBA:** review server locks, cancellation privileges, rollback verification, per-stage timeout caps and COMMIT uncertainty on exact build. **Agent05/IAM:** review Policy A and revocation/expiry under the budget, ensure no privilege expansion. **Agent03/AppSec:** verify test-only isolation, SQLSTATE sanitization and no executable privileged watchdog in runtime. **Agent06:** independent final exact SHA certification on combined authorized policy+deadline source. None is supplied by this Agent04 report.

## 21. Reproduction and raw evidence

Workflow: [.github/workflows/m03-s03-whole-operation-benchmark.yml](https://github.com/AbdullahZaher/vibress/actions/workflows/m03-s03-whole-operation-benchmark.yml). On an **exclusively disposable runner**: install frozen dependencies; start docker compose -f compose.dev.yml up -d --wait postgres; run pnpm --filter @vibress/database typecheck and eslint for test/proxy; then pnpm exec vitest run --no-file-parallelism tests/integration/m03-s03-whole-operation-benchmark.test.ts --testTimeout=900000 --hookTimeout=120000. Workflow tears down disposable Docker volumes; NEVER do this on a shared host.

Must retain provenance.json, raw-attempts.jsonl, summary.json, deadline-candidates.json, fault-timing-summary.json, topology-assumptions.json; each raw timing record is bound to the checkout SHA and observed runtime. Provenance must contain verified PostgreSQL server_version_num and resolved immutable Docker image ID, not a guessed floating-tag digest. All output is sanitized relative timings. CI must verify expected counts/outcomes and no leaked fixtures before uploading. Exact final execution URL/artifact/exit code to be added after independent validation.

## 22. Implementation and release handoff

Production deadline supervisor is **not** integrated. A future separate, formally approved implementation must start monotonic T0 BEFORE connection, pass remaining time through each awaited phase, reserve time before COMMIT, correctly signal/fence failed backends without asserting rollback from a timer, quarantine uncertain connections, use independent fresh observers after lost ACK, and run full security/integration/fault CI on a new canonical SHA. PR #204 technical sizing alone cannot authorize merging. **MERGE: NOT AUTHORIZED. PRODUCTION: NO-GO.**

## Official references verified 2026-11-17

- PostgreSQL 16 [client timeout configuration](https://www.postgresql.org/docs/16/runtime-config-client.html).
- PostgreSQL 16 [wire protocol and cancellation](https://www.postgresql.org/docs/16/protocol-flow.html).
- PostgreSQL 16 [cancellation interface](https://www.postgresql.org/docs/16/libpq-cancel.html).
- PostgreSQL 16 [locks](https://www.postgresql.org/docs/16/explicit-locking.html).
- PostgreSQL 16 [COMMIT](https://www.postgresql.org/docs/16/sql-commit.html) and [ROLLBACK](https://www.postgresql.org/docs/16/sql-rollback.html).
- Node.js v24 [monotonic process timing](https://nodejs.org/download/release/v24.11.0/docs/api/process.html).
