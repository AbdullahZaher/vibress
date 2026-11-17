# M03-S03 — Agent 02 PostgreSQL 16 Authorization Lock Order, Expiry Race & Transaction Safety Verification

**Document ID:** M03-S03-AG02-S03-08-2026-11-17  
**Record date:** 2026-11-17 UTC (inspection completed at 14:57Z)  
**Reviewer:** Agent 02 — Principal PostgreSQL DBA / Database Concurrency / Reliability (AI-assisted technical review, **not** independent Agent 06 certification)  
**Repository:** [AbdullahZaher/vibress](https://github.com/AbdullahZaher/vibress)  
**Canonical release candidate:** [Draft PR #198](https://github.com/AbdullahZaher/vibress/pull/198), HEAD **b5cfc0687076c86a7450a8a785a072f6e63ad289** — UNCHANGED  
**Proposed AG06-S03-08 correction:** [Draft PR #203](https://github.com/AbdullahZaher/vibress/pull/203), reviewed **2c31ed9119b88a7aff0ae8bd4c16638294a74cda**  
**Reviewed candidate Git tree:** **d54a7e43a3ce09727cc15ba0fdab4a77ed9e1b26**; identical to PR #203 synthetic merge tree  
**Reviewed operator blob:** **31b1e862f594434944fec516f768265baf794525**  
**Reviewed PostgreSQL migration 0060 blob:** **d8b1e50a0a4dd347fde235ae7cb1a12468249719**  
**Environment:** GitHub-hosted Ubuntu 24.04, actual disposable PostgreSQL **16.16** (`server_version_num=160016`), Node.js **24.22.3**, pnpm 11.22.0.  
**Deployment:** NONE. All SQL mutation and fault injection occurred only in verified localhost disposable `vibress_s03_*` databases. No shared/production database, secrets, role grants or canonical PR source were changed.

## 1. Executive finding and limits

**Specialist technical result: PASS for the proposed Policy A implementation and specifically tested PostgreSQL concurrency/failure cases.** This assessment does **not** close finding **AG06-S03-08**: the source's own policy document is marked **"PROPOSED; ACCOUNTABLE OWNER APPROVAL PENDING"**, and no actual Architecture/Agent01, IAM/Agent05 or accountable DBA authorization/reference was found. No whole-operation wall-clock deadline has been adopted. **Specialist release disposition: BLOCKED. Ready for canonical integration: NO. Merge: NOT AUTHORIZED. Production: NO-GO.** Agent 06 must review the exact integrated source after a formally recorded policy choice.

The previous candidate `b5cfc068...` checked expiry once *before* an external table-lock wait, and an independent PG16 test confirmed five late-expiry `APPLIED` outcomes. PR #203's proposed **Policy A / FINAL_PRE_DDL** adds a fresh final approval observation **after** the target-table `ACCESS EXCLUSIVE` lock and authoritative catalog/row checks, immediately before the one bounded DDL command. It intentionally does **not** demand expiry still be in the future at COMMIT. The required formal approval of this semantics remains pending; do not infer it from test success.

## 2. Verified lock acquisition and writer order

### Migration operator A/B

1. `BEGIN ISOLATION LEVEL READ COMMITTED` on a dedicated operator-only session; `SET LOCAL lock_timeout = 2000ms`, `statement_timeout = 10000ms`, `idle_in_transaction_session_timeout = 15000ms`, `search_path = pg_catalog`.
2. Acquire installation-scoped `pg_advisory_xact_lock`. Competing operators for the *same installation* serialize here. Installation/database/single-installation checks follow.
3. Lock `public.platform_schema_registry` installation row with **`FOR UPDATE`**, then reconstruct canonical plan from trusted stored evidence.
4. Acquire **approval-specific transaction advisory lock**, keying installation, exact plan digest and operation ID. This is the lock also used by 0060 approval INSERT/UPDATE/DELETE triggers. The operator **does not** issue `SELECT ... FOR UPDATE` against the approval row: the advisory-lock+trigger protocol is the intended authorization serialization mechanism.
5. Read plan approval and authenticated AUTHOR/APPROVER records, rejecting revoked/expired/forged, wrong-role, wrong-environment and unauthenticated provenance.
6. Acquire `LOCK TABLE ONLY "public"."<canonical-physical-table>" IN ACCESS EXCLUSIVE MODE` **before** authoritative PostgreSQL catalog validation, journal check, or row count. Retain it through transaction end. Any previously committed noncooperating DDL is re-observed; subsequent DDL is blocked.
7. Reject unexpected ownership, effective privilege, table structure, columns, constraints, indices, triggers, RLS, or registry/manifest/journal contradictions. Check pre-DDL row count.
8. **Proposed Policy A linearization:** perform fresh `SELECT approved_at,expires_at,revoked_at,clock_timestamp() AS checked_at` on the same approval row. Reject missing/changed/revoked/not-yet-effective/expired approval; retain approval advisory lock until end. No additional intentional blocking external operation lies between this decision and the narrowly rendered `ALTER TABLE ... ADD COLUMN`.
9. Execute one optional mapped scalar ADD COLUMN; verify physical postconditions and unchanged row count; compare-and-swap registry old digest → new digest; insert one `COMPLETED` journal row with `authorizationPolicy=FINAL_PRE_DDL` and DB-derived `finalAuthorizedAt`. `started_at=transaction_timestamp()` is informational transaction-start time, **not** the final authorization time.
10. `COMMIT` atomically publishes physical DDL, manifest and journal. Pre-commit error attempts `ROLLBACK`; failed rollback or unknown COMMIT gives `INDETERMINATE`, requiring a **new independently opened** reconciliation session before any retry.

### Other actors and external DDL

| Actor | Observed ordering / requirement | Safety boundary |
| --- | --- | --- |
| Operator A / B | installation advisory → registry FOR UPDATE → approval advisory → target ACCESS EXCLUSIVE | Cooperative same-installation operations serialize; a different approved plan cannot double-commit |
| Approval issuer | owner-registered individual approver; registry FOR SHARE before INSERT; 0060 INSERT trigger obtains registry FOR SHARE then approval advisory | Registry-first preserves the cooperative ordering and denies self/forged approvals |
| Approval revoker | UPDATE of approval row (PostgreSQL row lock), 0060 BEFORE UPDATE trigger acquires matching approval advisory lock, then audit | If revocation commits before operator advisory acquisition, fresh READ COMMITTED sees it and denies. If operator holds approval lock, revocation waits until operator transaction ends |
| External DDL | noncooperating session may hold target ACCESS EXCLUSIVE before operator or lock table then request registry row | Target lock + post-lock catalog verification prevents false APPLIED; an inverted external lock sequence can cause a real PostgreSQL deadlock; one transaction must abort with SQLSTATE 40P01 |
| Runtime role | no target table ownership, no registry or approval write authority, no allowed migration DDL | Proved in disposable effective-role and cross-installation negatives, not asserted for deployed infrastructure |

This ordering is **safe under the cooperative 0060 protocol**, not "universally deadlock-free" against arbitrary privileged external SQL. The test below deliberately creates the external inversion and checks PostgreSQL's fail-closed deadlock resolution. Native PostgreSQL table ownership **cannot** be limited to ADD COLUMN by a TypeScript SQL renderer. Any stolen operator-owner database credential remains more powerful than the approved application grammar.

## 3. PostgreSQL 16 time and MVCC semantics

- **`transaction_timestamp()` / `now()`**: fixed at transaction start. Do not use to determine whether approval remained valid following a lock wait.
- **`statement_timestamp()`**: start of the latest client statement; it can be stale after a long wait inside that statement.
- **`clock_timestamp()`**: actual database wall clock at invocation, changing within a statement; correct for Policy A's fresh post-lock check.
- **READ COMMITTED**: each SQL command obtains a fresh snapshot, so the final authorization SELECT can see a revocation committed before that command and a newly committed physical catalog change after a prior lock wait.
- **Approval `approved_at` and `expires_at`** are persistent `timestamptz` values. The final check compares them with the fresh `checked_at`, not with the transaction's start. A matching, nonrevoked approval must satisfy `approved_at <= checked_at < expires_at`.

The final result of a bounded transaction **may commit after `expires_at` if expiry occurred strictly after the valid final pre-DDL decision**. This is observable in the journal's `finalAuthorizedAt` and may be appropriate *only if Policy A is formally authorized*. There is **no check that guarantees validity at COMMIT**, and no cross-statement whole-operation duration budget: `lock_timeout` and `statement_timeout` apply per acquisition/statement, and idle-in-transaction timeout is not a total execution deadline.

## 4. Exact-SHA executable evidence

### Authoritative independent repeat

**Run:** [GitHub Actions #44107572462](https://github.com/AbdullahZaher/vibress/actions/runs/44107572462) — **COMPLETED SUCCESS**.  
**Audit workflow revision:** `41f587d824465698d34ac7bdb9573ff0969595f2` on a **separate audit branch**. Its job explicitly checked out the **unchanged PR #203 candidate SHA/tree**, and pinned/rechecked operator and 0060 blobs; test overlays affected only disposable tests, never production code.  
**Artifact:** [AG02 PG16 attempts/provenance](https://github.com/AbdullahZaher/vibress/actions/runs/44107572462/artifacts/14339149453). **Result: 350/350 individual test executions PASS**, across 20 attempted suite invocations, zero failed, with `DISPOSABLE_DB_LEAK_COUNT=0`.

| Actual scenario group | Repetitions | Successful individual executions | What was asserted |
| --- | ---: | ---: | --- |
| **Original Agent04 false-APPLIED regression**, historical assertion injected **byte-for-byte** from `c79aa458...` | 5 | 5/5 | Independent noncooperating catalog ADD COLUMN, original `rejects.toThrow()` assertion, no manufactured APPLIED, registry/journal and seeded-row integrity |
| **Complete current operator/identity/expiry suite** (`platform-schema-migration-operator.test.ts`) | 5 | 230/230 (46 × 5) | EXP-01: five distinct databases with approval expiry during table-lock wait per suite run (25 actual such fixtures); EXP-02: nonretroactive post-final authorization expiry; effective grants, PUBLIC/nonpublic SECURITY DEFINER, role inheritance/SET, approved provenance, revocation, same-plan concurrency, privilege denial, lock timeouts, catalog checks, journal, cross-installation |
| **Complete fault-injection/recovery suite** (`platform-schema-migration-fault-injection.test.ts`) | 5 | 105/105 (21 × 5) | Real backend termination, child SIGKILL after DDL, TCP loss, on-wire lost COMMIT acknowledgement, rollback failure, pre/post-DDL exceptions, journal/CAS, different approved plans, read-only reconciliation |
| **Independent Agent02 test-only external DDL ↔ registry lock inversion** | 5 | 5/5 | Actual two-session PostgreSQL lock cycle; at least one victim records **SQLSTATE 40P01**, no mixed registry/journal, preserved seed checksum, no blind double-application |
| **Independent Agent02 transaction/statement/database clock lock-barrier experiment** | 5 | 5/5 | Real advisory wait shown in `pg_stat_activity`; `transaction_timestamp()` stays fixed while statement/clock timestamps advance |

**Totals:** 5 + 230 + 105 + 5 + 5 = **350 successful individual test executions**. These are **not 350 distinct scenarios**. Focused runs selecting 1 or 2 tests intentionally skip other file tests; these skips are not added to the passed counts.

The unchanged historical assertion block was verified against the recorded SHA-256 **560ec6aaceccc8f24d9936869934e9ea9e4ac726602aa764c4a074ddb1bd799c**. Candidate operator blob **31b1e862f594434944fec516f768265baf794525** remained unchanged before/after the test-only overlays.

### Pre-existing exact-SHA release-adjacent CI (candidate only)

- [PR #203 full CI #44096822494](https://github.com/AbdullahZaher/vibress/actions/runs/44096822494): **4/4 successful**. Strict typecheck, lint, explicit-any, build, dependency audit, unit **2,687 PASS**, integration **688 PASS / 8 existing unrelated opt-in skips**, Browser E2E **62 PASS**, Platform Reference E2E **8 PASS**, container scans and tested-image smoke PASS.
- [PR #203 dedicated Agent04 fault CI #44096821073](https://github.com/AbdullahZaher/vibress/actions/runs/44096821073): **21/21 PASS**, actual Node **v24.22.3** and PG **16.16** printed in the runner.
- [Original historical false-APPLIED failure #44042302748](https://github.com/AbdullahZaher/vibress/actions/runs/44042302748) (historical unremediated operator blob): **20/21 pass, 1 expected FAIL**, with erroneous `APPLIED` despite an external catalog change. This is historical reproduction, **not** a current failure.

Two earlier *audit-harness* runs are retained, not hidden: [#44106210407](https://github.com/AbdullahZaher/vibress/actions/runs/44106210407) was interrupted by an incorrect ANSI-sensitive `grep` despite a passing 46-case suite; [#44106661754](https://github.com/AbdullahZaher/vibress/actions/runs/44106661754) proved 340/340 existing test executions passed but then stopped at a test-only ESLint `no-useless-assignment`. These issues were corrected **only in the separate audit branch**. The final complete #44107572462 run is **SUCCESS**; neither issue was a PostgreSQL security bypass. Neither changed the pinned operator implementation.

### Exact reproducible commands (inside disposable GitHub runner)

```bash
node --version                         # v24.22.3
pnpm install --frozen-lockfile
pnpm --filter @vibress/plugin-sdk build
docker compose -f compose.dev.yml up -d --wait postgres
docker compose -f compose.dev.yml exec -T postgres \
  psql -At -U vibress -d vibress -c 'SHOW server_version_num'    # 160016

# Exact candidate code and tests repeated five times:
pnpm exec vitest run --no-file-parallelism \
  tests/integration/platform-schema-migration-operator.test.ts
pnpm exec vitest run --no-file-parallelism \
  tests/integration/platform-schema-migration-fault-injection.test.ts

# In the audit job only: original historical assertion was reinserted
# byte-for-byte into test source and selected by -t, five times:
pnpm exec vitest run --no-file-parallelism \
  tests/integration/platform-schema-migration-fault-injection.test.ts \
  -t "noncooperating ALTER TABLE after advisory fence: no fabricated journal success"

# In the audit job only: separately authored test-only deadlock/time cases,
# five repeats. These tests are not part of PR #203 source:
pnpm exec vitest run --no-file-parallelism \
  tests/integration/platform-schema-migration-operator.test.ts \
  -t "AG02_S03_08_"

docker compose -f compose.dev.yml down --volumes --remove-orphans
```

The exact overlay and five-iteration command loops, blob checks, original assertion hash, attempt counts and cleanup conditions are versioned at [the audit workflow](https://github.com/AbdullahZaher/vibress/blob/41f587d824465698d34ac7bdb9573ff0969595f2/.github/workflows/ag02-s03-08-independent-expiry-deadlock.yml). Do not run these commands against production; the existing test harness rejects any DSN not matching its explicit localhost disposable fixture.

## 5. Concurrent session traces and invariant review

**Trace A — expiry during target-table wait:** DBA fixture locks the exact target table `ACCESS EXCLUSIVE`; independently authenticated approval is initially valid. Operator obtains installation/registry/approval advisory locks and is observed in `pg_stat_activity.wait_event_type = Lock` on the target. DB `clock_timestamp()` crosses `expires_at`; blocker releases relation lock. The post-lock final authorization read sees `expires_at <= checked_at`; operator rejects `UNAUTHORIZED`, rolls back, adds no column, writes no `COMPLETED` journal, leaves old manifest digest and original seeded checksum. **EXP-01: 5 suite runs × 5 isolated databases = 25 observed scenarios PASS.**

**Trace B — expiry after final authorization:** Test-only query barrier pauses after the final DB `checked_at` SELECT; DB clock crosses expiry. Upon release, operator finishes atomic DDL+CAS+journal and reports `APPLIED`. Journal records `FINAL_PRE_DDL` and original `finalAuthorizedAt < expires_at < completed_at`. **EXP-02: 5/5 PASS**; this demonstrates **the proposed policy**, not commit-time approval validity.

**Trace C — revocation before or after approval advisory lock:** Two real independent sessions, approval update through 0060 trigger; if revocation commits first, the operator's READ COMMITTED authorization read sees `revoked_at` and denies. If operator holds approval advisory first, the revoker's DML waits until operator COMMIT/ROLLBACK, then records independent revocation audit; a later new attempt denies. Existing `AUTH-16/17/23` tests were included in the full operator suite **five times**.

**Trace D — adversarial external DDL plus registry inversion:** External disposable admin takes table `ACCESS EXCLUSIVE`; operator holds registry `FOR UPDATE` and waits for table, externally observed via `pg_stat_activity`. Admin next requests `FOR SHARE` on the registry row. This intentionally forms a PostgreSQL deadlock. A query records **SQLSTATE 40P01** on at least one participant. After rollback of the losing transaction: either one authorized migration commits exactly once with matching journal/digest, or the operator aborts without physical DDL, registry update or completed journal. Seeded checksum is unchanged. **5/5 PASS.** The detailed log does not preserve which session was chosen as victim; no fixed victim order is claimed.

**Trace E — backend/process/COMMIT uncertainty:** A separate child operator is actually SIGKILLed after physical DDL before COMMIT; another test terminates a live PostgreSQL backend; client TCP socket is severed before COMMIT; a loopback wire proxy drops the actual PostgreSQL COMMIT CommandComplete acknowledgement. Fresh independently authenticated read-only observer checks the pinned manifest TEXT/digests, live columns, journal and seeded rows. Operator returns `INDETERMINATE` if it loses COMMIT/ROLLBACK acknowledgment and does **not** automatically repeat DDL. **21-case fault suite × 5 PASS.**

### Recovery classifications

| New independent observation | Classification | Only safe subsequent action |
| --- | --- | --- |
| Old exact manifest/digest, old physical catalog, no journal, original checksum | `ROLLED_BACK` | Reauthorize/revalidate afresh before optional retry |
| Proposed new exact manifest/digest, correct physical catalog, exactly one matching completed journal, original checksum | `COMMITTED` | `ALREADY_APPLIED_ONLY`, **never** re-execute DDL |
| Conflicting/partial registry, journal mismatch, unknown table/database, changed rows, unavailable independent read | `HALT_UNRECONCILABLE` | Stop, preserve evidence, DBA review; no automatic retry |

The reconciliation implementation is **test-only**, not a certified production recovery API. All PostgreSQL tests use disposable roles and data; passing seeded-row checksums does **not** establish complete production DR/PITR readiness.

## 6. Residual risk, accountability and integration conditions

1. **AG06-S03-08 — ACCOUNTABLE POLICY SIGNATURES MISSING (P2 blocking):** The versioned [Policy A/B record](https://github.com/AbdullahZaher/vibress/blob/2c31ed9119b88a7aff0ae8bd4c16638294a74cda/docs/platform-roadmap/execution/M03-S03-AG01-AG05-APPROVAL-EXPIRY-LINEARIZATION.md) explicitly says Architecture/Agent01, IAM/Agent05, and accountable PostgreSQL DBA approval **PENDING**. Record a choice, signer/reference, approval timestamp and explicit semantics for expiry after final authorization, then obtain **Agent 06 concurrence**. Do not infer signature or accept a security risk from this test report.
2. **Whole-operation duration budget absent:** Per-statement 10s and per-lock 2s plus 15s idle timeout do **not** bound the total multi-statement transaction. Owner/SRE must set and verify a separate maximum end-to-end operation duration, monitoring and abort policy. Until then, the proposed nonretroactive post-final expiry permits a transaction to commit later than a bounded global deadline.
3. **Owner-level credential capability:** The PostgreSQL operator owns the application table and can run broader native DDL outside the constrained renderer if its credential is compromised. Operator process isolation, service account/secret containment, telemetry and live effective-grants inventory are unverified in production.
4. **Privileged external DDL and actor-roster administration:** No locking protocol can prevent an authorized superuser from overriding ACLs or modifying roles/objects. Arbitrary external lock ordering can generate deadlocks, proven fail-closed in the disposable case. Administrative actor suspension concurrent with an in-flight authorized migration is not independently asserted to have immediate effect; its contract must be governed.
5. **Operational release proof absent:** No production backup/PITR restore test, key/secret lifecycle proof, monitoring thresholds, full multi-agent release verdicts or production rollback rehearsal has been presented. Current source restricts execution to test/development and one existing application-owned optional scalar ADD COLUMN.
6. **Integration gap:** Canonical PR #198 remains on **b5cfc068...**, while the independently verified proposed fix is on **PR #203 / 2c31ed...**. Do not call isolated results integrated release evidence. After signed policy choice, integrate only the reviewed diff without force-pushing other agent changes, rerun **exact new integrated SHA** PostgreSQL/CI suites and submit to Agent 06.

## 7. Final Agent02 decision record

| Required gate | Evidence-based result |
| --- | --- |
| **AG06-S03-08 Database Verification** | **PASS (technical, proposed Policy A, disposable PG16 only); formal finding BLOCKED** |
| **Authorization Timing** | **VERIFIED for FINAL_PRE_DDL; policy NOT formally approved** |
| **Lock Order** | **SAFE for cooperative actor protocol; noncooperating inversion produces detected 40P01 and fail-closed abort** |
| **Concurrent Revocation** | **PASS** in existing real-PG two-session tests, five full-suite runs |
| **Catalog Drift** | **PASS**, historical unchanged false-APPLIED assertion 5/5 plus all fault runs |
| **Crash Recovery** | **PASS** for real disposable SIGKILL/TCP/backend/COMMIT-drop cases; production readiness unverified |
| **Journal Integrity** | **PASS** in observed one-journal, CAS, rollback and recovery cases |
| **Reviewed SHA** | **2c31ed9119b88a7aff0ae8bd4c16638294a74cda** |
| **Ready for Integration** | **NO** pending accountable Policy A/B approval + operation deadline; integrated rerun required |
| **Merge** | **NOT AUTHORIZED** |
| **Production** | **NO-GO** |

**Owner/condition register:** IAM Agent05 + Architecture Agent01 + accountable DBA: signed policy choice and whole-operation time budget **before any merge/acceptance**; Integration Lead: PR #203's exact three-file post-baseline delta integrated into #198, update stale PR description, exact-SHA CI; Agent06: independent revalidation and written final verdict **after** integration. No expiry waiver or High/Critical risk acceptance was issued. There were no production changes to roll back.

## 8. Primary references (consulted 2026-11-17)

- [PostgreSQL 16 date/time functions](https://www.postgresql.org/docs/16/functions-datetime.html): `clock_timestamp`, `statement_timestamp`, `transaction_timestamp`.
- [PostgreSQL 16 READ COMMITTED transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html): statement-level fresh snapshots.
- [PostgreSQL 16 explicit locking and deadlock detection](https://www.postgresql.org/docs/16/explicit-locking.html): row/table/advisory locks, deadlock victim abort.
- [PostgreSQL 16 session lock management](https://www.postgresql.org/docs/16/runtime-config-locks.html): deadlock detection interval.
- [PostgreSQL 16 client connection settings](https://www.postgresql.org/docs/16/runtime-config-client.html): lock, statement and idle-transaction timeouts.
- [PostgreSQL 16 COMMIT protocol](https://www.postgresql.org/docs/16/protocol-flow.html).
- [Node 24.22.3 security release, 2026-11-11](https://nodejs.org/en/blog/release/v24.22.3).
- [Agent06 baseline review #5938896659](https://github.com/AbdullahZaher/vibress/pull/198#pullrequestreview-5938896659), [canonical PR #198](https://github.com/AbdullahZaher/vibress/pull/198), [isolated PR #203](https://github.com/AbdullahZaher/vibress/pull/203), [Issue #197](https://github.com/AbdullahZaher/vibress/issues/197).

**Separation of duties:** This is Agent02's evidence-based specialist report. Agent02 did **not** certify its own change as Agent06, and no human architecture/IAM/DBA signatures, production authorization, release or merge are claimed.
