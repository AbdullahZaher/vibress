# M03-S03 — P05 Trusted-Actor Deactivation, D1 Scope and Operational Objectives: R1 POLICY APPROVED

**P05 decision date:** 2026-11-18 (Asia/Riyadh) · **Owner directly APPROVED R1 in the conversation; Agent 01 relayed the decision to GitHub** · This is NOT an independently authenticated IAM/DBA signature. **Decision ID:** `M03-S03-P05-R1-OWNER-2026-11-18` · [Decision audit relay #6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436)  
**Repository:** AbdullahZaher/vibress · **Canonical PR #198:** `b5cfc0687076c86a7450a8a785a072f6e63ad289` · tree `4808788688120b147fcab3fdd8a730021ec51516`  
**Governance base:** `251bef39325476bcbbe84d80ed451851a079695a` · **P04 source:** PR #203 `1fb5e1600fd2300d7509ec998ff3b1fa1fff5078`  
**Status:** P05/R1 owner policy APPROVED; actor epoch/reactivation/reapproval PENDING independent human IAM/DBA review; REQUEST CHANGES / NO-GO; no canonical integration permitted.

## 1. Binding decisions already made (no reinterpretation)

| Decision | Actual owner authority / evidence | Effect |
|---|---|---|
| Policy A / FINAL_PRE_DDL | Owner P04 relay [Issue #197 #6959358323](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959358323) | Fresh PG `clock_timestamp()` after required locks and authoritative catalog checks, immediately before single permitted DDL. Approval expiration strictly after valid final check is nonretroactive |
| Contract D1 | Same P04 | Immutable monotonic T0 before PG connection; `APPLIED` only if definitive COMMIT ACK T13 and success classification T14 occur by T0+**2517 ms** |
| Workload | P04 | Isolated disposable PG16 development/test; one optional scalar ADD_FIELD with no default on an existing application-owned table; original bounded single-stressor laboratory profile only |
| D2 | NOT APPROVED | D1 is not a T15 cleanup/recovery bound |
| P05/R1 privileged actor deactivation | **OWNER APPROVED — POLICY ONLY (2026-11-18)** | Applies to both AUTHOR and APPROVER; committed deactivation prior to the serialized final authorization denies DDL; strictly later commit is nonretroactive. [Decision record](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436) |
| Human approvals | Neither is verified | IAM and PostgreSQL DBA remain blocking gates |

The GitHub P04 comment is a relay of an explicit conversational owner decision, NOT proof of independent human IAM or DBA signatures. P02/P03/P04 are historical records and must not be rewritten: [P04 version-controlled record](https://github.com/AbdullahZaher/vibress/blob/1fb5e1600fd2300d7509ec998ff3b1fa1fff5078/docs/platform-roadmap/execution/M03-S03-APPROVAL-EXPIRY-AND-DEADLINE-DECISION.md).

## 2. P05-A — Owner decision: **R1 APPROVED, POLICY ONLY**

**Direct Project Owner instruction (2026-11-18, Asia/Riyadh; exact message time not externally attested):**

> بصفتي Project Owner، أعتمد P05/R1 لقاعدتي AUTHOR وAPPROVER ضمن M03-S03: التعطيل الذي يُعتمد قبل التفويض النهائي يمنع DDL، وبعده لا يسري بأثر رجعي. هذا اعتماد للسياسة فقط وليس إذنًا بالدمج أو الإنتاج أو توسيع الصلاحيات. أبقِ قرار actor epoch وإعادة الاعتماد خاضعًا لمراجعة IAM/DBA قبل التنفيذ.

**Authority/evidence:** [Agent 01 GitHub relay #6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436), quoting the direct owner instruction. The relay is an attributable engineering audit record of an instruction conveyed in this chat; it is **not** an independently authenticated human IAM/DBA approval or independent owner GitHub signature.

**R1 (SELECTED):** both privileged **AUTHOR** and **APPROVER** deactivations follow the same rule. If the deactivation transaction is **COMMITTED and authoritative before the final serialized Policy A pre-DDL authorization point**, the in-flight operation **MUST deny DDL**. If the deactivation transaction commits **strictly after** valid final authorization, it is **nonretroactive**. An uncommitted/rolled-back deactivation cannot be treated as a committed invalidation. Preserve independent Policy A approval-expiration semantics and D1 2517ms as separately approved; this R1 decision does not alter either.

**R2 (NOT SELECTED):** future-only invalidation was considered but not adopted for this milestone. No engineer may reintroduce it as a silent fallback.

**IAM-RACE-01 after the owner decision:** Previously executed real PG16 fixtures showed current source may return `APPLIED` after privileged deactivation commits during an ACCESS EXCLUSIVE wait, before final authorization. This **is an OPEN defect against now-approved R1 semantics**, although evidence is limited to the specified prior tested SHA; no integrated fix or new exact-SHA retest exists.

**NOT YET DECIDED:** actor epoch/generation representation, how reactivation affects preexisting approvals, any mandatory new approval/reapproval protocol, locking/serialization implementation and potentially required migration. The proposal below is for analysis, **not a second owner approval**. Human IAM and PostgreSQL DBA must independently review lock order, timestamp/commit linearization, epoch semantics, migration safety and rollback before adopting code. If an actor reactivates before the final decision, the effect on earlier approvals remains **UNDECIDED**; do not quietly approve their reuse.

**Safety boundary:** R1 is approved as a **policy only**. No change to schema/migrations 0059/0060, runtime or watchdog grants, operator code, canonical PR #198, merge, prod or additional DDL is authorized. The final authorization must be defensibly serialized with committed actor deactivation; a standalone READ COMMITTED re-read or server timestamp is **not by itself proven** to create a total order. PostgreSQL lock/recheck design must be independently demonstrated.

### R1 architecture proposed for IAM+DBA review only

1. **Linearization:** actor-deactivation UPDATE transaction **COMMIT** establishes authoritative invalidation; compare to the final authorization's serialized decision point, not the start of the update. The final check must operate on a fresh READ COMMITTED view and properly serialize with concurrent committed actor updates, never just a cached JS actor snapshot.
2. **Binding:** require same authenticated author AND approver principal identity, role, active flag and approved-epoch binding at final authorization; author and approver must obey identical invalidation semantics. No reauthorizing an outdated approval via actor reactivation.
3. **Epoch proposal:** monotonically advance a distinct actor generation at each deactivation/reactivation; bind approvals to both original actor generations. Reactivation requires new approval; old approval remains permanently unusable. This is **only proposed**: schema/0060 migration and grant review required before any adoption.
4. **Ordering proposal:** serialize installation registry, approval-key advisory lock, actor state and table/catalog in one documented global lock order with writer/deactivation paths. Review row-lock modes, foreign keys, advisory key ownership and simultaneous revocation; test deadlock victims, lock timeouts and rollback. Avoid any extra blocking stage between final Policy A server-time decision and DDL.
5. **Evidence:** record final server authorization timestamp, decision version and both actor epoch digests (not secrets), deactivation commit identity/reference, stable operation ID, terminal transaction evidence. No raw credentials or PII in user-facing errors.
6. **Transactional invariants:** physical ADD_FIELD, manifest CAS and completed journal remain atomic; no preexisting 0059/0060 rewrite is authorized. Any additional migration requires a separate authorized expand/backfill/validate/replay and rollback plan.

**R1 OWNER POLICY IS APPROVED. No normative R1 executable changes may be adopted until accountable IAM and DBA have independently accepted the proposed epoch/reapproval contract, lock ordering, migration/replay/rollback safety and exact reviewed SHA.**

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
| P05-01 | Choose R1 vs R2 | **R1 OWNER APPROVED — POLICY ONLY** | Direct owner statement 2026-11-18; [GitHub relay #6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436) |
| P05-01A | Actor epoch, reactivation, prior approval reuse/reapproval and lock-order protocol | **PENDING — MUST NOT IMPLEMENT** | Independent human IAM and DBA; owner follow-on if new policy choice required |
| P05-02 | Retain P04 supported single-stressor scope; combined profiles safety-negative | **RECOMMENDED, not new owner amendment** | Project Owner if amending workload |
| P05-03 | Set measurable synchronous-success/false-timeout objectives | **PENDING** | Project Owner + Agent04 measurement |
| P05-04 | Define T15 cancel/fence/reconcile/cleanup objectives | **PENDING** | Project Owner + human DBA |
| P05-05 | Approve positive integer COMMIT admission M | **BLOCKED — NOT DETERMINABLE** | Agent02+04 evidence; human DBA and owner as required |
| P05-06 | Privileged watchdog or new actor schema change | **NOT AUTHORIZED** | Formal risk/rollback and IAM/DBA/Agent06 concurrence |

**Risk assessment:** R1 is selected to prevent stale privileged authority during in-flight migration. Existing source remains vulnerable to the confirmed actor-race under R1; the unimplemented serialized lock/epoch design could introduce deadlocks, stale approval reuse or privilege defects if adopted without evidence. There is no authority to accept an unresolved High/Critical risk. **Rollback/containment now:** preserve #198 Draft, avoid changing migrations or privileges, use disposable PG16 only, no merge and no production use.

## 6. Owner R1 decision RECORDED; next specialist decisions remain blocked

The Project Owner selected **P05-01 = R1** for AUTHOR/APPROVER by direct chat instruction on 2026-11-18, with [issue audit relay](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436). The owner expressly excluded merge, production and expanded privileges. **P05 R1 policy is NOT BLOCKED**; its **implementation gate is BLOCKED** until independently accountable human IAM and PostgreSQL DBA reviews resolve actor epoch/reactivation and lock-order/migration rules. Separately, workload amendments, operational SLO and T15/M objectives remain PENDING. No independent signature is inferred from the same GitHub account posting the relay.

**Next permitted action:** review this decision package; execute additional noncanonical read-only/test-only PostgreSQL probes and independently measure supported D1 margins. No production access.

## 7. Research verification (2026-11-18)

- [PostgreSQL 16 transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html): each READ COMMITTED command sees a refreshed snapshot; a snapshot alone does not prove final deactivation/authorization serialization.
- [PostgreSQL 16 explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html): lock ordering and deadlock handling require independent design and deterministic tests.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): fail closed and least privilege.
