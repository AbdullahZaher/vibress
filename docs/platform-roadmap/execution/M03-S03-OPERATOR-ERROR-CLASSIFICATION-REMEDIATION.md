# M03-S03 — Operator Error Classification Remediation

**2026-11-17 (Asia/Riyadh), Agent03 adversarial product-security owner and Agent05 IAM cross-review**  
**Finding:** AG06-S03-10 — P3 OPEN, **confirmed source-level operational/IAM classification confusion**.  
**Scope:** isolated nonproduction TypeScript review only; no canonical #198 or production runtime changes, no migration/grants. Owner Policy A / D1 2517ms test-only decision does not authorize implementation/merge.

## 1. Observed source defect

Policy A operator blob `31b1e862f594434944fec516f768265baf794525` has a `SchemaMigrationOperatorError` union: `UNAUTHORIZED`, `STALE_PLAN`, `CATALOG_DRIFT`, `UNSUPPORTED`, `JOURNAL_CONFLICT`, `INDETERMINATE`. In `executeApprovedAdditiveColumn` catch, after attempted `ROLLBACK`, unknown PostgreSQL exceptions, **including a genuine `55P03` lock timeout, are sent to `deny("UNAUTHORIZED", ...)`**. The source sets `SET LOCAL lock_timeout='2000ms'`, statement_timeout='10000ms', idle=15000ms; a lock wait is not evidence of a revoked/expired/invalid actor.

Agent04's real [PG16 contention run #44140690893](https://github.com/AbdullahZaher/vibress/actions/runs/44140690893) observed ten `55P03` lock failures reported externally as `UNAUTHORIZED`. This is a known misclassification, distinct from Policy A expiry and the D1 total deadline. PostgreSQL may also emit `40P01` deadlock or `57014` statement cancel; the current generic fallback is likewise unsuitable to assert an IAM denial.

The normal CLI currently logs only Error.name for refused execution; it does not expose raw DSN or SQL. New typed errors must remain sanitized and **never** be handed to API/plugin/worker as a DDL execution entrypoint.

## 2. Proposed fail-closed, sanitizer-only taxonomy

| Source / condition | Internal code | Security/recovery rule |
| --- | --- | --- |
| Exact verified actor/plan/role/approval/provenance denial | `UNAUTHORIZED` | Do not emit physical DDL/completed journal; no retry without new owner action |
| SQLSTATE `55P03`, including PG lock_timeout | `LOCK_TIMEOUT` or `LOCK_NOT_AVAILABLE` | Before COMMIT, only classify after acknowledged ROLLBACK or positive backend termination/fence; no automatic DDL replay |
| SQLSTATE `40P01` | `DEADLOCK_DETECTED` | PG aborts victim; confirm transaction outcome and retain original authorization for auditable decision, no blind retry |
| SQLSTATE `57014` | `QUERY_CANCELED` | Verify whether deadline vs external cancel vs statement timeout caused it; do not infer a D1 violation from code alone |
| Verified D1 budget exhaustion before COMMIT | `DEADLINE_EXCEEDED` | Only definite when rollback is acknowledged/termination proven and no COMMIT dispatched |
| COMMIT sent; lost/late/unknown ACK, or rollback unproven | `INDETERMINATE` | Quarantine; fresh trusted fenced recovery; never false ROLLED_BACK |
| Registry, physical column and journal inconsistent / cannot safely fence | `HALT_UNRECONCILABLE` | No retry; alert and require incident authority |
| Stale plan, catalog drift, journal mismatch | existing `STALE_PLAN`, `CATALOG_DRIFT`, `JOURNAL_CONFLICT` | Preserve existing stable contract and exact manifest/operation binding |
| Unrecognized PG/transport error before COMMIT | `OPERATION_FAILED` internally or `INDETERMINATE` if rollback unknown | Never label IAM and never expose raw SQLSTATE/details to external actors |

**Absolute precedence:** a COMMIT-dispatched ambiguous outcome remains `INDETERMINATE` regardless of underlying SQLSTATE. Failed rollback or out-of-band connection termination not proven also remains `INDETERMINATE`. Exact final approval validity depends on server `clock_timestamp()`, while D1 elapsed time depends on monotonic host clock: neither may be inferred from PG statement timeout alone.

## 3. Narrow proposed code diff (NOT applied to production)

- Extend the internal typed code union additively with `LOCK_TIMEOUT | DEADLOCK_DETECTED | QUERY_CANCELED | DEADLINE_EXCEEDED` (plus internal `HALT_UNRECONCILABLE` if explicitly exported to recovery only). Do not rename existing codes or mutate renderer/migration.
- Centralize SQLSTATE extraction from `unknown` errors via strict `typeof code === "string"` and allowlist, with *no* dependence on untrusted `message`, `detail`, `hint`, `sql`, `stack` or credentials. Map SQLSTATE only after determining COMMIT was never dispatched and an actual rollback was acknowledged.
- Preserve existing physical DDL/journal atomicity; no retry loops, no fallback to authorization success, no CREATE/ALTER scope change.
- Preserve public CLI refusal envelope; add sanitized internal telemetry/event fields `category`, `stage`, `sourceSha`, `correlationId`, `rollbackProven`, `commitDispatched`, `deadlineBreached` (without principal IDs or secrets). Any public status change is versioned and reviewed for caller compatibility.
- Write actual PG16 negative tests: 55P03 via independent ACCESS EXCLUSIVE blocker and 2-second operator wait; 40P01 via known external lock cycle; 57014 via scoped cancellation; true invalid approval => UNAUTHORIZED; post-DDL pre-COMMIT timeout => acknowledged ROLLBACK; server COMMIT+lost ACK => INDETERMINATE, no replay; and a disconnected / unset rollback state => INDETERMINATE.
- **Consumer compatibility:** verify callers of `executeApprovedAdditiveColumn` and CLI log expectations. Current CLI prints Error.name only; preserve that if code shape evolves. Before any API/worker client import, reject expansion as out of owner-approved scope. Audit dashboards and alert routing must distinguish IAM denials from PG contention.

## 4. Existing vs pending executable evidence

- Source-proved generic catch -> UNAUTHORIZED for unknown `55P03`; historical Agent04 lab observed this exact mislabel. **AG06-S03-10 OPEN until changed and rerun**.
- Original PG16 operator/auth/expiry negative tests and fault suite passed on source-pinned older Policy A SHA, not current hypothetical error-mapping source.
- New isolated security branch includes real PG trusted-actor and backend-probe tests; **no production code error-mapping change was committed**. A targeted real-PG SQLSTATE reproducer **AG06-S03-10** has been ADDED to the isolated test branch: a separate true PG connection must emit `55P03` while waiting on a held ACCESS EXCLUSIVE table lock; the existing operator under the same held lock is expected to surface `UNAUTHORIZED` (current bug), with no DDL/journal and original seeded checksum. New exact-SHA CI **PENDING** for this addition; this test does not fix production classification.
- Deadline D1 actual CLI supervisor remains unimplemented. Retain Error severity classification independent of authorization/revocation and actual PostgreSQL cancel/rollback proof.

## 5. Risks, remediation owner, rollback and gate

**P3 impact:** inaccurate auth denial metrics/alerts and potentially unsafe caller retry/incident response, with unchanged physical database rollback semantics in tested cases. **Do not mistake it for a confirmed IAM bypass.** Agent03 owns sanitized mapping/negative test patch; Agent05 cross-reviews authorization semantics; Agent02 independently validates SQLSTATE under real PG16 and transaction resolution; Agent06 re-verifies final integrated SHA.

**Rollback:** document-only proposal; no schema/grants/operator changes. Future narrow TypeScript remediation must be on isolated branch with pinned source and green full CI, with revert commit and no database migration required. Any failure after COMMIT dispatch remains INDETERMINATE even if the operator connection is destroyed.

**References (verified 2026-11-17):** [PostgreSQL 16 runtime timeout settings](https://www.postgresql.org/docs/16/runtime-config-client.html), [PostgreSQL signaling functions](https://www.postgresql.org/docs/16/functions-admin.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). **AG06-S03-10: REMEDIATION RECOMMENDED / OPEN, not waived.**

**Regression note:** reproduce old incorrect classification explicitly with a **passing negative assertion**, not a false claim of successful remediation. A future remediated source must invert that assertion to `LOCK_TIMEOUT` and independently verify actual rollback, D1 and COMMIT safety.
