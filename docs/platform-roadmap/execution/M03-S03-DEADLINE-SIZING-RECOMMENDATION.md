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

**Exact numeric integer: PENDING complete exact-SHA expanded CI and recomputation.** Report empirical exceedance count/denominator, cancellation reserve, tested topology and negative admission outcome. Candidate A is not an approved setting.

## 15. Candidate B: Conservative development/test

**Exact numeric integer: PENDING complete exact-SHA expanded CI and recomputation.** May be preferred for lab if it leaves demonstrated tail headroom and does not hide existing 55P03 lock behavior.

## 16. Preferred Agent04 technical recommendation

**PENDING measured candidates, not an owner authorization.** Must explicitly name the exact lab profile and may not be projected to staging/production without independent topology/SLO and agent signatures.

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

Must retain provenance.json, raw-attempts.jsonl, summary.json, deadline-candidates.json, fault-timing-summary.json, topology-assumptions.json; all contain test SHA and sanitized relative timings. CI must verify expected counts/outcomes and no leaked fixtures before uploading. Exact final execution URL/artifact/exit code to be added after independent validation.

## 22. Implementation and release handoff

Production deadline supervisor is **not** integrated. A future separate, formally approved implementation must start monotonic T0 BEFORE connection, pass remaining time through each awaited phase, reserve time before COMMIT, correctly signal/fence failed backends without asserting rollback from a timer, quarantine uncertain connections, use independent fresh observers after lost ACK, and run full security/integration/fault CI on a new canonical SHA. PR #204 technical sizing alone cannot authorize merging. **MERGE: NOT AUTHORIZED. PRODUCTION: NO-GO.**

## Official references verified 2026-11-17

- PostgreSQL 16 [client timeout configuration](https://www.postgresql.org/docs/16/runtime-config-client.html).
- PostgreSQL 16 [wire protocol and cancellation](https://www.postgresql.org/docs/16/protocol-flow.html).
- PostgreSQL 16 [cancellation interface](https://www.postgresql.org/docs/16/libpq-cancel.html).
- PostgreSQL 16 [locks](https://www.postgresql.org/docs/16/explicit-locking.html).
- PostgreSQL 16 [COMMIT](https://www.postgresql.org/docs/16/sql-commit.html) and [ROLLBACK](https://www.postgresql.org/docs/16/sql-rollback.html).
- Node.js v24 [monotonic process timing](https://nodejs.org/download/release/v24.11.0/docs/api/process.html).
