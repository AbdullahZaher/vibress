# M03-S03 — Approval Expiry and Whole-Operation Deadline Decision

**Decision ID:** M03-S03-SDR-AG06-S03-08-2026-11-17-P02
**Decision date (proposal):** 2026-11-17, Asia/Riyadh
**Status:** PROPOSED / PENDING ACCOUNTABLE APPROVAL — NOT AN APPROVED EXECUTION CONTRACT
**Finding:** AG06-S03-08, P2 BLOCKING / OPEN
**Canonical PR:** https://github.com/AbdullahZaher/vibress/pull/198 (b5cfc0687076c86a7450a8a785a072f6e63ad289, Draft)
**Isolated Policy A source:** https://github.com/AbdullahZaher/vibress/pull/203 (reviewed implementation SHA 2c31ed9119b88a7aff0ae8bd4c16638294a74cda)
**Tracking and historical proposal:** https://github.com/AbdullahZaher/vibress/issues/197 and issue comment 6953244253
**Independent Agent 06:** https://github.com/AbdullahZaher/vibress/pull/198#pullrequestreview-5942420824 (REQUEST CHANGES)

**Owner intent:** The Project Owner has expressed consent conditional on verified passage of required checks; this is NOT a scope-specific signed choice between Policy A/B, NOT a numeric deadline decision, and NOT IAM or DBA sign-off. Do not use this file as a credential, human signature, or release authorization.

## 1. Verified evidence versus unresolved conditions

- PR #198 at the source SHA above is OPEN/DRAFT/UNMERGED. PR #203's earlier reviewed implementation is 3 commits ahead of canonical and changes exactly the PostgreSQL operator, disposable integration tests, and its proposal document. No approved policy+deadline code has been integrated to canonical #198.
- Proposed Policy A on PR #203 passed full CI #44096822494 (four primary jobs) and the real-PG16 fault suite #44096821073 (21/21). Independent specialist run #44107572462 explicitly checked out the pinned candidate, verified operator blob 31b1e862f594434944fec516f768265baf794525 and migration 0060 blob d8b1e50a0a4dd347fde235ae7cb1a12468249719, and reported 350/350 **repeated test executions** with no disposable DB leaks; these are not 350 distinct scenarios.
- Historical canonical #198 full CI #44066988795 and fault CI #44066988820 passed on the OLD policy; their results do not certify approval expiry race closure or a new deadline.
- Current PG16 operator source (PR #203) specifies SET LOCAL lock_timeout 2000ms, statement_timeout 10000ms, idle_in_transaction_session_timeout 15000ms. CLI additionally specifies connectionTimeoutMillis 4000, statement_timeout 10000, query_timeout 12000. These are PHASE-SPECIFIC ceilings, NOT an aggregate budget. The operator accepts an already-connected ClientBase; it currently has no monotonic whole-operation enforcement.
- In 5 earlier negative external relation-lock waits the canonical implementation incorrectly returned APPLIED after approval expiration (audit run #44070678371). On isolated #203, EXP-01 exercises 5 distinct real PostgreSQL lock-crossing fixtures and EXP-02 proves expiry after a valid final check is nonretroactive. No approved numeric whole-operation deadline or exact-SHA cumulative deadline tests exist.
- PostgreSQL 16.16 is the verified disposable fixture; no production database patch/role state is inferred. PostgreSQL 16 does not provide transaction_timeout; per-statement, lock, and idle timeout controls are insufficient to bound the total transaction including network delays and COMMIT acknowledgement.
- Agent 06's final review #5942420824 independently records REQUEST CHANGES; AG06-S03-08 remains OPEN, AG06-S03-09 P3 CLOSED, previous AG06-S03-01 to -07 CLOSED only for their previously reviewed restricted scope.

## 2. Policy comparison and technical recommendation

| Contract | Policy A: FINAL_PRE_DDL (RECOMMEND; NOT APPROVED) | Policy B: VALID_THROUGH_FINALIZATION (ALTERNATIVE; NOT IMPLEMENTED) |
| --- | --- | --- |
| Authorization linearization | Fresh PostgreSQL clock_timestamp AFTER installation advisory, registry FOR UPDATE, approval advisory, target ACCESS EXCLUSIVE, live catalog/ACL and row checks; IMMEDIATELY BEFORE DDL | Second fresh PostgreSQL approval time check AFTER DDL/CAS/journal, immediately before COMMIT |
| Expiry before the check | DENY, ROLLBACK; no column or completed journal | DENY, ROLLBACK of all transactional DDL/registry/journal changes |
| Expiry strictly after the check | Nonretroactive: valid DDL may finalize even after expiration; deadline still applies separately | Nonretroactive only after finalization check; cannot promise retroactive rollback once COMMIT has been sent |
| Revocation ordering | Under migration 0060's shared approval-specific transaction advisory lock: committed revocation BEFORE operator fence denies; revocation queued AFTER operator fence waits for completion and affects subsequent attempts | Same fencing plus another read; requires separately verified revocation/expiry races |
| Strengths | Explicit, reproducible one-point authorization; five real-PG wait-crossing cases tested; simpler audit/recovery for exactly one bounded operation | Tighter validity window before COMMIT; favors strict approval lifespan |
| Tradeoffs | May commit after approval expiry; only sound if this nonretroactivity and independent deadline are explicitly accepted | May waste completed DDL/CAS work if expiry occurs before last check; additional failure/rollback tests, timeout and post-check COMMIT uncertainty |
| Current evidence | Technical proposal tested in isolated PR #203; NOT approved or integrated | Not implemented, NOT tested |
| Owner decision | PENDING | PENDING |

**Recommended Policy A restricted scope:** one PLANNED optional scalar ADD_FIELD without default to an EXISTING application-owned table in test/development disposable PostgreSQL 16; independently authenticated author, approver and operator; no CREATE_RESOURCE, tenant-owned DDL, destructive operations, default/backfill/rename/type changes, shared/production schema changes or API/worker/plugin DDL entrypoint. Technical recommendation assumes acceptance that expiry strictly after the final pre-DDL timestamp is nonretroactive.

**Policy A invariants if approved:**
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
| Accountable Project Owner: selects A or B and scope | **PENDING.** User has signaled conditional intent; no GitHub-verifiable signed selection for A or B, explicit nonretroactivity, numeric deadline or duration. Approval reference NONE. |
| Designated human IAM authority: approval/revocation and provenance semantics | **MISSING / NOT NAMED**. Agent 05's proposed code and technical report are NOT a qualified human signature. |
| Designated human PostgreSQL DBA: deadline, locks, recovery, rollback and server constraints | **MISSING / NOT NAMED**. Agent 02's 350 repeated executions are evidence, NOT a human release sign-off. |
| Agent 06 independent certification on combined final SHA | **PENDING**. Existing review #5942420824 states REQUEST CHANGES. |
| Approved Policy A/B | **NONE**. Recommendation: Policy A only for restricted disposable scope. |
| Approved authorization linearization point | **NONE** (technical definition above is a proposal). |
| Approved whole-operation deadline value/unit | **NONE / NOT SET**. |
| Approved start/completion/cancellation/reconciliation semantics | **NONE** (proposed, NOT authoritative). |
| Actual authorization timestamp and identities | **NOT RECORDED / NOT VERIFIED**. |
| Current merge / production decision | **NOT AUTHORIZED / NO-GO**. |

**Exact required owner decision form (must be attributed, dated, and linked in Issue #197):** select Policy A (explicitly acknowledging expiry after valid final authorization is nonretroactive) OR B; define exact operation scope and approved integer whole-operation duration/unit after measurement; accept ACK-before-deadline as a result-classification rule, not hard physical transaction timing; approve safe cancellation/indeterminate COMMIT/fenced recovery; designate authorized IAM and DBA humans by verifiable account/role and collect their independent technical concurrence. If any requirement fails, reject/hold rather than infer approval. The user's conditional intent must not be represented as a signed unconditional decision.

## 6. Handoff and residual risk

**Implementation contract:** BLOCKED until the exact policy, measured finite deadline and accountable owner/IAM/DBA references are verified. After that, brief Agents 05/02/04 with the invariants above and new numeric budget, mandate nonproduction-only implementation and negative tests; integrate the exact narrow delta into canonical PR #198, freeze a new SHA, run CI and independent Agent 06 review. No code on PR #198 is modified or certified by this decision proposal.

**Residual risks:** operator table ownership can confer broader native DDL power than the renderer; shared database service identities cannot attest a human; hard transaction/ACK timing cannot be guaranteed under network partition; external DDL deadlocks; partial supervisor failure; off-transaction denied-attempt audit, backup/PITR and production RBAC remain outside current approval. These risks are NOT accepted for a production release.

**Final state — 2026-11-17:** Policy **PENDING**; Deadline Value **NOT APPROVED**; Deadline Semantics **DEFINED AS PROPOSAL / NOT APPROVED**; Human Approval Evidence **MISSING**; Implementation Contract **BLOCKED**; AG06-S03-08 **OPEN**; Merge **NOT AUTHORIZED**; Production **NO-GO**.

## Official sources (reviewed 2026-11-17)

- PostgreSQL 16 session/lock/statement/idle timeouts: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 clock_timestamp versus transaction_timestamp: https://www.postgresql.org/docs/16/functions-datetime.html
- PostgreSQL 16 transaction and advisory locking: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 COMMIT: https://www.postgresql.org/docs/16/sql-commit.html
- PostgreSQL 16 wire protocol, cancellation and synchronization: https://www.postgresql.org/docs/16/protocol-flow.html
- PostgreSQL operational recovery/unknown commit: https://wiki.postgresql.org/wiki/Operations_cheat_sheet
