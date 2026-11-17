# M03-S03 — Approval Expiry and Whole-Operation Deadline Decision

**Decision ID:** M03-S03-SDR-AG06-S03-08-2026-11-17-P02
**Decision record first published:** 2026-11-17T19:55:41+03:00 (GitHub commit 36338377fa0dd288f60f97cf6d9b0d9d6ef56475, 2026-11-17T16:55:41Z). **New Project Owner policy decision:** 2026-11-17 (Asia/Riyadh), communicated explicitly in the owner-authored chat directive; exact chat message timestamp and independent GitHub human signature NOT verified. **Whole-operation deadline approval timestamp: NOT SET.**
**Status:** **Policy A SELECTED AND APPROVED BY PROJECT OWNER (direct chat instruction)**; **IAM/DBA independent approvals PENDING**, **whole-operation numeric deadline NOT APPROVED**, **final implementation/release contract BLOCKED**. This is NOT an Agent 06 sign-off or production authorization.
**Finding:** AG06-S03-08, P2 BLOCKING / OPEN
**Canonical PR:** https://github.com/AbdullahZaher/vibress/pull/198 (b5cfc0687076c86a7450a8a785a072f6e63ad289, Draft)
**Isolated Policy A source:** https://github.com/AbdullahZaher/vibress/pull/203 (reviewed implementation SHA 2c31ed9119b88a7aff0ae8bd4c16638294a74cda)
**Tracking and historical proposal:** https://github.com/AbdullahZaher/vibress/issues/197 and issue comment 6953244253
**Independent Agent 06:** https://github.com/AbdullahZaher/vibress/pull/198#pullrequestreview-5942420824 (REQUEST CHANGES)

**Owner decision provenance:** An explicit Project Owner instruction in the current conversation supersedes earlier conditional intent and selects Policy A with exact restricted semantics and scope. It is primary-source owner authorization *for policy selection only*. This GitHub record is relayed by Agent 01; the GitHub comment author/commit author are NOT themselves independent proof that the human owner signed on GitHub. Do not misstate IAM, DBA, deadline, merge, deployment, or production approvals.


## 0. Superseding Project Owner policy decision — 2026-11-17

**Decision ID:** M03-S03-SDR-AG06-S03-08-2026-11-17-P02 / OWNER-POLICY-A-01  
**Authority and origin:** The human user acting as Project Owner expressly stated in the current conversation: **"Decision: APPROVE Policy A — FINAL_PRE_DDL"** and restricted the approval to the single existing optional scalar ADD_FIELD operation. **This is owner approval of security-policy selection only.** Agent 01 is publishing the user's stated decision, **not signing or impersonating the owner**. A separate human-attributable GitHub endorsement is not yet verified; the forthcoming Issue #197 relay permalink is the audit index, not proof of direct GitHub signing.

**Explicitly approved authorization semantics and exact scope:**
- Only one approved optional scalar ADD_FIELD **without default** against an existing application-owned PostgreSQL table, in **development/disposable testing** environments. No CREATE_RESOURCE, tenant-owned DDL, destructive changes, ALTER beyond this operation, production/real-tenant actions or new privileged runtime entrypoint.
- Final authorization must be valid when PostgreSQL **clock_timestamp()** is checked **after** the necessary registry/approval/advisory and ACCESS EXCLUSIVE table locks, authoritative catalog and row checks, **immediately before DDL**.
- Approval expiry or an effectively committed/serialized revocation **before** that final point denies the operation with no physical schema change or completed journal; subject to the existing migration 0060 revocation advisory-lock order.
- Expiry **strictly after** a valid final pre-DDL authorization is **nonretroactive**: it does not automatically void a transaction that later commits. Approval timing and the **mandatory independent whole-operation deadline** must never be conflated.
- Registry compare-and-swap, physical DDL and a completed journal remain transactional/atomic. COMMIT acknowledgment uncertainty still requires a fresh trusted, fenced reconciliation before retry.
- Policy B VALID_THROUGH_FINALIZATION is **not selected**, remains not implemented or approved.

**Security decision risk assessment:** The narrowly bounded design avoids accepting authorization that expires during a table-lock wait; remaining risk includes nonretroactive expiry after final authorization, PostgreSQL table-owner DDL power broader than the renderer, delayed/revoked approval concurrency, and COMMIT uncertainty. These are **not** waived; the finite whole-operation deadline, human IAM/DBA concurrence and exact-source PostgreSQL fault regression remain mandatory. This decision **does not accept any Critical/High security risk**.

**Rollback and change scope:** This is a **documentation-only policy-record change**: no operator execution, DB migration, grant, branch merge or production release. If IAM/DBA rejects the chosen semantics or independent Agent 06 identifies a safety failure, **hold the implementation and amend the decision by a new dated, attributable record**, never retroactively claim successful rollback of executed DDL. PostgreSQL transactional rollback and uncertain-COMMIT reconciliation remain mandatory once implementation is later authorized.

**Release gates after this owner decision:**

| Gate | Verified decision state |
| --- | --- |
| Project Owner — Policy A & restricted expiry/revocation semantics | **APPROVED — directly stated by human user in this conversation (2026-11-17)** |
| Direct GitHub human Owner endorsement | **NOT INDEPENDENTLY VERIFIED** (Agent 01 relay must not be construed as an owner signature) |
| Independent IAM approval (named human, scoped) | **PENDING / MISSING** |
| Independent DBA approval (named human, scoped) | **PENDING / MISSING** |
| Whole-operation finite duration / unit | **NOT APPROVED / NONE** |
| Whole-operation supervisor implementation and deadline negative tests | **BLOCKED / NOT CERTIFIED** |
| PR #198 final integrated SHA and exact-source CI | **NONE / NOT RUN** |
| Independent Agent 06 final verdict | **PENDING; prior REQUEST CHANGES** |
| AG06-S03-08 / merge / production | **OPEN P2 / NOT AUTHORIZED / NO-GO** |

**Required next action:** IAM and DBA independently review this exact owner-selected Policy A contract, with attributable GitHub decision references; DBA and Owner approve an evidence-derived integer whole-operation deadline (milliseconds) only after SLO, representative timing, cancellation and COMMIT-reconciliation reserves are proven. Agents 02/05 may then complete a scoped implementation; no integration/release approval follows merely from this policy selection.

## 1. Verified evidence versus unresolved conditions

- PR #198 at the source SHA above is OPEN/DRAFT/UNMERGED. PR #203's earlier reviewed implementation is 3 commits ahead of canonical and changes exactly the PostgreSQL operator, disposable integration tests, and its proposal document. No approved policy+deadline code has been integrated to canonical #198.
- Proposed Policy A on PR #203 passed full CI #44096822494 (four primary jobs) and the real-PG16 fault suite #44096821073 (21/21). Independent specialist run #44107572462 explicitly checked out the pinned candidate, verified operator blob 31b1e862f594434944fec516f768265baf794525 and migration 0060 blob d8b1e50a0a4dd347fde235ae7cb1a12468249719, and reported 350/350 **repeated test executions** with no disposable DB leaks; these are not 350 distinct scenarios.
- Historical canonical #198 full CI #44066988795 and fault CI #44066988820 passed on the OLD policy; their results do not certify approval expiry race closure or a new deadline.
- Current PG16 operator source (PR #203) specifies SET LOCAL lock_timeout 2000ms, statement_timeout 10000ms, idle_in_transaction_session_timeout 15000ms. CLI additionally specifies connectionTimeoutMillis 4000, statement_timeout 10000, query_timeout 12000. These are PHASE-SPECIFIC ceilings, NOT an aggregate budget. The operator accepts an already-connected ClientBase; it currently has no monotonic whole-operation enforcement.
- In 5 earlier negative external relation-lock waits the canonical implementation incorrectly returned APPLIED after approval expiration (audit run #44070678371). On isolated #203, EXP-01 exercises 5 distinct real PostgreSQL lock-crossing fixtures and EXP-02 proves expiry after a valid final check is nonretroactive. No approved numeric whole-operation deadline or exact-SHA cumulative deadline tests exist.
- PostgreSQL 16.16 is the verified disposable fixture; no production database patch/role state is inferred. PostgreSQL 16 does not provide transaction_timeout; per-statement, lock, and idle timeout controls are insufficient to bound the total transaction including network delays and COMMIT acknowledgement.
- Agent 06's final review #5942420824 independently records REQUEST CHANGES; AG06-S03-08 remains OPEN, AG06-S03-09 P3 CLOSED, previous AG06-S03-01 to -07 CLOSED only for their previously reviewed restricted scope.

## 2. Policy comparison and technical recommendation

| Contract | Policy A: FINAL_PRE_DDL (OWNER SELECTED; IAM/DBA REVIEW PENDING) | Policy B: VALID_THROUGH_FINALIZATION (NOT SELECTED; NOT IMPLEMENTED) |
| --- | --- | --- |
| Authorization linearization | Fresh PostgreSQL clock_timestamp AFTER installation advisory, registry FOR UPDATE, approval advisory, target ACCESS EXCLUSIVE, live catalog/ACL and row checks; IMMEDIATELY BEFORE DDL | Second fresh PostgreSQL approval time check AFTER DDL/CAS/journal, immediately before COMMIT |
| Expiry before the check | DENY, ROLLBACK; no column or completed journal | DENY, ROLLBACK of all transactional DDL/registry/journal changes |
| Expiry strictly after the check | Nonretroactive: valid DDL may finalize even after expiration; deadline still applies separately | Nonretroactive only after finalization check; cannot promise retroactive rollback once COMMIT has been sent |
| Revocation ordering | Under migration 0060's shared approval-specific transaction advisory lock: committed revocation BEFORE operator fence denies; revocation queued AFTER operator fence waits for completion and affects subsequent attempts | Same fencing plus another read; requires separately verified revocation/expiry races |
| Strengths | Explicit, reproducible one-point authorization; five real-PG wait-crossing cases tested; simpler audit/recovery for exactly one bounded operation | Tighter validity window before COMMIT; favors strict approval lifespan |
| Tradeoffs | May commit after approval expiry; only sound if this nonretroactivity and independent deadline are explicitly accepted | May waste completed DDL/CAS work if expiry occurs before last check; additional failure/rollback tests, timeout and post-check COMMIT uncertainty |
| Current evidence | Proposal tested in isolated PR #203; **owner-selected policy**, independently required IAM/DBA approvals and canonical integration PENDING | Not implemented, NOT tested |
| Owner decision | **APPROVED in direct Project Owner instruction, 2026-11-17; scope restricted** | **NOT SELECTED** |

**Owner-approved Policy A restricted scope (not yet executable without IAM/DBA and deadline gates):** one PLANNED optional scalar ADD_FIELD without default to an EXISTING application-owned table in test/development disposable PostgreSQL 16; independently authenticated author, approver and operator; no CREATE_RESOURCE, tenant-owned DDL, destructive operations, default/backfill/rename/type changes, shared/production schema changes or API/worker/plugin DDL entrypoint. Technical recommendation assumes acceptance that expiry strictly after the final pre-DDL timestamp is nonretroactive.

**Policy A owner-approved invariants (specialist/execution gates still pending):**
1. Authorization is valid iff approved_at <= checked_at < expires_at, revoked_at IS NULL, immutable original approval timestamps and authenticated principal/scope/plan/role still match. Use database clock_timestamp(), not transaction_timestamp(), now() or client time.
2. Final authoritative check follows all potentially blocking table/catalog/row locks, immediately precedes bounded DDL; no intervening external blocking step.
3. Migration 0060 approval DML is serialized using the same approval-key transaction advisory lock, with registry row lock ordering preserved. A revocation acknowledged as committed before the lock is acquired is rejected; an in-flight revocation not yet committed is subject to the documented lock order, not caller arrival time.
4. Unauthorized or expired execution has NO physical mutation, registry CAS, or COMPLETED journal; permitted execution records authorizationPolicy=FINAL_PRE_DDL and finalAuthorizedAt; DDL and journal commit atomically.
5. Approval expiry check and total operation deadline are independent; a valid final approval does NOT waive exhausted time budget.

## 3. Whole-operation deadline: proposed semantics but numeric decision BLOCKED

**Approved duration:** NOT APPROVED. **Proposed numeric value:** NOT SET because required representative latency and business SLO are not available. This is an evidence gap, not permission for an unbounded operation.

**Start event proposed:** supervised operator accepts and validates initial request, BEFORE DNS/TLS/connection acquisition, client allocation, BEGIN and PostgreSQL lock waits. Persist a monotonic start from process.hrtime.bigint() or equivalent, one sanitized operation ID and a wall-clock correlation timestamp. Do not use client wall-clock time to judge approval expiry.

**Coverage:** connection acquisition, BEGIN, all fencing/advisory/row/table locks, registry/approval/catalog/privilege checks, DDL, post-DDL validation, manifest CAS, completed journal, COMMIT dispatch, ACK handling, retries (if any), cancellation and reconciliation classification. **No per-stage timer resets the global budget.**

**Proposed immediate-success completion rule:** COMMIT acknowledged before deadline AND valid verified postconditions. Merely initiating COMMIT before the deadline DOES NOT justify synchronous APPLIED. Physical server COMMIT/ACK by a deadline is not guaranteed through partition/crash; the bound is an enforceable *client classification and admission deadline*, not a physical atomic transaction-duration guarantee.

**Before COMMIT transmission:** if budget exhausted or remaining time cannot accommodate a measured safety reserve, do not initiate COMMIT or more DDL; cancel current query, safely ROLLBACK with bounded response and verify termination where possible; if rollback acknowledgement/termination cannot be established, return INDETERMINATE and quarantine connection. Never present an attempted rollback as proven.

**After COMMIT transmission:** at budget exhaustion, missing/late ACK, disconnect, backend kill or watchdog uncertainty => INDETERMINATE; never ROLLED_BACK by inference and never blindly retry. Reconcile with a fresh trusted independent connection only AFTER fencing or confirming the original backend transaction cannot later commit. Matching committed manifest+catalog+one completed journal => COMMITTED/ALREADY_APPLIED; conclusively old state with no in-flight transaction => ROLLED_BACK and fresh authorization needed; mixed/inaccessible/unfenced => HALT_UNRECONCILABLE with no retry. Late ACK can amend durable evidence of actual COMMIT outcome but does not erase a deadline breach.

**Required enforcement:** one scoped supervisor/watchdog independent from the blocked connection; per-phase remaining-time checks, PG session-local lock/statement/idle ceilings and node-postgres connection/query timeouts; finite cancellation escalation for a verified dedicated operator backend only; destroy/evict uncertain sessions; never extend runtime roles with pg_terminate_backend or DDL grants. PostgreSQL SQLSTATE 55P03, 57014, 40P01 and network failure must have distinct sanitized error classifications.

### Measurement plan necessary to approve an exact value

1. Owner and DBA supply **reference DB topology, representative schema/table sizes and row counts, expected operator concurrency/contending DDL, network/TLS path, latency SLO and permissible abort/recovery window**. No production connection required: reproduce representative setup in a disposable isolated PG16.16 lab with current role boundaries.
2. Instrument in the operator supervisor BEFORE connection: stage start/end monotonic offsets for each SQL statement, connection/DNS/TLS wait, advisory/table lock wait from pg_stat_activity, catalog and DDL, journal, COMMIT send/ACK, backend termination and fresh-connection reconciliation; record final end-to-end elapsed, result and source SHA with no secrets.
3. Repeat representative normal operations sufficiently to observe tail latency (recommended measurement target >=1,000 normal attempts per agreed topology) and at least 100 independently controlled contention cases plus per-stage connection-loss/COMMIT-ACK/watchdog failures; publish p50/p95/p99, max, lock-wait distribution, clock skew diagnostics, timeout error counts, cancellation/rollback latency and recovery RTO. Test zero-delay and deliberate 2s contention, cumulative small waits, delayed TCP/COMMIT.
4. Derive a finite proposed whole-operation budget (integer milliseconds) from measured p99, defensible environmental variance and time reserved for pre-COMMIT rollback/COMMIT ACK, constrained by the owner-approved SLO. Validate its behavior under overload and fault tests. Record precisely the chosen number, acceptable false-timeout rate, supported request-size/operation limits and DBA-reviewed per-phase timeouts.
5. Obtain owner+IAM+DBA concurrence with the exact number, start/completion semantics, failure policy and residual risk. If no SLO or representative latency evidence, status remains PENDING; do not substitute an arbitrary multiple of the existing 2s/10s/15s controls.

**Observed timings are not a sufficient deadline baseline:** prior ~1.1s approval-expiry fixtures, one 2.008s lock-timeout negative, Vitest suite duration (fault 21 tests ~5.67s and repeated runs ~3–17s), and 4s client connection setting measure separate artificial/test activities rather than whole-request p99/COMMIT acknowledgments.

## 4. Required verifications before implementation approval

- Timing: expiry before initial read, during each advisory/table lock, exactly at boundary (deny), after final Policy-A check (nonretroactive), tampered timestamp, concurrent revocation, out-of-order locks, external catalog DDL.
- Cumulative budget: start pre-connect; delayed DNS/TLS/connect; multiple individually sub-timeout SQL calls that exceed total; slow row/count/DDL; cancel during locks and after DDL; insufficient COMMIT reserve; no new DDL/COMMIT when deadline exhausted.
- Outcomes: SQLSTATE 55P03/57014/40P01; failing ROLLBACK; SIGKILL, TCP failure, watchdog failure, unknown backend; late/lost COMMIT ACK; no false APPLIED or false ROLLED_BACK, no blind replay; fresh-session fence and journal/catalog/registry reconciliation.
- PG16 migration 0059/0060 fresh-install, replay/upgrade and revocation trigger integrity; identity/privilege enforcement, no runtime DDL, table ownership/RLS and checksums; at approved new source SHA run typecheck/lint/explicit-any/unit/integration/fault CI/browser/container gates. Agent 06 final independent nonimplementing review after freeze.

## 5. Formal authorization register — no self-signature

| Required authority/decision | Actual status and evidence |
| --- | --- |
| Accountable Project Owner: selects A or B and scope | **APPROVED Policy A** by direct Project Owner decision in conversation on 2026-11-17; expressly accepts nonretroactive expiry after valid final authorization and restricts to one optional scalar ADD_FIELD without default on existing application-owned tables in disposable development/test only. A human-posted GitHub signature remains unverified; Agent 01 relays the decision. **Numeric duration NOT APPROVED.** |
| Designated human IAM authority: approval/revocation and provenance semantics | **MISSING / NOT NAMED**. Agent 05's proposed code and technical report are NOT a qualified human signature. |
| Designated human PostgreSQL DBA: deadline, locks, recovery, rollback and server constraints | **MISSING / NOT NAMED**. Agent 02's 350 repeated executions are evidence, NOT a human release sign-off. |
| Agent 06 independent certification on combined final SHA | **PENDING**. Existing review #5942420824 states REQUEST CHANGES. |
| Approved Policy A/B | **Policy A — Project Owner APPROVED (direct instruction), independently co-signed IAM/DBA PENDING**. Policy B NOT SELECTED. |
| Approved authorization linearization point | **Project Owner APPROVED for Policy A**: PostgreSQL clock_timestamp after all necessary locks and catalog verification, immediately pre-DDL; independent IAM/DBA review remains mandatory. |
| Approved whole-operation deadline value/unit | **NONE / NOT SET**. |
| Approved start/completion/cancellation/reconciliation semantics | **NONE** (proposed, NOT authoritative). |
| Actual authorization timestamp and identities | **Project Owner decision dated 2026-11-17 in current chat; exact chat timestamp and a direct GitHub human signature not verified.** IAM/DBA identities and approval timestamps MISSING. |
| Current merge / production decision | **NOT AUTHORIZED / NO-GO**. |

**Remaining accountable decision form (publish and link in Issue #197):** Project Owner selection of Policy A, exact restricted DDL scope and nonretroactive post-check expiry semantics are **now satisfied by the direct user decision**. For complete implementation authorization, obtain owner-approved integer whole-operation duration/unit after representative measurement, explicit ACK-before-deadline success classification and safe cancellation/INDETERMINATE/fenced reconciliation; designate IAM/DBA humans by verifiable account/role and collect independent, dated concurrence. Require direct owner GitHub endorsement if independently attributable signing is necessary for this governance workflow. If any remaining requirement fails, retain BLOCKED. Do not treat the earlier conditional intent as the current decision or infer approval of absent items.

## 6. Handoff and residual risk

**Implementation contract:** BLOCKED despite the verified owner policy choice; an evidence-derived finite deadline and IAM/DBA concurrence (plus any required attributable owner GitHub endorsement) are outstanding. After that, brief Agents 05/02/04 with the invariants above and new numeric budget, mandate nonproduction-only implementation and negative tests; integrate the exact narrow delta into canonical PR #198, freeze a new SHA, run CI and independent Agent 06 review. No code on PR #198 is modified or certified by this decision proposal.

**Residual risks:** operator table ownership can confer broader native DDL power than the renderer; shared database service identities cannot attest a human; hard transaction/ACK timing cannot be guaranteed under network partition; external DDL deadlocks; partial supervisor failure; off-transaction denied-attempt audit, backup/PITR and production RBAC remain outside current approval. These risks are NOT accepted for a production release.

**Final state — updated 2026-11-17 after explicit owner instruction:** Policy A **OWNER APPROVED; IAM/DBA PENDING**; Deadline Value **NOT APPROVED**; Deadline Semantics **DEFINED AS PROPOSAL / NOT APPROVED**; Owner chat decision **RECEIVED; direct GitHub human sign-off not independently verified**; IAM/DBA approvals **MISSING**; Implementation Contract **BLOCKED**; AG06-S03-08 **OPEN**; Merge **NOT AUTHORIZED**; Production **NO-GO**.

## Official sources (reviewed 2026-11-17)

- PostgreSQL 16 session/lock/statement/idle timeouts: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 clock_timestamp versus transaction_timestamp: https://www.postgresql.org/docs/16/functions-datetime.html
- PostgreSQL 16 transaction and advisory locking: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 COMMIT: https://www.postgresql.org/docs/16/sql-commit.html
- PostgreSQL 16 wire protocol, cancellation and synchronization: https://www.postgresql.org/docs/16/protocol-flow.html
- PostgreSQL operational recovery/unknown commit: https://wiki.postgresql.org/wiki/Operations_cheat_sheet


## 7. Final Agent 04 measured evidence — source-pinned assessment (2026-11-17)

**This Agent04 benchmark section predates the Project Owner's explicit Policy A approval and preserves historically accurate measurement status. It DOES NOT approve any numeric timeout, IAM/DBA authority, merge or production.** Policy A / FINAL_PRE_DDL is now owner-selected for the restricted test/development ADD_FIELD operation. Policy B remains unimplemented and unselected. No security-risk acceptance.

### 7.1. Exact provenance and independently recomputed samples

- Agent 04 **benchmark-only** Draft PR #204 HEAD: `927417d4c804550cec5a18479bcf9ff45450c9db`, based on Policy A PR #203 HEAD `6bf94cc45babd7c73593295900d791a2f03f7a72`; canonical #198 remains `b5cfc0687076c86a7450a8a785a072f6e63ad289`. No runtime operator or migrations changed in benchmark-only PR #204.
- [Final SUCCESS CI #44140690893](https://github.com/AbdullahZaher/vibress/actions/runs/44140690893), **actual checkout synthetic merge** `151f430f5cff2ead7c1b366b803323b47852a375`. Both that checkout and PR #204 HEAD have identical Git tree `1f750b6a4a5009328e29adfb2317c881e88a069d`; synthetic merge parents are `6bf94cc45babd7c73593295900d791a2f03f7a72` + the benchmark HEAD. Actual compiled operator blob `31b1e862f594434944fec516f768265baf794525` and 0060 migration blob `d8b1e50a0a4dd347fde235ae7cb1a12468249719` match the previously evaluated isolated Policy A source.
- [Raw artifact #14353079852](https://github.com/AbdullahZaher/vibress/actions/runs/44140690893/artifacts/14353079852): independently downloaded and parsed `provenance.json`, `summary.json` and **1,127** complete records in `raw-attempts.jsonl`. Source SHA, checkout SHA, group counts, SQLSTATEs and p50/p95/p99 were recomputed from individual sample values using linear-rank interpolation and matched published summary. **Node v24.22.3**, **PostgreSQL 16.16 / 160016**.
- **Measured topology:** GitHub-hosted Ubuntu 24.04 runner and disposable localhost PostgreSQL via Docker, single repeatedly reset warm application-owned relation, small seeded database with an additional 10,002-row profile; fresh operator connection per attempt; elapsed timer `process.hrtime.bigint()` begins **before connection** and ends after result classification and disconnect. No real remote DNS/TLS, cross-region network or production lock/concurrency distribution. Artificial 4ms client-scheduling delays are NOT network RTT.
- [Benchmark technical report](https://github.com/AbdullahZaher/vibress/blob/927417d4c804550cec5a18479bcf9ff45450c9db/docs/platform-roadmap/execution/M03-S03-WHOLE-OPERATION-DEADLINE-BENCHMARK.md) includes two earlier successful runs, where nominally comparable normal p99 differed **43.9495ms** versus **24.0058ms**, illustrating environment variance. Final run normal p99 **40.5466ms**; these are *local test distributions*, not service SLOs.

| Final raw cohort | Count | Outcomes | p50 elapsed | p95 elapsed | p99 elapsed | Max elapsed |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Uncontended normal | 1,000 | 1,000 APPLIED | 28.8239ms | 32.7747ms | **40.5466ms** | 67.5817ms |
| Forced target-table contention: all attempts | 100 | 90 APPLIED; **10 UNAUTHORIZED / 55P03** | 152.5794ms | 2014.7070ms | **2015.6543ms** | 2015.6817ms |
| Forced contention: successful only | 90 | 90 APPLIED | 152.4219ms | 933.2852ms | **934.8830ms** | 936.2862ms |
| Artificial 4ms delay per SQL | 12 | 12 APPLIED | 170.8221ms | 172.6520ms | 172.8886ms | 172.9477ms |
| 10,002-row synthetic fixture | 12 | 12 APPLIED | 31.8996ms | 34.7898ms | 36.8220ms | 37.3301ms |
| Warmup (excluded from normal distribution) | 3 | 3 APPLIED | 33.2731ms | 35.8164ms | 36.0425ms | 36.0990ms |

Additional **localhost-only stage evidence** on normal workload: connection p99 **5.3897ms**; physical ADD_FIELD p99 **0.7646ms**; COMMIT request-to-ACK p99 **9.9881ms**, observed maximum **39.0694ms**. The 10 forced lock-timeout failures had measured `ROLLBACK` query ACK maxima **0.2864ms** across that cohort, but this does NOT quantify cancellation, backend-termination, unknown-commit reconciliation or recovery reserves. PostgreSQL generated **55P03** in 10 forced ~2.2s lock-wait cases against the existing 2s per-lock setting; the operator currently maps them to external **UNAUTHORIZED** — a reliability classification defect to be reviewed by Agents 02/03 (not evidence of a permission bypass).

### 7.2. Explicit finite-duration sensitivity comparison — NONE SELECTED

**The following 1,000ms / 2,500ms / 5,000ms are numerical *what-if thresholds* to communicate measured margin, NOT formal proposed/approved deadlines.** “Observed above threshold” counts are raw recorded elapsed durations, not runs of an implemented whole-operation deadline, and **cannot estimate a production false-timeout rate**. A delay may occur during any particular phase, changing cancellation, commit and recovery semantics.

| Illustrative whole-operation threshold (not proposed for approval) | Measured normal p99 | Successful forced-contention p99 | Headroom above successful contention p99 (local only) | Recorded attempts exceeding threshold (normal / 100 forced-contention) | Expected false-timeout rate | Cancellation reserve | COMMIT uncertainty handling | Owner operational SLO |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| 1,000ms | 40.5466ms | 934.8830ms | 65.1170ms | 0/1000 ; 10/100 (all ten already failed 55P03) | **UNKNOWN** | **NOT MEASURED** | INDETERMINATE after COMMIT sent; no bound proven | **MISSING** |
| 2,500ms | 40.5466ms | 934.8830ms | 1565.1170ms | 0/1000 ; 0/100 (10 still fail 55P03) | **UNKNOWN** | **NOT MEASURED** | INDETERMINATE after COMMIT sent; no bound proven | **MISSING** |
| 5,000ms | 40.5466ms | 934.8830ms | 4065.1170ms | 0/1000 ; 0/100 (10 still fail 55P03) | **UNKNOWN** | **NOT MEASURED** | INDETERMINATE after COMMIT sent; no bound proven | **MISSING** |

**Verdict: NO RESPONSIBLE NUMERIC RECOMMENDATION YET.** Neither multiplying local p99 by a safety factor nor adding 2000ms lock timeout + 10000ms statement timeout + 15000ms idle timeout yields an enforceable/global operation deadline. In particular, one rejected lock wait already consumes ~2 seconds, client connection timeout alone is configured at up to 4 seconds in the existing CLI, and real cancellation/COMMIT-failure recovery time is unavailable. The preexisting per-query and idle limits are not a whole-operation guarantee, as confirmed by official PostgreSQL 16 docs.

### 7.3. Related Agent 02 + 05 cancellation experiment — NOT a deployable budget

A separate [test-only report](https://github.com/AbdullahZaher/vibress/blob/docs/m03-s03-unapproved-deadline-evidence-20261117/docs/platform-roadmap/execution/M03-S03-AG05-AG02-UNAPPROVED-WHOLE-OPERATION-BUDGET-EXPERIMENT.md) documents experimental SHA `eef874f69924cf25223ad1290e0cc958fa46e3e8` and [CI #44140361447](https://github.com/AbdullahZaher/vibress/actions/runs/44140361447): 25/25 targeted repeated deadline negatives, 51/51 operator and 21/21 real PostgreSQL fault cases, combined 97/97 test executions PASS. The 1ms, 600ms, 700ms and 1200ms in that suite are **test-only thresholds**, not selected timeouts. This experimental source **is not wired into the production operator CLI**, does not establish production watchdog/cancel authority, representative topology, bounded recovery RTO, or owner-approved SLO. Preserve for specialist design; do not copy its CI success onto canonical PR #198.

### 7.4. Proposed execution-deadline semantics and required missing evidence

**Time zero:** the supervised operator accepts/validates the operation request BEFORE DNS/TLS and opening the PG connection. Use a monotonic `process.hrtime.bigint()` budget with a single immutable correlation ID, track connection/BEGIN, all lock waits and catalog/approval queries, DDL, CAS, journal, COMMIT dispatch and ACK, classification and cancellation/reconciliation. PostgreSQL fresh `clock_timestamp()` still independently decides whether approval is valid at the Policy A final authorization point.

**Immediately successful `APPLIED` requires authenticated COMMIT ACK received within the approved budget**, plus verified transaction preconditions; merely sending COMMIT before expiry of budget is insufficient. A transport failure cannot guarantee physical PostgreSQL commit or rollback by that deadline. When remaining budget is insufficient for an approved measured rollback/commit reserve, send no further DDL/CAS/journal/COMMIT. Cancel bounded queries using independently authenticated watchdog scoped to the verified backend; prove ROLLBACK acknowledgment / backend termination before asserting `ROLLED_BACK`. SQLSTATE 55P03 (lock timeout), 57014 (cancel/statement timeout), 40P01 (deadlock), driver/network errors and authorization denial must be distinguished in sanitized audit. At or after COMMIT dispatch, any lost/late ACK => `INDETERMINATE` until trusted fresh-session fencing and journal+catalog+registry reconciliation; **never** infer rollback from cancellation or blindly retry DDL. Loss of watchdog/observer/backend identity => `HALT_UNRECONCILABLE` or INDETERMINATE, not false APPLIED. Abort/rollback and recovery must be tested even when the actual wall clock exceeds the client result deadline.

**Missing evidence required before numeric selection and signoff:**

1. Accountable **Project Owner's operational SLO**, permitted false timeout rate, expected operator concurrency, current approved internal topology versus future production topology, and acceptable network or remote/TLS path. Owners must explicitly declare whether the threshold is for the restricted disposable-only operation or a separately governed production-class contract.
2. DBA + Agent 04: representative PG16 large tables, catalog/ownership distributions, real remote/pooled connection/TLS/RPC latency, advisory and table-lock contention distribution, and p99/max across separate runners/workload days. Evidence needs exact source SHA, tool version, 0059/0060 replay, reproducible raw sample provenance and cleanup.
3. DBA + Agent 05: measured *separate* cancellation request-to-settlement, watchdog escalation, verified backend termination, rollback acknowledgment, and **fresh-session fenced reconciliation** p95/p99 and worst controlled cases. Include cancellation during table/advisory/DDL/CAS; loss of cancel channel, deadlock and multiple near-timeout queries. Existing 0.2864ms simple ROLLBACK query round-trip is NOT this.
4. DBA + Agent 04: measure COMMIT request/ACK through a representative network plus intentionally delayed/LOST ACK and late ACK, process death, network partition, and classification. Prove once-issued COMMIT is never called definite rollback, and that no DDL is blindly replayed.
5. Independent IAM Security Authority reviews Policy A timestamp/revocation serialization after the final lock; independent DBA Authority chooses explicit integer ms, role/back-end watchdog boundaries and rollback/COMMIT reserve. Agent 03 reviews error classification and leak-free measurements, then independent Agent 06 revalidates final approved integrated source.

### 7.5. Formal accountable decision and signed implementation handoff

| Decision field | Current status / evidence |
| --- | --- |
| **Policy A / FINAL_PRE_DDL** | **PROJECT OWNER APPROVED by explicit chat decision; independent IAM/DBA approvals PENDING** |
| Policy B | Not selected, not implemented |
| Approved milliseconds | **NOT APPROVED / NONE** |
| Whole-operation semantics | **DEFINED IN THIS PROPOSAL, NOT AUTHORIZED** |
| Owner SLO and projected production false-timeout rate | **MISSING / UNKNOWN** |
| Project Owner formal Policy A and numeric deadline sign-off | **Policy A OWNER APPROVED** in direct chat on 2026-11-17; **numeric deadline NOT APPROVED**; independently attributable GitHub human signature unverified |
| Identified independent IAM Security Authority and signed decision | **MISSING** |
| Identified independent PostgreSQL DBA Authority and signed decision | **MISSING** |
| Production or representative-network cancellation / COMMIT / recovery latency | **INCOMPLETE** |
| Approved integrated implementation SHA | **NONE** |
| Focused independent Agent 06 certifying policy + deadline | **MISSING**; prior review #5942420824 REQUEST CHANGES |
| Agent 02/03/05 experimental or specialist technical data | **AVAILABLE ONLY as marked historical/test-only; not signatures** |
| **Implementation contract** | **BLOCKED** pending an exact authorized numeric threshold and signed policy |
| **Finding AG06-S03-08** | **OPEN / P2 BLOCKING** |
| Merge / production | **BLOCKED / NO-GO** |

**Owner policy selection and exact scope are provided directly by the Project Owner in chat dated 2026-11-17; the authenticated legal identity / independent GitHub human signature and exact original message timestamp are NOT independently verified. IAM/DBA approver identities and approval timestamps, and the numeric deadline value, remain MISSING.** Request individually attributable authorization on [Issue #197](https://github.com/AbdullahZaher/vibress/issues/197): Project Owner selects A (explicit nonretroactive expiry after final pre-DDL) or B; states supported internal environment, desired maximum user-visible latency/SLO and accepted false-timeout ceiling; designated human IAM authority accepts approval/revocation protocol; designated human DBA authority records reproducible benchmark/source and measured operational margin including cancellation and COMMIT ambiguity, then recommends an **integer duration in ms** for formal Owner acceptance. On approval, amend this document **with real dated GitHub references** (not inferred signatures), issue Agents 05/02 a numeric and testable implementation contract, freeze new canonical #198 SHA, retest, and require Agent 06 independent technical verdict.

**Timestamp of this benchmark reassessment:** 2026-11-17, Asia/Riyadh. This addendum does not modify operator code, migrate a database, grant privileges, close an issue, merge a PR, or authorize production deployment.

**Official technical references inspected 2026-11-17:** [PostgreSQL 16 client timeouts](https://www.postgresql.org/docs/16/runtime-config-client.html), [live clock_timestamp](https://www.postgresql.org/docs/16/functions-datetime.html), [relation/advisory locking](https://www.postgresql.org/docs/16/explicit-locking.html), [COMMIT semantics](https://www.postgresql.org/docs/16/sql-commit.html).
