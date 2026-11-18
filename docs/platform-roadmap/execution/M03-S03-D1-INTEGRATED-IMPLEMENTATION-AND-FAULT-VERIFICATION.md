# M03-S03 — D1 Integrated Implementation and Fault Verification (Admission Plan, NOT IMPLEMENTED)

**Date:** 2026-11-18 Asia/Riyadh · Agent01 coordination with Agent02/03/04/05 technical evidence  
**Canonical exact SHA:** `b5cfc0687076c86a7450a8a785a072f6e63ad289` · tree `4808788688120b147fcab3fdd8a730021ec51516` (UNCHANGED).  
**Verdict:** BLOCKED / NO INTEGRATED CANDIDATE · **No new tests executed for a D1 integrated SHA**. Human IAM PENDING, DBA PENDING, Owner P05 R1/R2 PENDING, M NOT DETERMINABLE. Production NO-GO.

## Evidence inventory (separate sources; DO NOT transfer PASS across SHAs)

| Unit | Real source status and provenance | Meaning |
|---|---|---|
| Canonical #198 | b5cfc068...; Draft | Prior tested operator **does not implement** Policy A as latest approved or D1 supervisor |
| Policy A #203 | 1fb5e160...; draft, isolated source | Fresh final approval check; old baseline source unintegrated |
| Whole-operation #204 | aa8d55f3... docs head; tested source 66af2e217... | Benchmark harness only; not production D1 enforcement |
| IAM #205 | a7bfab5f...; independent *technical* review | REQUEST CHANGES; NOT human IAM approval |
| Race/Watchdog #206 | fb6e122...; 2026-11-17 exact-head targeted CI success | Reproductions, readonly probe, privilege negatives; not fixes |
| Combined-fault report | source f4948b1e... cited in issue #197 #6961059780 | 182 attempts, 44 late APPLIED, M unknown; source-specific |
| Current patch status | NONE on canonical | AG06-S03-08, AG06-S03-10 and D1-PG06 remain open |

## Executor contract to implement ONLY AFTER gates

1. Dedicated nonpooled disposable PG16 operator connection; immutable `T0=performance.now()/hrtime` before connection acquisition. No reset on retries, reconnects, cancellations, SQL stages or journal recovery. New connection authorization stays source-bound and within D1.
2. Positive, finite, **dynamically bounded** connect/query/statement/lock timeouts based on remaining deadline; explicitly distinguish driver timeout, query cancel and PostgreSQL lock failure. Retain no-default scalar ADD_FIELD-only renderer and existing deny-by-default role boundaries.
3. Fixed ordering for registry/advisory/actor/approval/table locks after owner selects R1/R2; fresh server `clock_timestamp()` final check after catalog locks, immediately before allowed DDL. Expiry strictly later than final check remains nonretroactive.
4. No new DDL if remaining time exhausted; physical DDL + manifest CAS + completed journal in one PG transaction. Review ALREADY_APPLIED path separately for classification.
5. Before COMMIT, `remainingMs > APPROVED_M` mandatory; **M presently unknown**, so do not dispatch from any asserted final D1 supervisor in a release candidate. Never substitute 109, 292, 293 or 300ms hypothetical values as policy.
6. After COMMIT dispatch, distinguish **definitive acknowledged COMMITTED**, **definitive late committed/breach**, and **unknown INDETERMINATE**. A stale/late `APPLIED` return is forbidden. Keep monotonic T13/T14 evidence, not just wall-clock logs.
7. On pre-COMMIT refusal, require an acknowledged PostgreSQL ROLLBACK or conclusive original-backend termination/fresh authoritative check; if not proven => INDETERMINATE, quarantine and stop replay.
8. A separate identity-bound least-privilege watcher is **UNIMPLEMENTED**; cannot grant runtime `pg_signal_backend` or any privileged SECURITY DEFINER control without a new decision, rollback proof and human approvals. A read-then-signal PID check is not an atomic identity-proof.
9. Reconcile from fresh trusted connection after original backend is fenced; inspect exact physical column, registry manifest digest and journal on same installation/plan; irreconcilable => HALT_UNRECONCILABLE, escalate without retry.
10. Classify 55P03 as LOCK_TIMEOUT, 40P01 as DEADLOCK_DETECTED, 57014 as QUERY_CANCELED **only with transaction-state precedence**; explicit authorization failures alone map to UNAUTHORIZED.

## Mandatory exact-SHA acceptance tests (all NOT RUN against a new integrated candidate)

- Build, typecheck, lint, explicit-any, unit/integration, SCA, E2E, platform reference E2E, container scan.
- Policy A expiry and approval revocation across lock waits and post-authorization nonretroactivity; R1/R2 actor-race matrix including deactivation/rollback/reactivation/epoch.
- Privilege inheritance, SET ROLE, forged provenance, catalog drift, 0059/0060 exact migration hash and no grants.
- D1-PG06 delayed COMMIT ACK regression; T0 before connect; DDL/COMMIT exhaustion; positive approved admission margin and false-timeout cohort.
- Real PostgreSQL 55P03/40P01/57014 and rollback proof; lost ACK, backend fencing, fresh journal/registry/catalog consistency, original session quarantine.
- Watchdog forged/wrong/reused PID, stale backend_start, wrong db/role, token, watchdog crash and COMMIT in flight.
- Combined faults verify **no late APPLIED**, no false rollback, no unrelated cancellation, no duplicate journal. Count scenarios separately from repetitions.

**Agent02 technical status:** blocked on M/recovery/lock review. **Agent03:** blocked on watchdog and SQLSTATE remediation. **Agent04:** measurements are reproducible but cannot prove universal COMMIT tail. **Agent05:** blocked on P05 and human IAM concurrence. **Agent06:** no exact new integrated SHA to certify.

## Rollback and containment

Current documents-only work: revert branch or close Draft PR; no schema effect. Future candidate requires tested rollback, backup validation and explicit original connection fencing; physical committed ADD_FIELD cannot be erased by saying a timed-out request failed. No destructive schema rollback is authorized. If COMMIT result is uncertain, preserve evidence, stop new DDL and invoke approved reconciliation/escalation.

**Next permitted action:** owner P05 R1/R2 decision; human IAM and DBA exact-scope approvals; independent M and watchdog feasibility proof; only then narrow isolated integration candidate for Agent06.
