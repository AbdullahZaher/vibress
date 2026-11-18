# M03-S03 — P05 Trusted-Actor Deactivation, D1 Scope and Operational Objectives: OWNER DECISION PACKAGE

**Prepared:** 2026-11-18 (Asia/Riyadh) · **Agent 01 governance draft; NOT an owner-signed R1/R2 decision**  
**Repository:** AbdullahZaher/vibress · **Canonical PR #198:** `b5cfc0687076c86a7450a8a785a072f6e63ad289` · tree `4808788688120b147fcab3fdd8a730021ec51516`  
**Governance base:** `251bef39325476bcbbe84d80ed451851a079695a` · **P04 source:** PR #203 `1fb5e1600fd2300d7509ec998ff3b1fa1fff5078`  
**Status:** REQUEST CHANGES / NO-GO · human IAM PENDING · human DBA PENDING · no canonical integration permitted.

## 1. Binding decisions already made (no reinterpretation)

| Decision | Actual owner authority / evidence | Effect |
|---|---|---|
| Policy A / FINAL_PRE_DDL | Owner P04 relay [Issue #197 #6959358323](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959358323) | Fresh PG `clock_timestamp()` after required locks and authoritative catalog checks, immediately before single permitted DDL. Approval expiration strictly after valid final check is nonretroactive |
| Contract D1 | Same P04 | Immutable monotonic T0 before PG connection; `APPLIED` only if definitive COMMIT ACK T13 and success classification T14 occur by T0+**2517 ms** |
| Workload | P04 | Isolated disposable PG16 development/test; one optional scalar ADD_FIELD with no default on an existing application-owned table; original bounded single-stressor laboratory profile only |
| D2 | NOT APPROVED | D1 is not a T15 cleanup/recovery bound |
| Human approvals | Neither is verified | IAM and PostgreSQL DBA remain blocking gates |

The GitHub P04 comment is a relay of an explicit conversational owner decision, NOT proof of independent human IAM or DBA signatures. P02/P03/P04 are historical records and must not be rewritten: [P04 version-controlled record](https://github.com/AbdullahZaher/vibress/blob/1fb5e1600fd2300d7509ec998ff3b1fa1fff5078/docs/platform-roadmap/execution/M03-S03-APPROVAL-EXPIRY-AND-DEADLINE-DECISION.md).

## 2. P05-A — Requested OWNER decision, currently PENDING

**Question:** What is the normative effect of a privileged author/approver roster deactivation on an in-flight migration?

- **R1 (RECOMMENDED; NOT APPROVED):** a deactivation **committed before** the final Policy A authorization point invalidates this in-flight operation; a deactivation committed strictly after that point is nonretroactive. Both AUTHOR and APPROVER subject to the same rule. An uncommitted change is not authoritative until committed; cancellation/rollback must not invent an earlier revocation.
- **R2 (ALTERNATIVE; NOT APPROVED):** deactivation blocks future approvals and future execution attempts but does not void an already admitted in-flight operation.

**Risk:** Under unchanged operator, real PG16 `IAM-RACE-01` observed deactivation of either privileged actor during `ACCESS EXCLUSIVE` wait while the executor could still `APPLIED` because the final Policy A check re-reads approval timestamps, not the actor roster. This is a confirmed state race but a contract violation only if R1 is adopted.

### R1 architecture proposed for IAM+DBA review only

1. **Linearization:** actor-deactivation UPDATE transaction **COMMIT** establishes authoritative invalidation; compare to the final authorization's serialized decision point, not the start of the update. The final check must operate on a fresh READ COMMITTED view and properly serialize with concurrent committed actor updates, never just a cached JS actor snapshot.
2. **Binding:** require same authenticated author AND approver principal identity, role, active flag and approved-epoch binding at final authorization; author and approver must obey identical invalidation semantics. No reauthorizing an outdated approval via actor reactivation.
3. **Epoch proposal:** monotonically advance a distinct actor generation at each deactivation/reactivation; bind approvals to both original actor generations. Reactivation requires new approval; old approval remains permanently unusable. This is **only proposed**: schema/0060 migration and grant review required before any adoption.
4. **Ordering proposal:** serialize installation registry, approval-key advisory lock, actor state and table/catalog in one documented global lock order with writer/deactivation paths. Review row-lock modes, foreign keys, advisory key ownership and simultaneous revocation; test deadlock victims, lock timeouts and rollback. Avoid any extra blocking stage between final Policy A server-time decision and DDL.
5. **Evidence:** record final server authorization timestamp, decision version and both actor epoch digests (not secrets), deactivation commit identity/reference, stable operation ID, terminal transaction evidence. No raw credentials or PII in user-facing errors.
6. **Transactional invariants:** physical ADD_FIELD, manifest CAS and completed journal remain atomic; no preexisting 0059/0060 rewrite is authorized. Any additional migration requires a separate authorized expand/backfill/validate/replay and rollback plan.

**No R1 or R2 code may be introduced as normative policy until an attributable explicit owner decision, IAM concurrence and DBA lock-order approval.**

## 3. P05-B — Requested supported D1 workload decision, PENDING for any amendment

**RECOMMEND retaining** D1=2517ms and P04's original bounded *single-stressor* disposable PG16 workload. Require realistic combined-stressor profiles as **safety-negative/fail-closed tests**, not promised on-time `APPLIED` availability. A physical COMMIT after the budget does NOT justify an on-time synchronous success.

The existing Agent02+04 [evidence #6961059780](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6961059780) reports **182 attempts, 44 late APPLIED, T14 up to ~3353.4ms** on unchanged operator and **M NOT DETERMINABLE**. 109ms historical cancellation/scheduling reserve is not an approved COMMIT acknowledgment admission margin. Even observed p99 and 24 successes are not worst-case tail guarantees. If owner requires synchronous success under combined TCP+lock+delayed-ACK+event-loop stress, a **separate owner scope/SLO/deadline amendment** is mandatory; DO NOT auto-increase D1.

## 4. P05-C — Operational objectives: explicit unsigned decision menu

All numbers below are **UNSELECTED**; no default 99%/1% acceptance.

| Operational control | Decision to be supplied by accountable owner | Technical evidence required before approval |
|---|---|---|
| Timely synchronous success rate | Named supported fixture/topology, measurement window, target %, minimum n, confidence approach | Repeatable source-pinned tests with representative latency and workload |
| Additional false-timeout rate | Acceptable rate, cohort, confidence interval and severity | Distinguish budget admission refusals from true 55P03/40P01/57014 and unknown COMMIT |
| Unresolved INDETERMINATE | Maximum incidents per window, severity/escalation, stop-new-DDL threshold | Delayed/lost ACK, replay refusal and fresh reconciliation fault tests |
| Cancellation escalation | Duration to trigger cancel, then separate escalation | Real PG cancel delivery and no incorrect rollback claims |
| Backend fencing | Maximum allowed unresolved original backend lease | Original backend disappearance or conclusive transaction state, under network loss |
| Reconciliation | Maximum time and retry policy for fresh trusted read | Exact catalog + registry + journal triple consistency, no blind DDL replay |
| Cleanup | Maximum T15 budget or alternative controlled incident hold | Verified rollback ACK / backend termination + zero fixture leaks |
| Combined-stressor policy | Fail-closed only (recommended) OR new owner-approved success SLO | Tested safety outcome under every unsupported profile |

**No operational SLO, T15 duration, `M`, or D2 is authorized by publication of this package.**

## 5. Decision / risk / authority log

| ID | Proposed decision | Status | Owner / next authority |
|---|---|---|---|
| P05-01 | Choose R1 vs R2; actor epoch/reactivation semantics | **PENDING** | Project Owner; IAM/DBA concurrency review |
| P05-02 | Retain P04 supported single-stressor scope; combined profiles safety-negative | **RECOMMENDED, not new owner amendment** | Project Owner if amending workload |
| P05-03 | Set measurable synchronous-success/false-timeout objectives | **PENDING** | Project Owner + Agent04 measurement |
| P05-04 | Define T15 cancel/fence/reconcile/cleanup objectives | **PENDING** | Project Owner + human DBA |
| P05-05 | Approve positive integer COMMIT admission M | **BLOCKED — NOT DETERMINABLE** | Agent02+04 evidence; human DBA and owner as required |
| P05-06 | Privileged watchdog or new actor schema change | **NOT AUTHORIZED** | Formal risk/rollback and IAM/DBA/Agent06 concurrence |

**Risk assessment:** R2 can allow privileged deactivation to have no effect on admitted in-flight DDL; R1 introduces locking/TOCTOU and epoch-reapproval complexity. Both require controlled concurrency evidence. There is no authority to accept an unresolved High/Critical risk. **Rollback/containment now:** preserve #198 Draft, avoid changing migrations or privileges, use disposable PG16 only, no merge and no production use.

## 6. Explicit decision requested (not a request for blanket authorization)

Project Owner should provide one attributable statement selecting `P05-01 = R1` or `R2`, confirming the chosen reactivation/approval-epoch rule, and deciding separately whether to retain P04-only scope or request an amended workload/SLO. Independent accountable human IAM and DBA still must sign exact reviewed source and conditions. Until then: **P05 BLOCKED; canonical integration prohibited**.

**Next permitted action:** review this decision package; execute additional noncanonical read-only/test-only PostgreSQL probes and independently measure supported D1 margins. No production access.
