# M03-S03 — Least-Privilege Deadline Watchdog Design

**2026-11-17 (Asia/Riyadh) · AG05 IAM + AG03 AppSec, independent threat-model agreement.**  
**Decision:** **IAM-WD-01 DESIGN BLOCKED pending verifiable atomic backend binding/least privilege and human IAM+DBA approval.** Owner authorized *only* `Policy A` + `D1=2517ms` in disposable test/development; **not** a watchdog grant, migration, privileged function, D2, release, or production.

## 1. Trust-boundary diagram

```text
  Untrusted API/Worker/Plugin/Tenant       [NEVER CALLS operator or watchdog]
                      X
                      |
          Dedicated nonpooled operator process
          | authenticated operator PG LOGIN; validated plan/installation
          | monotonic T0 before Client.connect, immutable op ID/budget
          v
          PostgreSQL dedicated operator backend (PID+start+db OID+login)
          | advisory fence -> registry -> approval -> target -> catalog
          | Policy A clock_timestamp -> DDL -> CAS/journal -> COMMIT ACK
          |
          [no implicit authority crossing]
          |
    Independently authenticated watcher/control process
          | independently owned, bounded, auditable, fail closed
          v
    PROPOSED server-mediated exact-backend cancellation gate
          | atomic identity + authorization + target signaling required
          | **UNIMPLEMENTED / NO PRIVILEGE GRANTS**
          v
    PG result settlement -> verified rollback/backend termination/fence
          |
          +--> prior COMMIT sent? INDETERMINATE + fresh trusted reconciliation
```

**Critical boundary:** JavaScript `setTimeout` or TCP `socket.destroy()` does NOT prove a server transaction ended. `pg_cancel_backend(pid)` returns whether a signal was sent, not proof of ROLLBACK. `pg_terminate_backend(pid)` also has conditional behavior and cannot retroactively undo a sent COMMIT. PostgreSQL `pg_stat_activity` is an observation, not an authorization oracle.

## 2. Attacker capability, impact and mandatory negative assertion

| Threat / adversary | Impact | Mandatory defense and test |
| --- | --- | --- |
| Compromised runtime worker/plugin/tenant request | Generic cancellation/DDL pivot | No watchdog import, endpoint, DSN, EXECUTE or role membership; runtime's direct `pg_cancel_backend` / `pg_terminate_backend` of operator rejected in real PG |
| Forged PID or operation token | Kill unrelated operator | No client-provided PID authority; signed/opaque internal binding tied to immutable original op ID, deny different PID and forged ID |
| PID reuse after exit/reconnect | Cancel different backend | Bind exact full `backend_start`, DB OID, PG session identity; reject stale/replaced snapshot; **still needs server-side atomic TOCTOU closure** |
| Fake `application_name` | Spoof supervised process | Never authorize using this mutable caller-chosen diagnostic value |
| Wrong database or wrong LOGIN | Cross-installation/role denial of service | Exact database OID+name, session_user login, installation-to-registry check, no broad database role membership |
| Changed `current_user` via SET ROLE | Privilege boundary bypass | Dedicated nonpooled session, operator current_user=session_user observed at execution; watchdog cannot infer post-connect current role solely from `pg_stat_activity` |
| Pooled/reused connection | Stale binding targets next request | No pool, one request/one authenticated dedicated session, evict on ambiguity, deny reused session |
| Malicious/stale watchdog credentials | Unbounded signal authority | Independent short-lived control credential, dedicated role, no arbitrary SQL surface, no inherited DDL, no `pg_signal_backend` blanket grant |
| Inspect-then-signal TOCTOU | PID reused between read and `pg_cancel_backend(pid)` | Do **not** certify two separate queries; need server-side atomic privileged gate or independently verified equivalent (design not provided) |
| Backend reboots / process crash | Old identity invalid | Fail closed, quarantine old client, fresh trusted fence/status recheck, no replay |
| COMMIT already processed | Late cancel cannot undo commit | No rollback claim, INDETERMINATE until fresh catalog/manifest/journal evidence |
| Network partition / watchdog crash | Unbounded or ambiguous in-flight transaction | Separate supervisor process, explicit escalation/circuit breaker, stop new work and preserve uncertainty; T15 separately measured |
| Forged/privileged SECURITY DEFINER target | Privilege escalation | No new function here; any future gate fixed `search_path`, REVOKE PUBLIC in same transaction, verified caller, exact target, explicit grants only, DBA/Agent06 audit |

## 3. Backend identity requirements

An immutable control-plane attestation must include: opaque operation ID and installation ID, plan digest, request origin, monotonic T0 and D1 budget, operator backend PID, full microsecond `backend_start::text` (no JS Date precision truncation), database OID+name, authenticated PostgreSQL `session_user`/observed login, expected operator role, operator-only dedicated connection lease, target state and generation. The watchdog must authenticate its own identity; user input never creates/updates binding. Audit every refusal by sanitized operation correlation ID only.

**Read-only real-PG negative probe on isolated test branch:** query `pg_stat_activity` from disposable admin session and compare PID, backend_start, DB OID/name, login, backend type; deliberately corrupt individual fields, operation ID, lease, "dedicated" flag and state; all must be refused. Separately use distinct runtime LOGIN and assert PostgreSQL 42501 on attempted cancel/terminate of operator. After a real operator connection is closed and replaced, stale session binding must not match. **This does not prove secure cancellation** because observation + later signal remains racy and `pg_stat_activity` does not assert current SET ROLE or that the operator transaction still owns the installation fence.

## 4. Privilege matrix (desired, NONE granted by this report)

| Principal | DDL / operator | Trusted actor/approval mutation | Cancel / terminate | Reason |
| --- | --- | --- | --- | --- |
| Tenant, plugin, API, worker, runtime DB role | DENY | DENY | DENY | Untrusted surface |
| Individual AUTHOR, APPROVER | No DDL; separately scoped approved submit/approve/revoke functions | Only authenticated permitted action | DENY other backend | Separation of duty |
| Dedicated schema operator LOGIN | Restricted process uses table owner native privilege; renderer limits SQL | Read-only status | Cannot signal other sessions | Already high-value credential, isolate |
| Independent watchdog control LOGIN (proposed) | **DENY** | DENY | **Only exact bound target via approved mediated gate** | Not yet implementable with current ordinary PG grants |
| DBA fixture superuser | Fixture only; privileged simulation | Fixture only | Fixture only | Never a deployable watchdog credential |
| Named human DBA/IAM authority | Governance decisions | Governance decisions | Approves any proposed narrow gate | Not a runtime credential |

**Security blocker:** PostgreSQL 16 native role `pg_signal_backend` can signal **other** backends and is substantially broader than one operation; granting it to runtime is prohibited. A watchdog using the same operator-login role would inherit the sensitive owner DDL reach. A naive `SECURITY DEFINER` function with PUBLIC EXECUTE is dangerous; even a fixed-path/allowlisted function can retain a PID reuse race unless the signal target and verified session identity are bound in a provably atomic server-side action. A `SELECT ... FROM pg_stat_activity WHERE ...` followed by `pg_cancel_backend(pid)`, including within one SQL statement, is **NOT certified as an atomic identity-checked signal**. Stop implementation unless PostgreSQL specialists demonstrate and independently test such a guarantee or an equivalent supported backend control.

## 5. Two candidate architectures — neither yet approved

**A. External OS process supervisor, no DB-wide signaling rights:** tightly scope to own dedicated operator child process using OS process identity (PIDfd or equivalent), kill/restart child, force-close its socket, quarantine per-request connection. No broad database signal grants. This may reduce cross-session signal risk but **cannot certify PostgreSQL backend rollback or prevent a previously dispatched COMMIT** after network partition. Requires DBA proof of connection-liveness/fence convergence, T15 bounded cleanup and a stop-all-operations contingency.

**B. Independently owned privileged server-side cancellation broker (requires explicit separate authorization):** narrowly callable fixed-`search_path` routine with authenticated operator-control caller, exact immutable backend identity and operation binding, target checks immediately before atomic signaling, and allowlisted time-limited grant. Detailed implementation must prove no PID reuse TOCTOU or other privilege escalation in PG16 internals; no generic arbitrary-PID operation. **This route requires a sensitive SQL/migration/privileged function change** and is therefore **STOPPED** pending written risk, human IAM/DBA+Agent06 concurrence, verified backups, tested rollback/migration replay, documented scope/time/expiry, and owner release record. No such function created in these tests.

## 6. Mandatory acceptance gates / unresolved negative matrix

| Test | Current evidence |
| --- | --- |
| Wrong PID/start/db OID/name/login/operation ID/expired token/no binding/pooled lease | **Read-only prototype tests implemented; real-PG CI result must be sourced from exact new branch SHA** |
| Runtime cannot signal operator and cannot inherit `pg_signal_backend` | **Real-PG negative test added** |
| Backend replaced / stale identity | **Real-PG negative test added; does not simulate literal PID reuse** |
| Literal recycled PID, SET ROLE mutation, concurrent cancel during COMMIT, active transaction fence proof | NOT TESTED |
| Atomic identity+signal TOCTOU closure | **NOT IMPLEMENTED / BLOCKED** |
| Watchdog process death, loss of trusted control channel, stale token after supervisor restart | NOT TESTED |
| D1 preconnection, T13 COMMIT ACK/T14 success inside 2517ms, separate T15 cleanup/rollback objectives | NOT INTEGRATED |
| COMMIT late/lost ACK and exact same-operation no replay | Historical Agent04 PG16 fault tests; no new integrated watcher evidence |

**Agent05 technical verdict:** REQUEST CHANGES, least-privilege control not certified. **Agent03 verdict:** REQUEST CHANGES, no verified server-side identity-signal atomicity or wrong-target signal prevention. Both reject new runtime privileges and a misleading "secure watchdog" claim; no unresolved disagreement.

## 7. Required authorization, containment and recovery

Before any elevated control-plane grant: written risk assessment (unrelated-session termination = availability/security incident), exact capability and target predicate, named human DBA and IAM signatures, Agent06 independent concurrence, disposable backup/migration replay/rollback evidence, deny-by-default ACL, time-limited access, and sanitised append-only audit. No real prod/shared credentials or sessions are permissible.

T15: monitor separate cleanup/reconcile bounds and alert on overdue rollback; close/quarantine uncertain connection; reacquire installation fence or prove backend termination before declaring ROLLED_BACK; once COMMIT was sent, never assume cancellation reverses it. Fresh-session compare exact registry manifest, journal and catalog; inconsistent state = HALT_UNRECONCILABLE, no blind retry.

**Research 2026-11-17:** [PG16 server-signaling semantics](https://www.postgresql.org/docs/16/functions-admin.html), [PG16 backend_start/pg_stat_activity](https://www.postgresql.org/docs/16/monitoring-stats.html), [PG16 predefined roles](https://www.postgresql.org/docs/16/predefined-roles.html), [PG16 SECURITY DEFINER hardening](https://www.postgresql.org/docs/16/sql-createfunction.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

**First actual CI run:** [#44171230249](https://github.com/AbdullahZaher/vibress/actions/runs/44171230249) on `33f627b02c44a6fa8262dfde64b2f779342387b4` PASS (the two IAM-WD-01 read-only backend-binding negative tests are included in the 7/7 selected group). This proves identity mismatches and runtime permission denials only, **not** actual cancellation atomicity, literal PID reuse or a deployable watchdog. Final augmented tests and docs have a different source SHA and require new CI.

## 8. Real-PG negative results at the exact source, not secure signaling approval

[GitHub Actions #44172546173](https://github.com/AbdullahZaher/vibress/actions/runs/44172546173) **SUCCESS** on test-bearing commit `70bdc0453e0f21391448f0e55c980d021e0e4bde`; Node v24.22.3, PostgreSQL 16.16. **IAM-WD-01A/B** tests are included in targeted **9/9 PASS**, full operator suite **56/56 PASS**, real fault suite **21/21 PASS**, test DB leakage 0. Wrong PID/start/database OID/name/login/token/lease/shared-session flags and missing binding all refuse at the read-only observation layer; real PG rejects runtime `pg_cancel_backend` and `pg_terminate_backend` of the distinct operator with SQLSTATE `42501`; reconnect makes old PID+backend_start evidence stale.

**Limit remains mandatory:** none of those tests executes a PID-check-plus-signal under a proven atomic session binding. They do not test genuine PID reuse of the same integer, hostile current_role changes, DB-wide grants, a certified cancellation broker, real watchdog SIGKILL/network loss, or D1 T13/T14 in deployed CLI. **Watchdog Least Privilege = INCOMPLETE / Backend Binding = INCOMPLETE / Cross-session SIGNAL correctness = NOT CERTIFIED.** No new privileged SQL/function/grant was introduced.
