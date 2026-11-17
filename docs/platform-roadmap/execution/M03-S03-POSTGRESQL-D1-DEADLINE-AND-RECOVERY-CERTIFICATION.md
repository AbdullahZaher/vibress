# M03-S03 — PostgreSQL D1 Deadline and Recovery Certification

**Status:** `REQUEST CHANGES / BLOCKED` — technical DBA review; **NOT** an accountable independent human DBA signature.  
**Date:** 2026-11-17 (Asia/Riyadh).  
**Reviewer:** Agent 02 — PostgreSQL 16 DBA / concurrency / transaction-reliability technical reviewer.  
**Finding:** `AG06-S03-08` **P2 OPEN/BLOCKING**; `AG06-S03-10` **P3 OPEN, REMEDIATION RECOMMENDED**.  
**Owner D1:** **2517 milliseconds; APPROVED for restricted disposable development/test only**.  
**Owner Policy A:** **FINAL_PRE_DDL; APPROVED for the same restricted scope**.  
**D2:** **NOT APPROVED**.  
**Pre-COMMIT safety margin:** **NOT DETERMINABLE** from the evidence, **NOT APPROVED**.  
**Human DBA approval:** **PENDING**; **human IAM approval:** **PENDING**.  
**Canonical integration, merge, production:** **NOT AUTHORIZED / NOT AUTHORIZED / NO-GO**.

## 1. Executive verdict and exact authorization

The [Project Owner P04 decision](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959358323) authorizes **only one existing application-owned table, optional mapped scalar ADD_FIELD without default in disposable PostgreSQL development/test** and chooses `FINAL_PRE_DDL` with **D1=2517ms**. P04 is a **ChatGPT Agent01 relay of the owner's explicit choice**, not an independently authenticated IAM or DBA human GitHub signature. [Policy A owner decision](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6957296137) has the same scope. No production, customer data, multi-stressor production-class service-level objective, new privilege, tenant DDL, D2, or risk acceptance is authorized.

**D1 contract:** the monotonic `T0` must occur BEFORE any PostgreSQL connection acquisition. Only if COMMIT was definitely acknowledged by `T13 <= T0+2517ms` **AND** definitive success was classified by `T14 <= T0+2517ms` may a synchronous `APPLIED` be reported. `T15` physical cleanup/fenced recovery is separate and not required to complete inside D1, but remains mandatory for safety. A late COMMIT ACK does not erase a deadline breach. No client timeout can guarantee that physical PostgreSQL commit finishes within 2517ms after process scheduling or network failure.

**AG02 technical verdict: REQUEST CHANGES.** An independent pre-COMMIT admission margin has not been shown to be safe; the actual operator CLI still has no end-to-end supervisor, so the 2517ms D1 cannot be certified or safely integrated. PostgreSQL cancel/rollback/fencing tests below establish useful restricted safety evidence, not a comprehensive recovery service or human approval.

## 2. Independently verified source and reproducible data provenance

| Item | Verified reference |
| --- | --- |
| Canonical Draft [PR #198](https://github.com/AbdullahZaher/vibress/pull/198) | `b5cfc0687076c86a7450a8a785a072f6e63ad289`; **UNCHANGED** |
| Isolated owner-P04 Policy A Draft [PR #203](https://github.com/AbdullahZaher/vibress/pull/203) | `1fb5e1600fd2300d7509ec998ff3b1fa1fff5078` |
| Agent04 benchmark Draft [PR #204](https://github.com/AbdullahZaher/vibress/pull/204) | `aa8d55f3e6769e877edd371bfeab6e8f5ac16a0a` |
| Previous verified Policy A implementation | `2c31ed9119b88a7aff0ae8bd4c16638294a74cda` |
| Actual unchanged operator blob on #203 | `31b1e862f594434944fec516f768265baf794525` |
| Existing restricted CLI blob | `a0e337680d2a73c1016f60b0506ecfdcf73388c2` |
| Additive migration 0060 blob | `d8b1e50a0a4dd347fde235ae7cb1a12468249719` |
| Agent04 [exact tested run #44155976796](https://github.com/AbdullahZaher/vibress/actions/runs/44155976796) | Benchmark source SHA `66af2e217b565ae552832a0399b6a96cd3259728`; actual synthetic merge checkout `08dd3097ce015c2583b16aba8b18209e9588670f` |
| Agent04 [raw Artifact #14361431684](https://github.com/AbdullahZaher/vibress/actions/runs/44155976796/artifacts/14361431684) | Downloaded ZIP SHA-256 `dc0038d09ef839cf521b94f9133b4123871c01d4149dd60310641d62095b43db` |
| Independently executed Agent02 test-only commit | **`4c7683184161867f69ad35e2f3fca07fcaeaa8a5`** |
| Agent02 [real PG16 CI #44167248343](https://github.com/AbdullahZaher/vibress/actions/runs/44167248343) | **SUCCESS**, Node v24.22.3, PostgreSQL 16.16 / server_version_num 160016, no original operator/migration blob modifications, `DISPOSABLE_DB_LEAK_COUNT=0` |
| Latest reviewed Agent05 technical concurrence | [Issue #197 comment #6959719878](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959719878): restricted conditional technical concurrence, **human IAM approval PENDING**, implementation REQUEST CHANGES |

The Agent04 ZIP was downloaded **as raw bytes** and `provenance.json`, `raw-attempts.jsonl`, `summary.json`, `fault-timing-summary.json`, `topology-assumptions.json`, `deadline-candidates.json` inspected. All **1,375/1,375 raw JSONL records were counted with unique case IDs** and percentile distributions were independently calculated using linear-interpolated sample percentiles. The zip identifies Node v24.22.3, PostgreSQL 16.16 / `160016`, checkout `08dd...`, and source `66af...`. Measurements are the single-process, disposable **GitHub localhost PostgreSQL** class and explicitly simulated TCP delays, NOT TLS/DNS/WAN or representative production.

This report does **not** silently transfer a PASS from the benchmark to the new integrated canonical #198, which has not been created.

## 3. PostgreSQL server and client timeout architecture

**Current exact source:** `BEGIN ISOLATION LEVEL READ COMMITTED`; `SET LOCAL lock_timeout='2000ms'`, `statement_timeout='10000ms'`, `idle_in_transaction_session_timeout='15000ms'`; CLI `connectionTimeoutMillis:4000`, server `statement_timeout:10000`, driver `query_timeout:12000`. The CLI opens the connection **before** invoking `executeApprovedAdditiveColumn(db,request)`, thus existing code does not start a global clock before connection.

PostgreSQL 16's `lock_timeout` bounds lock acquisition per wait; `statement_timeout` bounds statements as processed by the server; `idle_in_transaction_session_timeout` acts only while waiting idle within a transaction. None is the owner's total cumulative 2517ms deadline. `query_timeout` in node-postgres is a client-side control and by itself does not prove server cancellation/rollback. PostgreSQL 16 does **not** supply a native transaction-wide `transaction_timeout`. SET LOCAL does not survive new sessions and is not a cross-session cumulative budget.

**Required nonproduction supervisor contract, AFTER DBA/IAM approval:**

1. Validate immutable request and permitted isolated role/host/database; capture one monotonic `T0`, `deadlineNs=T0+2517ms`, identity, authorization/source SHA and sanitized operation ID **before connection**. Passing an already connected client into the operator without a shared preconnection token is noncompliant.
2. For connection attempts, dynamically clamp `connectionTimeoutMillis` to the remaining positive budget and existing 4000ms ceiling; `0` must **never** be used as a timeout because that can disable the timeout. Connection acquisition can fail-closed after time exhaustion; disposal/recovery is separate.
3. Before each potentially blocking server SQL stage, recompute monotonic remaining time from this **same** absolute deadline, including its watchdog/setup overhead. Program PG-local `lock_timeout` and `statement_timeout` to positive finite bounds **no larger than remaining budget minus a separately approved reserve**, additionally capped by the current 2000ms and 10000ms limits. Never use longer stage timeout to circumvent the global deadline. A client query timeout is only a supplementary detection guard; a server cancellation channel and rollback proof are mandatory.
4. Account for the overhead and transactional effect of `SET LOCAL` itself. Do **not** insert a new, potentially blocking `SET LOCAL` query *between final fresh server `clock_timestamp()` authorization and physical DDL*, which would invalidate Policy A's immediate pre-DDL linearization. Establish settings BEFORE the final authorization query, then independently check the shared monotonic budget immediately before dispatch of DDL and pre-COMMIT.
5. At any pre-COMMIT budget exhaustion, cancel safely on a separately trusted connection targeting the exact authenticated operator backend, await query settlement, verify `ROLLBACK` acknowledgment **or** confirmed original-backend termination, quarantine uncertain sessions and verify the journal/manifest/physical catalog through a trusted fresh session. Do not report `ROLLED_BACK` merely on signal send or TCP closure. No privileged cancel/terminate access to the ordinary runtime role.
6. For COMMIT transmission, require a separately approved pre-COMMIT admission margin **M** and `remainingMs > M`. Do NOT dispatch COMMIT after margin exhaustion; if already transmitted and ACK lost/late, classify `INDETERMINATE`, not definite rollback or on-time APPLIED. A successful ACK received too late is a recorded D1 breach, not successful D1.
7. T15 cleanup and reconciliation must have their **own** audited operational objectives and watchdog escalation procedure; they are not D2 and never reset or extend D1. On `INDETERMINATE` no blind retry of potentially committed DDL.

**Hard guarantee distinction:** A supervisor can enforce software admission and fail-closed classification under supported process scheduling. **No hard remote-server COMMIT or client event-loop scheduling completion guarantee** is possible across arbitrary network partitions, backend failures or suspended client process. The contract must enumerate exactly which assumption triggers `INDETERMINATE` or `HALT_UNRECONCILABLE`.

## 4. Recomputed T0, pre-COMMIT, T13, T14, T15 evidence

From the downloaded **1,375 unique records** (all times milliseconds, relative to one attempt's monotonic T0):

| Agent04 profile | n | pre-COMMIT max | COMMIT-query/ACK max | T14 definite APPLIED max | T15 disposal max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 1,000 | **38.2171** | **0.6033** | **38.6252** | **40.6374** |
| TCP proxy 5ms each direction | 20 | **411.9908** | **11.8688** | **423.0645** | **423.3052** |
| TCP proxy 15ms each direction | 20 | **1138.9253** | **31.5006** | **1170.4493** | **1170.7654** |
| TCP proxy 30ms each direction | 12 | **2225.9849** | **61.7601** | **2287.2219** | **2287.4940** |
| Artificial 60ms COMMIT response delay | 20 | **23.5878** | **60.6626** | **84.1520** | **84.3767** |
| Artificial 200ms COMMIT response delay | 10 | **30.5365** | **200.9490** | **231.5109** | **231.8410** |
| 3 consecutive ~250ms advisory/registry/table waits | 12 | **775.6672** | **0.4224** | **775.9529** | **778.0510** |
| Frozen Candidate B=2517ms normal | 8 | **20.2122** | **0.2492** | **20.4464** | **22.3494** |
| Frozen Candidate B=2517ms 500ms lock | 8 | **525.2178** | **0.4528** | **525.4825** | **527.6027** |

The table uses actual `timeline_ms.stages.commit_acknowledged_query` interval start as T0-to-pre-COMMIT and end as the test's apparent T13 (ONLY on definite successful APPLIED), `result_classified_ms` for T14 and `client_disposed_ms` for T15. They are client-observed query intervals, NOT server-side WAL fsync timing. The COMMIT-lost-ACK profile is **INDETERMINATE**; its wrapper stage times cannot be construed as received COMMIT acknowledgments.

**The owner-selected 2517ms passes 8/8 frozen normal and 8/8 single 500ms lock cases, but this is not a bound under combined faults.** The frozen 4/4 deliberately exhausted D1 attempts refused further COMMIT and required cleanup after the deadline. In the raw artifact, the frozen B exhaustion profile has **T14 failure classification up to 2818.4536ms and T15 cleanup up to 2820.5951ms**, showing that **D2 is neither achieved nor approved**. Their result code is currently generic `UNAUTHORIZED`; no physical journal completion was claimed.

### Important provenance mismatch: reserve from two different data generations

The **actual downloaded final artifact's** `deadline-candidates.json` says **`reserve_ms=105`**, Candidate A **2393ms**, Candidate B **2498ms**, using that run's profile values and an explicitly **unverified 100ms scheduler allowance**. The [owner P04/D1=2517ms record](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959358323) refers to **earlier three-run conservative sizing**, with max 2298.1778ms and reserve **109ms**, yielding `ceil(2298.1778+2*109)=2517`. This **does not revoke or supersede the owner's D1 choice**. It means the historical 109ms was never a measured COMMIT admission margin, and the 105ms/2498ms must not be misattributed to P04's source record. Different source/run and computation bases must remain explicit.

## 5. Mandatory pre-COMMIT admission margin — NOT DETERMINABLE

**Result:** **Pre-COMMIT Margin = NOT DETERMINABLE, evidence LIMITED**.

The available 200ms ACK-delay experiment has only **10** independent narrow localhost attempts, COMMIT-query/ACK observed max **200.949ms**. The separate 30ms-per-direction proxy has only **12** attempts, ACK observed max **61.7601ms**, with T0→pre-COMMIT max **2225.9849ms**. There are **zero combined 30ms-proxy + extra-200ms ACK delay measurements**, no systematic client event-loop scheduling-lag distribution, no WAL flush tail under realistic load, no post-COMMIT ACK loss frequency estimate, and no bounded hard timeout guarantee under network partition or process suspension.

A strictly **illustrative, NOT-measured combination** of these separate maxima would be `2225.9849 + 61.7601 + 200.9490 + 0.0225 = 2488.7165ms`, leaving only **28.2835ms** below owner D1=2517ms, **before** any additional scheduling or workload variance. This arithmetic is **NOT** a guaranteed upper bound, independent-joint percentile, admission margin or a validated supported stress combination. A sample p99 is likewise NOT a worst-case bound. The 109ms historical reserve is related to cancellation/rollback/scheduling assumptions and **cannot be reused as a COMMIT-ACK admission margin**.

**Required decision rule (pending evidence and human DBA approval):** Let `M = measured ACK latency upper operating target + measured event-loop scheduling allowance + documented WAL/network variance + approved classification safety allowance` for the **explicitly supported lab topology and combined stresses**. Dispatch COMMIT only if `D1_remaining_at_dispatch > M`, plus a separate monotonic check after all post-DDL verification/journal work; reject/rollback pre-COMMIT otherwise. `M` must be an exact authorized positive integer based on repeated combined-stressor evidence. If the required `M` is incompatible with 2517ms or an acceptable false-timeout rate, **reject or refer D1 back to the Project Owner for a new decision**, rather than silently relax D1 or weaken authorization.

**Missing tests (specific):** at least replicated real PG16 physical TCP 30ms bidirectional proxy **combined** with 200ms COMMIT response hold and controlled scheduler pauses; simultaneous 500/900ms real ACCESS EXCLUSIVE waits with the approved proxy class; independent event-loop lag during WAL/commit under CPU and I/O pressure; 2517ms admission boundary at `remaining=M-1,M,M+1`; actual on-wire ACK lost/late after COMMIT sent; mixed cancellations while COMMIT is potentially in flight; consecutive repeated attempts from fresh connections with immutable T0; evidence-rich failure rates and tail intervals. Do not present them as tests already passed.

## 6. New independent real PostgreSQL 16 safety tests

Added **six tests** ONLY to `tests/integration/platform-schema-migration-operator.test.ts` on an isolated audit branch; original `platform-schema-migration-operator.ts`, migrations 0059/0060, registry, IAM, SQL renderer and runtime privileges remain byte-identical to source PR #203. Added isolated-branch-only workflow `.github/workflows/ag02-s03-d1-independent-pg16.yml` with exact blob assertions, Node24.22.3, PG16.16, ESLint, root TypeScript checks and original regression suites.

**Exact source/test commit:** `4c7683184161867f69ad35e2f3fca07fcaeaa8a5`; [CI #44167248343](https://github.com/AbdullahZaher/vibress/actions/runs/44167248343) **SUCCESS**.

| ID | Actual PostgreSQL fault injection and checks | Result |
| --- | --- | --- |
| `D1-PG01` | Real blocker holds registry `FOR UPDATE`; observe operator's actual `pg_stat_activity` lock wait; independent test-admin sends `pg_cancel_backend` only to matching PID/database/login/full `backend_start::text`. Require SQLSTATE **57014**, original-transaction ROLLBACK, old registry digest/seed checksum, no physical column or completed journal | **3/3 PASS** |
| `D1-PG02` | Real blocker holds approval-specific advisory transaction key; observe operator real wait; cancel as exact privileged test controller, require **57014**, acknowledged original ROLLBACK, no schema/journal changes | **3/3 PASS** |
| `D1-PG03` | Test-only injected **real PostgreSQL `SELECT pg_sleep(8)` on the operator backend during catalog phase**, observe `Timeout` wait in `pg_stat_activity`; cancel through independently scoped control and verify **57014** + original ROLLBACK + unchanged physical state | **3/3 PASS** |
| `D1-PG04` | Let genuine physical ADD COLUMN + journal INSERT execute in **uncommitted** transaction, then test-only block same backend with real `pg_sleep(8)`, cancel query, assert **57014**, original ROLLBACK and **both catalog and journal reverted** | **3/3 PASS** |
| `D1-PG05` | Real table lock wait, ordinary runtime role **DENIED `pg_terminate_backend` with 42501**, separately privileged admin terminates exact backend and waits until `pg_stat_activity` no longer includes it; original result fail-closed **INDETERMINATE**; fresh admin sees original catalog/manifest/journal | **3/3 PASS** |
| `D1-PG06` | Physical COMMIT completes on **real PostgreSQL**, then test-only adapter holds returned client response beyond **2517ms**. Existing operator returns **APPLIED after D1**; final catalogue/journal contains one valid committed column. Test deliberately **PASSES by demonstrating a real D1 classification gap**, not by certifying D1 compliance | **3/3 PASS (defect reproduced)** |

**Totals:** six cases ×3 runs = **18/18 PASS**, unchanged original and new full operator suite **52/52 PASS**, Agent04 real PG fault suite **21/21 PASS**, **91/91 test executions** (73 distinct definitions, with six deliberately repeated). All runs on disposable PostgreSQL 16.16; actual log confirms `DISPOSABLE_DB_LEAK_COUNT=0`. No production connection, schema migration, privilege grant or secret was touched. **This is not a combined approved-deadline supervisor test.**

**Limitations of the six tests:** tests `D1-PG03/PG04` use an extra real PostgreSQL `pg_sleep` injected by a TEST-ONLY client wrapper, not a physical catalog rewrite or native long-running DDL; the backend cancellation and journal rollback are real. `D1-PG06` holds the *adapter response after an actually acknowledged COMMIT*, not a physical wire-level proxy loss; wire-level ACK-drop coverage remains on prior Agent04 source-pinned fault suite. Neither proves an implementation-level D1 guard.

## 7. Cancellation, acknowledged rollback and backend fencing

**Actual tested cancellation path:**
1. Connection is restricted to a disposable `vibress_s03_*` database. The migration operator's authenticated role is distinct from runtime and actor roles.
2. An independently connected admin observes the operator's exact backend PID, login, database and microsecond-preserved `backend_start::text`, plus actual server wait state.
3. Separate admin issues `pg_cancel_backend`; returned `true` proves only that the signal was delivered, **not** that transaction rollback completed.
4. Original dedicated operator query emits SQLSTATE **57014**, original `executeApprovedAdditiveColumn` catches the error and its own `ROLLBACK` query is acknowledged.
5. Fresh admin independently verifies target column missing, seeded checksum unchanged, registry manifest digest still original, **zero completed journal** for the installation. Only then can this **particular** transaction be reported conclusively ROLLED_BACK.
6. On backend `pg_terminate_backend`, ordinary runtime role was denied **42501**; privileged admin proved exact backend disappeared, then fresh registry/catalog/journal were inspected. The original operator returned **INDETERMINATE** (conservative) rather than false rollback at the time it lost the backend.

**Residual identity/fencing risk:** matching PID + `backend_start` and role/database in one SQL statement significantly narrows wrong-target risk but is **not a formally proven atomic, privilege-minimized production backend fencing service**. Network loss, PID reuse around client/protocol boundaries, an unreachable verifier or a still-active original transaction must force `INDETERMINATE` or `HALT_UNRECONCILABLE`, not unchecked PID signaling or replay. Production watchdog privileges, authn and escalation need an independent IAM/DBA security review. Do NOT grant runtime `pg_signal_backend`, `pg_terminate_backend` or owner DDL rights.

**No cancellation-after-COMMIT dispatch guarantee** is asserted; a signal at that point does not prove whether the COMMIT was already persisted. Physical rollback is only definite when an acknowledged transaction rollback or conclusively terminated, non-committing backend plus consistent fresh database evidence proves that result.

## 8. COMMIT ACK ambiguity and trusted reconciliation contract

**Normal:** definitive COMMIT ACK before D1 and definitive T14 within D1 permits APPLIED after all authorization/manifest/catalog checks, subject to a later independent complete review.

**Unknown/late COMMIT:** `INDETERMINATE` on missing ACK or transport failure after COMMIT was dispatched, or when outcome cannot be proven. An eventual ACK or fresh confirmation may establish a physically committed result, but the original D1 violation remains durable audit evidence. No automatic retry of ADD_FIELD.

**Reconciliation requirements** (new trusted connection, **after proven original-backend completion/fencing**): verify trusted installation/database/role identity and originally approved operation/immutable digest; retrieve registry manifest/digest and completed journal scoped by installation+operation; inspect live catalog owner/column/type/nullability/default/indexes/triggers/constraints and expected seeded-row state; verify exactly one completed journal entry matching expected previous/new digests and operator role; cross-check retained author/approver provenance; compare to pre-operation canonical manifest. Outcomes:
- **COMMITTED:** all expected physical+registry+journal postconditions match and no rival active original transaction can still mutate them.
- **ALREADY_APPLIED:** a subsequent separately authorized invocation observes a matching previously committed operation; not evidence that the original request met D1.
- **ROLLED_BACK:** original transaction conclusively ended without COMMIT and exact original physical+registry+journal state matches.
- **INDETERMINATE:** completion state is not yet provable or original backend may still commit; quarantine and retry **observation only**.
- **HALT_UNRECONCILABLE:** mismatched/partial/multiple journal or catalog state, trust failure, or no usable independent session; alert and manual DBA procedure, no replay.

Previous Agent04 [fault-injection evidence](https://github.com/AbdullahZaher/vibress/actions/runs/44096821073) covers genuine SIGKILL, backend termination, actual broken TCP and on-wire dropped COMMIT response in disposable PG16; it does **not** supply production RTO or mean the current CLI contains D1.

## 9. Recovery and cleanup objectives — separate from D1 and D2

**From downloaded 1375-run artifact:**

| Controlled local fixture | Samples | p50 ms | p95 ms | p99 ms | Max ms | Limits |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Cancellation during table lock: T0→failure/disposal | 20 | 55.9963 | 58.0053 | 61.0300 | 61.7862 | Contains deliberately ~50ms lock wait; not isolated control-signal time |
| Cancellation fixture original ROLLBACK ACK query | 20 | 0.1377 | 0.3540 | 0.3725 | 0.3771 | Only narrow local PG16 transaction cancellation, not recovery RTO |
| After-cancel fresh read-only reconciliation | 20 | 6.2138 | 6.6873 | 6.8877 | 6.9378 | Available local PG16 observer; no network partition |
| Backend termination fixture T0→failure/disposal | 10 | 55.5961 | 56.3663 | 56.4649 | 56.4895 | No proven worst-case termination/network latency |
| Backend termination fresh reconciliation | 10 | 6.2306 | 6.8363 | 6.9605 | 6.9915 | Local only |
| Dropped COMMIT ACK fixture T0→INDETERMINATE | 8 | 21.1974 | 23.3094 | 23.8986 | 24.0459 | INDETERMINATE is correct; not a rollback proof |
| Dropped COMMIT ACK fresh reconciliation | 8 | 5.9993 | 6.2131 | 6.2285 | 6.2323 | Local successfully reachable observer only |
| Deliberate frozen B=2517ms over-budget T15 cleanup | 4 | — | — | — | 2820.5951 | T15 exceeds D1; **D2 not approved** |

Those are independently recomputed raw 1375-sample group summaries, **not production guarantees**. Per-sample cancellation initiation, signal delivery, server 57014 settlement, rollback ACK, identity-check/fencing, quarantine, read-only observer acquisition and verified result must be instrumented separately to establish each process's full p50/p95/p99/max and successes/uncertainties. The aggregated raw profile cannot retroactively prove independent individual substage timing where timestamps are absent.

**Operational proposal (not approved):** treat **T15 independently** as an explicit measured recovery objective with a deadline-breach audit and automated escalation, never as part of D1. Before selecting a finite operational cleanup/RTO threshold, repeat **at least 100** controlled cancel, unavailable-controller, broken connection and backend-termination fault cases under the selected lab profile, measure independent checkpoint times and count uncertain outcomes; include one 200ms delayed COMMIT and proxy transport loss, plus >=30ms-per-direction network. A provisional **laboratory-only measurement target** (NOT a hard SLO) is to keep normal, cancellation + fresh-observer settlement under **100ms measured after fault signal initiation** on pure localhost, **subject to falsification by these additional tests**. It is motivated by narrow observed max ~62ms end-to-end cancellation fixture and ~7ms independent observer, but these are **not** simultaneous per-stage measurements; this number is a hypothesis, **not an approved recovery objective**. No finite hard bound across network partitions can be guaranteed; escalate and halt with `INDETERMINATE/HALT_UNRECONCILABLE` when verification is unavailable.

Human DBA must independently approve realistic measurable T15 cleanup targets, fencing escalation policy, permitted operator unavailability window and recovery RTO. `D2` remains NOT APPROVED.

## 10. SQLSTATE and error taxonomy — AG06-S03-10 (OPEN P3)

| SQLSTATE / evidence | Sanitized intended classification | Required safety action |
| --- | --- | --- |
| `55P03` lock timeout / lock_not_available | `LOCK_TIMEOUT` | Fail closed; ROLLBACK verify; no false IAM denial or automatic DDL retry |
| `57014` PostgreSQL query_cancelled | `QUERY_CANCELED` or `DEADLINE_EXCEEDED` when proven tied to global D1 | Verify query settled + exact ROLLBACK; quarantine if uncertain |
| `40P01` deadlock_detected | `DEADLOCK_DETECTED` | PostgreSQL abort, verify physical/journal consistency; do NOT bypass locks |
| `57P01` backend terminated, lost transport | `BACKEND_TERMINATED_OR_LOST` / `INDETERMINATE` | Independent backend fencing, fresh-session reconciliation |
| `28P01`, `42501`, invalid provenance | `AUTHENTICATION_FAILED` / `UNAUTHORIZED` as applicable | Retain distinct security-audit denial |
| Unknown/lost COMMIT ACK | `INDETERMINATE` | Never infer rollback; no blind DDL replay |
| Catalog/index/trigger/owner/manifest mismatch | `CATALOG_DRIFT`, `JOURNAL_CONFLICT` | Halt and require evidence-based DBA remediation |

Agent04's real lock-timeout fixture produced **10/100 `55P03`** but current operator exposed generic **`UNAUTHORIZED`**. Agent02 verifies this is an **observability/security-taxonomy defect, not proof of unauthorized DDL**; separate error classification and retest with Agent03 and Agent06. Do not echo SQL text, connection strings, secrets or actor personal identifiers in user-visible errors. Do not widen transaction privileges to improve diagnostic classification.

## 11. Lock ordering and previously closed security invariants

Unmodified source operator: `BEGIN READ COMMITTED` → installation xact advisory lock → registry row `FOR UPDATE` → approval-key xact advisory lock → authenticated plan/actor/approval read → table `ACCESS EXCLUSIVE` → locked catalog / effective privilege check → final fresh PostgreSQL `clock_timestamp()` approval validation → one mapped optional scalar DDL → manifest compare-and-swap → completed-only journal → COMMIT. Migration 0060 approval triggers acquire the shared approval advisory key; the operator does **not** take approval-row `FOR UPDATE` itself. This ordering preserves two-session revocation linearization. PostgreSQL external DDL may produce `40P01`, which is to abort fail-closed, never weaken lock safety.

Previously source-pinned independent Agent02 [350/350 repetitions](https://github.com/AbdullahZaher/vibress/actions/runs/44107572462) on exactly the same unmodified operator blob established scope-restricted expiry-on-target-lock, deadlock, catalog drift, and recovery cases. The new independent [#44167248343](https://github.com/AbdullahZaher/vibress/actions/runs/44167248343) reran full **52/52 operator+IAM+expiry and 21/21 actual PG fault tests**, plus 18 additional targeted test repeats. **It did not re-run all 350 historical repetitions** and cannot certify a future implementation SHA.

**IAM dependency flagged by Agent05**: Owner-managed trusted actor roster deactivation **after** initial roster check but **before** final pre-DDL decision has unapproved ordering semantics and lacks a specific two-session negative test. This is a design gap, **not a reproduced exploit**, and must receive IAM and DBA technical decision. `AG06-S03-01...07` previously closed in the narrow existing source; nothing in the test-only branch modifies their fixes.

## 12. Findings and implementation remediation owners

| ID | Severity/impact and exploitability | Evidence/reproduction | Required remediation and re-test | Owner/required verdict |
| --- | --- | --- | --- | --- |
| **AG06-S03-08** | **P2 BLOCKING**, approval/operation time trust boundary; original source delayed DDL across expired approval | Older canonical #198 expiry before target lock; proposed owner-selected Policy A isolated fix verified. New D1 supervisor absent; `D1-PG06` reproduces late APPLIED | Approve exact pre-COMMIT M and separate RTO; implement scoped preconnect clock, dynamic PostgreSQL timeout setting, guarded COMMIT/ACK and independent watchdog. New exact-SHA PG16, original security regressions and Agent06 independent review | Owner + accountable human DBA + IAM + implementer; Agent06 final |
| **AG02-D1-MARGIN-01** | **P2 engineering blocker**, late/ambiguous COMMIT may be reported as timely | 10×200ms ACK holds, 12×30ms proxy runs separately; 109ms engineering reserve not ACK margin; no combined tests | Combined proxy+ACK+scheduling and COMMIT-in-flight failures; measure M, false-timeout behavior, WAL-client timing; reject/revisit D1 if insufficient margin | Agent02 + Agent04, accountable human DBA |
| **AG02-D1-FENCE-02** | **P2 engineering blocker**, wrong backend/replay or incomplete rollback may corrupt migration state | New PG01–05 prove narrow real cancellation/rollback; no deployed scoped independent watchdog or RTO | Fence by verified session identity and original-backend completion, quarantine, trusted fresh catalog/journal/registry reconciliation; negative network/old-backend cases | Agent04 SRE + Agent02 DBA + Agent05 IAM |
| **AG06-S03-10** | **P3 OPEN**, SQLSTATE 55P03 incorrectly presented as UNAUTHORIZED, operational incident classification | Source and Agent04 10 real lock-timeout cases; PG01–04 57014 real cancel also generic UNAUTHORIZED | Sanitized distinct mapping, contract negative tests, no authorization information leakage or automatically retried SQL | Agent03 AppSec + Agent02, Agent06 verify |
| **IAM-ROSTER-LINEARIZATION** | **Severity pending human IAM review**, possible policy ambiguity, not an evidenced exploit | Agent05 technical review #6959719878 notes roster deactivation between verification and final DDL | Explicit policy and two-session roster deactivation negative test; fail closed without expanding rights | Human IAM + Agent05, Agent02 concurrence |

**Dates:** No owner-approved technical remediation due dates or numerical recovery objectives provided. Do NOT invent them. No Critical/High acceptance requested or issued. If evidence remains missing, any future release decision must remain NO-GO.

## 13. Human independent DBA approval request (NOT self-signed)

**Human decision requested on** [Issue #197](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959199526), with a new dated, individually attributable GitHub identity/permalink, exact source SHA, actual DBA authority basis and lab topology:

`DBA DECISION: APPROVE / APPROVE WITH CONDITIONS / REJECT / BLOCKED`

The reviewer must decide independently: scope-limited owner **2517ms D1**, Policy A final pre-DDL check, measured integer pre-COMMIT margin M or rejection; `lock_timeout/statement_timeout` dynamic bounds, watchdog role/credential scope, real `57014` cancellation and rollback proof, `57P01` backend fencing and quarantine, `40P01/55P03` classification, on-wire COMMIT ACK ambiguity, trusted reconciliation, separately measurable T15 cleanup targets, residual risks/expiration and verification methodology. Human IAM decision is also outstanding separately.

**Human reviewer identity: NOT PROVIDED. Authority basis: NOT PROVIDED. Signature/review permalink: NONE. Date of approval: NOT SET. Human DBA verdict: PENDING.** Agent02's technical report must NOT be represented as approval.

## 14. Handoff to implementation team — admission gate

**Current implementation admission: NO** under existing policy. No exact integer COMMIT admission margin, no human DBA or IAM signed concurrence, no approved cancellation escalation/RTO, no safe actual D1 supervisor contract to implement yet. The isolated probe branch is research, not the production code delivery branch.

After attributable human approvals and sufficient combined-stressor evidence, implementer receives a locked contract: `D1=2517ms`, Policy A time linearization, approved exact M, immutable T0 preconnect, fail-closed per-stage remaining budget (including connection), dynamic PG timeout caps with no extra blocker after final approval, trusted independently scoped watchdog, pre-COMMIT admission, T13/T14 D1 classification, T15 cleanup/fencing, loss-of-ACK and stale-backend stop, sanitized SQLSTATE and deadline-breach audit. The implementer then submits a **NEW exact SHA** independently reviewed by Agents 02/03/04/05 and nonimplementing Agent06. Preserve migrations 0059/0060, Plan/Manifest IR v1, RLS and actor provenance, runtime privilege separation, supported SQL renderer and journal atomicity. Full CI, fault tests and rollback rehearsals must run on that NEW source. The canonical PR #198 remains Draft and unchanged until that gate.

## 15. Final formal gate matrix

| Required item | Decision |
| --- | --- |
| Project Owner Policy A / FINAL_PRE_DDL | **APPROVED — RESTRICTED LAB ONLY (P04/P-A)** |
| Project Owner D1 / 2517ms | **APPROVED — RESTRICTED LAB ONLY (P04)** |
| D2 | **NOT APPROVED** |
| PostgreSQL Source Validation | **PASS on exact audited Policy A source + test-only changes** |
| Global Deadline Architecture | **INCOMPLETE — design reviewed, no actual integrated supervisor** |
| Pre-COMMIT Admission Margin | **NOT DETERMINABLE** |
| Admission Margin Evidence | **LIMITED** |
| Cancellation Safety | **PASS in scoped real-PG tests, INCOMPLETE as operational service** |
| Verified Rollback | **PASS in PG01–04 cancellation tests; broader fault coverage INCOMPLETE** |
| Backend Fencing | **PASS for narrow test PID/role/backend_start and real termination; operational gate INCOMPLETE** |
| COMMIT Ambiguity Recovery | **PASS previously in scoped fault tests, full D1 supervisor INCOMPLETE** |
| Cleanup / Reconciliation Objectives | **PROPOSED as research criteria; human approval PENDING** |
| AG06-S03-10 | **ANALYZED / OPEN P3 / REMEDIATION RECOMMENDED** |
| Agent 02 Technical Recommendation | **REQUEST CHANGES** |
| Independent Human DBA Approval | **PENDING** |
| IAM Human Approval | **PENDING** |
| Ready for Deadline Supervisor Implementation | **NO**, pending pre-COMMIT M, signed IAM/DBA recovery/role decisions and follow-up stress validation |
| AG06-S03-08 | **OPEN — P2 BLOCKING** |
| Canonical PR #198 integration | **NOT AUTHORIZED** |
| Merge | **NOT AUTHORIZED** |
| Production | **NO-GO** |

**Risk and rollback:** No production DB, privilege/secret, destructive schema action, release or canonical #198 mutation occurred; only isolated disposable GitHub-hosted PostgreSQL sessions were created and destroyed. `DISPOSABLE_DB_LEAK_COUNT=0`. A separate owner/DBA approved change would require independently verified backups and a tested recovery plan. No High/Critical finding was accepted; there is no production rollback needed.

## 16. Source research (checked 2026-11-17)

- PostgreSQL 16 timeout semantics: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 explicit/advisory/relation locks: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 cancel, terminate, permissions: https://www.postgresql.org/docs/16/functions-admin.html
- PostgreSQL 16 isolation semantics: https://www.postgresql.org/docs/16/transaction-iso.html
- PostgreSQL 16 synchronous/asynchronous COMMIT WAL: https://www.postgresql.org/docs/16/wal-async-commit.html
- PostgreSQL 16 protocol and connection failure: https://www.postgresql.org/docs/16/protocol-flow.html
- node-postgres client and timeouts: https://node-postgres.com/apis/client
- PostgreSQL 16.16 security release (2026-11-12): https://www.postgresql.org/docs/release/16.16/
- Node 24.22.3 security release (2026-11-11): https://nodejs.org/en/blog/vulnerability/november-2026-security-releases/
- Owner P04, original human-DBA request, Agent04 artifact, Agent05 independent review and exact CI linked throughout.

**Final technical decision: REQUEST CHANGES — DBA HUMAN APPROVAL PENDING — AG06-S03-08 OPEN — MERGE BLOCKED — PRODUCTION NO-GO.**
