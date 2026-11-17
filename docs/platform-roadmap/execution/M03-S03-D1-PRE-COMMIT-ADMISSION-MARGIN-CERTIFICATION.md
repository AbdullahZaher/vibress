# M03-S03 — D1 Pre-COMMIT Admission Margin Certification

**Date:** 2026-11-17 (Asia/Riyadh)  
**Agent 02 (PostgreSQL correctness):** **REQUEST CHANGES / BLOCKED**  
**Agent 04 (quantitative evidence):** **MEASUREMENTS SUPPORTED IN DISPOSABLE PG16; NUMERIC ADMISSION M NOT SUPPORTED**  
**This is AI-assisted technical evidence, NOT a human independent DBA or IAM approval.**

## 1. Contract and controlling decision

[Owner Policy A](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6957296137) and [Owner P04](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959358323) approve **FINAL_PRE_DDL** and **D1=2517ms** **ONLY** for one optional mapped scalar ADD_FIELD without default on an existing application-owned table in disposable/development PostgreSQL testing. The owner-approved workload class was the previously benchmarked **single-stressor** laboratory topology, not every newly introduced multi-stressor combination. No production permission, broader topology, new IAM grants or D2 is approved.

T0 begins BEFORE PostgreSQL connect. Synchronous `APPLIED` requires an ACK that is definitive at T13 and definitive success classification at T14, **both <= T0+2517ms**. A successful physical COMMIT after, or acknowledged before but classified after, the deadline does not qualify. T15 cleanup/fenced recovery is mandatory separately and **not** within D1.

**Final proposed pre-COMMIT margin M: `NOT DETERMINABLE`**. The observed values do not justify a guaranteed or statistically credible positive integer across the requested combined fault class. **No new owner deadline is approved.** A later implementation must be fail-closed; the approved 2517ms value must not silently increase.

## 2. Exact source, CI, and independent raw evidence

- Canonical [Draft PR #198](https://github.com/AbdullahZaher/vibress/pull/198): `b5cfc0687076c86a7450a8a785a072f6e63ad289`, unchanged.
- Owner-P04 Policy A [Draft PR #203](https://github.com/AbdullahZaher/vibress/pull/203): `1fb5e1600fd2300d7509ec998ff3b1fa1fff5078`.
- Historical Agent04 [Draft PR #204](https://github.com/AbdullahZaher/vibress/pull/204): `aa8d55f3e6769e877edd371bfeab6e8f5ac16a0a`.
- Previously measured expanded benchmark source `66af2e217b565ae552832a0399b6a96cd3259728`, [CI #44155976796](https://github.com/AbdullahZaher/vibress/actions/runs/44155976796), [raw artifact #14361431684](https://github.com/AbdullahZaher/vibress/actions/runs/44155976796/artifacts/14361431684): 1375 distinct attempts and historical single-stressor samples. Its 109ms reserve included **unverified** 100ms scheduler assumption and was NOT an ACK-admission margin; its own last-run candidate file had reserve=105ms and candidate B=2498ms, distinct from owner P04's retained D1=2517ms based on earlier runs.
- **Final tested combined-fault source `f4948b1e07d584206da8931bed6845d50b124169`** on `experiment/m03-s03-ag02-ag04-d1-combined-fault-20261117`; only test benchmark, test TCP proxy and isolated workflow changed relative to #204; production Operator blob `31b1e862f594434944fec516f768265baf794525`, CLI blob `a0e337680d2a73c1016f60b0506ecfdcf73388c2` and migration 0060 blob `d8b1e50a0a4dd347fde235ae7cb1a12468249719` unchanged.
- Exact [GitHub Actions #44173978347](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347) **SUCCESS in two isolated jobs** ([job #134360270149](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/job/134360270149), [job #134360270467](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/job/134360270467)), PostgreSQL **16.16 / 160016**, Node **v24.22.3**, typecheck/lint PASS and zero fixture DB leaks.
- Independent raw artifacts: [run 1 #14368349717](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/artifacts/14368349717), ZIP SHA256 `9f2bd705a865bddeb1179a5d0fe8ba0456ad63742bdd36c0e34ea03c4fbaa0c4`; [run 2 #14368369399](https://github.com/AbdullahZaher/vibress/actions/runs/44173978347/artifacts/14368369399), ZIP SHA256 `ccd4a39054f4fc408990b3dfd731c0c3ea62186b0eb47e62a3359a95bc80b12b`. Independently re-read **91 unique raw records in each**, full monotonic per-SQL timeline, 182 combined attempts.
- Existing Agent02 [#44167248343](https://github.com/AbdullahZaher/vibress/actions/runs/44167248343) previously PASS 18/18 real PG cancellation/fencing negative repetitions +52 original operator +21 fault tests; this is same operator blob but NOT a deployed D1 supervisor.

## 3. Verified combined-fault outcomes

| Stress class (physical TCP / genuine PG16) | Combined n | Observed highest T14 ms | Definite late APPLIED under unguarded operator |
| --- | ---: | ---: | ---: |
| Real TCP **30ms each way** + extra **200ms COMMIT ACK** | 24 | **2482.7942** | 0 |
| 30ms TCP + 200ms ACK + 25ms deliberate event-loop stall | 10 | **2501.4067** | 0 |
| 30ms TCP + 200ms ACK + read-only CPU pressure in another PostgreSQL backend | 6 | **2477.8728** | 0 |
| 30ms TCP + actual **500ms** table-lock wait | 10 | **2752.7114** | **10/10** |
| 30ms TCP + actual **900ms** table-lock wait | 10 | **3155.3667** | **10/10** |
| 30ms TCP + three sequential real 250ms lock waits | 8 | **2944.4875** | **8/8** |
| 30ms TCP + 200ms ACK + actual 500ms lock (THREE-WAY) | 8 | **2953.0551** | **8/8** |
| 30ms TCP + 200ms ACK + actual 900ms lock (THREE-WAY) | 8 | **3353.4188** | **8/8** |

**44/182** recorded combined attempts physically COMMITTED and returned `APPLIED` **late**, in the old source with no D1 supervisor. This is a reproduced defect / forbidden D1 behavior, not a PASS for the deadline. These joint combinations go beyond owner P04's originally restricted single-stressor class; they must not be silently added to a claim of feasible 2517ms on-time success.

The 30ms+200ms ACK profile succeeded in 24/24 observed attempts, but the minimum remaining time at COMMIT dispatch was **295.767ms**; with an additional 25ms deliberate scheduler stall the minimum fell to **276.933ms** and the maximum observed T14=2501.4067ms, a **15.5933ms** headroom. In each of these narrow sample groups, a p99 is NOT an upper bound. With zero observed late completions among 24 trials, the one-sided 95% binomial upper bound is about **11.73%** under an ideal independent identical-trial model (which repeated warm-cache PG experiments do not fully satisfy), nowhere near evidence for a 1% tail target.

Event loop monitor in the two new runs reported p99 lag **6.4020/6.1276ms** and max **29.3929/29.4257ms**, with deliberate 25ms blocking. This only describes that runner and does not bound future scheduler suspensions or server-side WAL/commit latency.

## 4. Margin computation and false-timeout sensitivity

The best observed relevant 30ms+200ms COMMIT-query/ACK durations were about **262.5ms**; the monitored maximum event-loop lag was **29.4257ms**. A simple sum (~**292ms**, excluding independent classification overhead and model uncertainty) is **NOT** a validated joint worst-case bound, cannot cover unpredictable network partitions, and must not become the signed M without a scoped confidence/SLO contract.

Two explicit **HYPOTHETICAL/UNAPPROVED** threshold sensitivities were evaluated from observed pre-COMMIT timestamps (NOT actual guarded COMMIT dispatches):

| Observational cohort | n | If M=293ms, would deny COMMIT | If M=300ms, would deny COMMIT |
| --- | ---: | ---: | ---: |
| 30ms TCP + 200ms ACK | 24 | 0 | **9** |
| 30ms TCP + 200ms ACK + event-loop25 | 10 | **6** | **9** |
| 30ms TCP + 200ms ACK + 900ms relation lock | 8 | **8** | **8** |

Those additional denials could be desirable safety outcomes for a D1 class that does not promise on-time success for all requests, but cannot be presented as an approved false-timeout rate or a statistically justified M. A hypothetical M=300ms is **only** used in boundary/rollback experiments and is **NOT proposed as final**. Neither 109ms historical cancellation arithmetic nor D1 minus a measured p99 is a robust COMMIT margin. No owner-approved synchronous-success SLO, acceptable false-timeout budget or hard scheduling limit is available for the multi-stressor class.

**Agent04 measurement verdict:** **SUPPORTED: two exact-source repeated real PG16 laboratory runs and their raw empirical timing distributions. NOT SUPPORTED: independent final numeric ACK margin under arbitrary or combined-fault upper bounds.** The measurable benefit is showing the joint feasibility boundary and very narrow timing tail, not selecting a number by assertion.

**Agent02 transaction verdict:** **REQUEST CHANGES**. D1 can be enforced in principle as *admission and classification* by refusing COMMIT and recording `INDETERMINATE`, but **cannot be certified on the current operator** and cannot honestly guarantee on-time APPLIED in the measured late joint profiles. Any implementation claiming T13/T14 compliance must preserve definite transaction outcomes and no-replay behavior.

## 5. Required exact future admission rule

Only after a separately authorized, positive integer `M` justified for a particular topology:

- `D = 2517ms`, `T0 = process.hrtime.bigint()` before connection, immutable; no reset at BEGIN, SQL, cancellation, retry or new session.
- `remaining = D - monotonicElapsedSinceT0`. Before *each* block/DDL/postcondition, deny new work if exhausted and apply dynamic positive PostgreSQL statement and lock caps no longer than the remaining budget minus an approved reserved amount. Maintain existing privilege, catalog and approval restrictions.
- Preserve Policy A's final fresh PG `clock_timestamp()` read AFTER all locks/catalog validation and **immediately** before permitted DDL: no new potentially blocking `SET LOCAL` stage between final authorization and DDL.
- **At pre-COMMIT after successful journal and DDL postconditions, dispatch only if `remainingMs > M`**, never at equality or below. If exhausted or uncertain, do not dispatch. Distinguish **COMMIT attempted by caller** from **COMMIT actually written on wire**.
- `APPLIED` only with definitive T13 ACK and T14 classification by 2517ms. Timely T13 but late T14 = `COMMITTED_LATE` / deadline breach, not D1 APPLIED. Missing or late unproven ACK = `INDETERMINATE` with quarantine; no false `ROLLED_BACK`, no blind ADD_FIELD replay.
- Never treat node-postgres `query_timeout` or `pg_cancel_backend=true` alone as proof of transaction rollback. Require query settlement and acknowledged ROLLBACK **or** conclusive original-backend termination and fresh physical state verification.
- **T15 cleanup/reconciliation is independent of D1**; `D2` not approved.

**Newly confirmed design concern:** existing operator sets `commitAttempted=true` before calling its database client's `query("COMMIT")`. A test-only adapter can refuse before transmitting a COMMIT while the core still returns `INDETERMINATE`, without issuing its normal explicit ROLLBACK branch. That conservative classification is fine, but actual deployment requires separately verified pre-dispatch control, explicit cleanup and backend fencing. The final test-only guard verified original backend disappearance plus fresh physical rollback in **8/8** cases; the test does NOT prove an ACK for a ROLLBACK query, because it did not send one. Do not infer D1-compliant production design from this test.

## 6. Missing approvals and required next evidence

**Remaining technical gaps:** independent real TLS/DNS/RTT and WAL fsync tail variation if such a topology is later requested; sustained CPU/I/O and scheduler stress with larger repeated n; cancellation signal never delivered, watchdog failure, lost rollback ACK; original backend potentially active during a network partition; explicit rollback ACK and fencing RTO for T15; human-approved SLO/false-timeout assumptions and the numeric M; committed-actor-roster deactivation timing under approval A.

**Decision for scope:** **M NOT DETERMINABLE**, no D1 revision in this task. Preserve the original owner-authorized single-stressor class and disclose all multi-stressor incompatibilities. If users need successful synchronous completion under these joint profiles, Agent01 must get a new explicit owner decision to narrow the supported profile, accept measured refusals, or revise the 2517ms deadline after independent specialist/human review. Nobody may silently change it.

Human DBA approval request [Issue #197 #6959199526](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526) remains **PENDING**; human IAM request [#6959197756](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959197756) **PENDING**; independent Agent06 exact integration review **PENDING**.

**Final release gate:** `AG06-S03-08 P2 OPEN` · `AG06-S03-10 P3 OPEN` · `NO INTEGRATED D1 SHA` · `MERGE NOT AUTHORIZED` · `PRODUCTION NO-GO`.

## Official references checked 2026-11-17

- PostgreSQL 16 timeout interactions: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 server signals and authority: https://www.postgresql.org/docs/16/functions-admin.html
- PostgreSQL 16 wire protocol completion/ReadyForQuery: https://www.postgresql.org/docs/16/protocol-flow.html
- PostgreSQL 16 COMMIT durability and WAL behavior: https://www.postgresql.org/docs/16/wal-async-commit.html
- PostgreSQL 16.16 security release dated 2026-11-12: https://www.postgresql.org/docs/release/16.16/
- Node v24.22.3 security release dated 2026-11-11: https://nodejs.org/en/blog/release/v24.22.3/
- node-postgres connection/query timeout defaults: https://node-postgres.com/apis/client
