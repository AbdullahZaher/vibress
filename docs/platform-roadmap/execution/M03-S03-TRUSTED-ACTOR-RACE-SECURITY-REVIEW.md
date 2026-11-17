# M03-S03 — Trusted-Actor Race Security Review

**2026-11-17 (Asia/Riyadh) · Agents 05 (IAM) + 03 (adversarial product security) technical joint review**  
**Governance:** Owner Policy A `FINAL_PRE_DDL` + D1 `2517ms` **approved only for restricted disposable PG16 development/test** ([P04 decision](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6959358323)); **human IAM and DBA PENDING**. No Agent06 new approval; canonical PR #198 unmodified; merge/production **NO-GO**.

## 1. Source-pinned boundary inventory
- Canonical #198: `b5cfc0687076c86a7450a8a785a072f6e63ad289`, still Draft and lacking Policy A+D1 integration.
- Policy A/P04 #203: `1fb5e1600fd2300d7509ec998ff3b1fa1fff5078`; source operator blob `31b1e862f594434944fec516f768265baf794525`; 0059 blob `3c54d698363875c5af701f750a2900f6dcd61909`; 0060 blob `d8b1e50a0a4dd347fde235ae7cb1a12468249719`.
- 0060 `platform_schema_trusted_actors` has `login_name`, `principal_id`, `actor_kind`, `identity_mode`, `active`, `registered_at`. **No actor generation/epoch, deactivated timestamp, or append-only actor-state transition audit**. Guard allows roster DML only by authenticated owning DB LOGIN or separately governed superuser (using `session_user`), even if a grant is accidentally issued to an actor.
- 0060 plan and approval provenance guards derive authenticated `session_user`; author and approver must be separate active trusted actors; `SET ROLE`/dual-grant attempts must not impersonate an independently authenticated login.
- Operator: installation advisory transaction fence → registry row `FOR UPDATE` → approval advisory transaction fence → initial approval check → trusted actor roster read (`active`) → target `ACCESS EXCLUSIVE` → catalog/ACL/row checks → **final approval-timestamp and revocation recheck** with fresh `clock_timestamp()` → one optional scalar `ADD_FIELD` → CAS/journal → COMMIT. **Final query does NOT re-read `trusted_actors.active` or any epoch**.
- Roster update guard neither takes the same installation/approval advisory fence nor locks the registry. Hence a privileged owner may commit an active-state change while operator is waiting on the table; neither `READ COMMITTED` nor the approval lock makes this roster state immutable.
- Normal authenticated approval **revocation** is a separate event: 0060 approval trigger uses the approval-key advisory lock. Policy A's approval expiry is another separate event. Do NOT equate either with privileged actor-roster deactivation.

## 2. Policy question requiring owner/IAM decision
**Which privileged roster-deactivation rule is intended?**

**Option R1 — Immediate in-flight invalidation:** a committed `active=false` for AUTHOR or APPROVER **before final pre-DDL authorization** must deny even if an approval exists; prior approval becomes unusable until explicit reauthorization. Need actor identity state/version protection, race serialization, deterministic order, tested no new deadlocks. If deactivation is permitted to race AFTER valid final authorization, specify nonretroactivity separately.

**Option R2 — Future-work-only deactivation:** a migration already in progress and initially validated can still commit after actor deactivation; a *new* migration/admission fails while inactive. Explicitly define exactly when "in progress" begins (approval advisory lock, roster read, or other), how reactivation affects prior approval, and record signed policy. This is **not** implied by owner-approved Policy A expiry semantics.

**Pending owner+human IAM choice: CONTRACT-DEPENDENT, NOT VERIFIED VULNERABILITY.** A successful race reproduction proves observable behavior but not a breach without a normative R1 rule. Do not modify production actor semantics or the 0060 trigger until a separate approval is recorded.

## 3. Deterministic real PostgreSQL 16 security tests added on isolated branch
The test fixture is the original trusted disposable per-installation PG16 environment with independently provisioned author/approver/operator/runtime; no shared/production DB or added grants. New cases in `tests/integration/platform-schema-migration-operator.test.ts`:

| ID | Sessions, barrier and assertions | Interpretation |
| --- | --- | --- |
| IAM-RACE-01A | Real external `ACCESS EXCLUSIVE` table-lock blocker; operator `pg_stat_activity.wait_event_type='Lock'`; owner commits `APPROVER.active=false` before releasing blocker; assert final authorization DB timestamp after deactivation, physical column, single journal and seeded checksum | **Observed stale roster-state acceptance if PASS**; policy-dependent |
| IAM-RACE-01B | Same, deactivates `AUTHOR` | Same |
| IAM-RACE-01C | Owner deactivates approver **before initial roster read**; expect UNAUTHORIZED, original manifest/checksum, zero journal and no physical column | Expected fail closed |
| IAM-RACE-01D | Operator owns approval-key advisory lock but test gate pauses **before actor roster read**; owner commits deactivation; expect deny with no DDL/journal | Demonstrates actor changes do **not** serialize on approval fence and initial roster check does detect prior committed state |
| IAM-RACE-01E | Owner deactivates then reactivates before first roster read; existing `active=true` permits authorized execution, demonstrating absence of epoch or explicit invalidation rule | Contract-dependent; no immutable "revoked since approval" evidence |
| IAM-RACE-01F | Owner starts transaction, deactivates approver, then ROLLBACK; server roster remains active and valid plan applies, seeded checksum unchanged | Rolled-back privileged update is NOT a committed deactivation |
| IAM-RACE-01G | Real table lock wait, concurrent approver revocation queues behind approval advisory key while owner roster deactivation commits without waiting; first already-fenced operation can complete, next attempt denies and revocation audit remains one row | Demonstrates distinct serialization contracts; review normative roster effect |

Each race runs on a new disposable PG database and a real operator session. The table-wait tests use an actual competing PG connection and observed server Lock wait, not a mocked timer; test-only proxy only exposes a synchronization barrier. Check the **exact new CI SHA** for PASS before claiming executed success. No migration SQL, registry authority, physical plan, runtime grant, or operator code changed. Test passwords and fixture cleanup remain controlled by the existing loopback-only harness.

**Additional coverage still required, not silently marked PASS:** actor deactivation during installation/registry/approval lock waits, exact post-final timestamp transition, D1 exhaustion while deactivating, actor change after database error, backend crash during state transition, independently agreed actor reactivation policy, and authoritative owner/IAM approval of R1 or R2. IAM-RACE-01F/G add rollback and concurrent revocation tests without changing privileged authority.

## 4. Proposed narrow correction if R1 is approved
- **Prefer a versioned actor-state epoch with durable append-only privileged roster transition evidence**. The exact author+approver principal IDs, status, generation, and scope must be bound to the final authorization decision, not trusted solely from a stale initial read. Reset to active must not silently rehabilitate a previously revoked approval; new approval/reissuance may be mandatory.
- **Serialize roster updates** with a vetted consistent lock hierarchy that cannot invert the existing registry `FOR UPDATE` → approval advisory → target table lock sequence. A naive final `SELECT ... FOR SHARE` of roster rows **after** target ACCESS EXCLUSIVE may introduce deadlock cycles with provisioning, and an unsynchronized final SELECT alone leaves a small post-check window. Require DBA independent lock graph + real PG16 two-session trials.
- One possible high-level ordering to investigate: installation registry fence before any approval- or actor-state mutation, then a bounded actor-version fence owned until COMMIT and a single post-table catalog/actor/approval DB-timestamp read. Actor-state transition must participate in the same fencing contract. Do not change final Policy A expiry point or insert blocking external calls between final authorization and DDL.
- Treat privileged actor-state mutation as a **sensitive IAM decision** requiring owner/DBA/Agent06 concurrence, migration 0060 rehearsal, isolated backup/restore, bounded scope, explicit rollback plan and an audited actor-state transition record. **No schema/trigger/function production edits are authorized here.**

## 5. Decision, risks and separation of duties
**Agent05:** narrow owner Policy A final approval timestamp/revocation semantics confirmed on earlier tested source, but **trusted roster deactivation semantics unresolved; REQUEST CHANGES for R1/R2 decision**.  
**Agent03:** same code path independently identifies a stale active-state read and no epoch/serialization; categorizes **authorization consistency risk**, not a proved exploit until R1 is selected. Recommends real independent PG test and fail-closed release gate. **No disagreement on current evidence; no purported human endorsement.**

**IAM-RACE-01:** CONTRACT-DEPENDENT; if owner selects R1 and two-session tests show APPLIED after a committed privileged deactivation, classify as VERIFIED authorization policy violation on that source. If R2 is approved, explicitly document nonretroactivity and verify new attempts deny. Any ambiguous deactivation sequence fails closed for future admission. Owner/IAM decision **PENDING**.

**Rollback/containment:** this branch changes **tests/docs only**, no physical database outside auto-destroyed disposable CI fixtures, no production grants or migrations. If a race-remediation migration becomes necessary, stop and obtain a separate risk/backup/migration rehearsal/human approval package. Preserve audit history and source identity.

**Official references checked 2026-11-17:** [PostgreSQL 16 locking](https://www.postgresql.org/docs/16/explicit-locking.html), [READ COMMITTED](https://www.postgresql.org/docs/16/transaction-iso.html), [clock_timestamp](https://www.postgresql.org/docs/16/functions-datetime.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

**First executed source-pinned CI evidence:** [#44171230249](https://github.com/AbdullahZaher/vibress/actions/runs/44171230249) **SUCCESS** at security branch initial commit `33f627b02c44a6fa8262dfde64b2f779342387b4`: 7/7 selected new cases, 53/53 full operator/identity/expiry tests, 21/21 real PG fault tests, PG16.16/160016, 0 disposable DB leaks. The later 01F/G and SQLSTATE addition is a **DIFFERENT SHA**; do **not** transfer PASS until its own CI succeeds.
