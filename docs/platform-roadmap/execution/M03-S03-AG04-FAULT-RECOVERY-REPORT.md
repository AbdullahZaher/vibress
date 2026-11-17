# M03-S03 — Agent 04 PostgreSQL 16 Fault, Concurrency and Recovery Certification

**Status:** **BLOCKED**. **Production NO-GO / Merge NOT AUTHORIZED**.  
**Date:** 2026-11-17 (Asia/Riyadh). **Owner:** Agent 04. Independent Agent 06 review remains mandatory.  
**Original review:** PR #198 at `a4a8eb8290950cec3079d89f49ca965c7298f29b`.  
**Isolated remediation:** Draft PR #200, branch `fix/m03-s03-agent04-pg-fault-recovery-20261117`, based on the exact reviewed SHA.  
**Coordination:** Agent 02 owns catalog-lock/effective privileges; Agent 05 owns approval provenance/identity; this branch does not alter the privileged production operator source.

## Executive root-cause / risk analysis

- **AG06-S03-03 — OPEN, P2 BLOCKING:** An installation-scoped PostgreSQL advisory lock is *cooperative* and cannot prevent a noncooperating session from issuing DDL. The reviewed operator reads live catalog metadata under `SERIALIZABLE` but does not acquire an explicit conflicting relation lock before catalog verification. The targeted independent-session test has **observed an external ALTER TABLE succeed after the advisory fence, while the operator still returned `APPLIED`**. This is unacceptable catalog drift and may produce a completed journal inconsistent with the true physical schema. Evidence: [CI #44041122761](https://github.com/AbdullahZaher/vibress/actions/runs/44041122761) and [#44041473497](https://github.com/AbdullahZaher/vibress/actions/runs/44041473497). Do not weaken or skip the regression to achieve green CI. Requires Agent 02 review, table-level locking before catalog inspection and the same test retested on the exact reviewed fix.
- **AG06-S03-05 — OPEN pending independent certification:** The original operator has `INDETERMINATE` on failed COMMIT/ROLLBACK but cannot itself recover a connection-loss outcome. A new **test-only**, fresh-session read-only reconciliation state machine compares the independently pinned full manifest texts, digest values, actual column types/defaults, completed journal, operator role and the seeded data checksum. It returns `ROLLED_BACK / REQUIRES_NEW_AUTHORIZATION_CHECK`, `COMMITTED / ALREADY_APPLIED_ONLY`, or `HALT_UNRECONCILABLE / DENIED`. This is diagnostic evidence, **not** a production-entrypoint or authorization grant.
- **AG06-S03-06 — addressed in code; exact-head validation required:** Official Node security release on **2026-11-11** is **Node 24.22.3**, fixing HIGH issues involving HTTP/2/TLS. Affected Node24 CI version inputs and API/Worker Docker bases now use 24.22.3; API/Worker use Docker Hub's verified multi-platform digest `sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`. Dedicated CI logs show `node: v24.22.3` and PG `160016` ([#44041817864](https://github.com/AbdullahZaher/vibress/actions/runs/44041817864)). This does not certify all image scans/builds without current successful CI.
- **AG06-S03-07 — corrected:** The original fixture creates **four** isolated local PostgreSQL databases **A–D** (not two); the runbook now records purpose, role patterns and cleanup. New Agent04 fault tests create additional isolated **E–Y** fixtures only when individual cases run, with a catalog query that fails teardown if any fixture database or role remains.

## Disposable harness design

The harness lives in `tests/integration/platform-schema-migration-fault-injection.test.ts` plus `scripts/platform/m03-s03-fault/`. The parent requires the fixed, explicit disposable test DSN `postgresql://vibress:vibress@127.0.0.1:5433/vibress`; fixture names are randomly suffixed `vibress_s03_<letter>_<hex>`. Every test creates a separate DB, author, approver, operator and runtime role; no real credentials are printed or uploaded. Native PostgreSQL connections perform actual DDL, rollback, COMMIT and external competing statements. The operator itself is **unmodified**; bounded SQL interceptors exist only in the test.

Disruption types:
1. Named SQL query barriers and deliberate exceptions in the test adapter (precise before/after stage, not production fault injection).
2. Actual `pg_terminate_backend` of an identified operator backend.
3. Destruction of a real PostgreSQL client's TCP socket, followed by a new independent connection.
4. A separate Node operator process with IPC barrier after successful physical DDL; parent sends **SIGKILL**, waits for exit signal, reconnects and checks rollback.
5. A test-only loopback TCP proxy that observes server `COMMIT CommandComplete` and **drops that actual wire acknowledgment** before it reaches the operator's client; its evidence must be inspected after CI.
6. Independent external DDL/admin sessions, advisory/table-lock contention, and two independently approved different plans.

## Test matrix and factual evidence

The first focused run [#44041122761](https://github.com/AbdullahZaher/vibress/actions/runs/44041122761) observed **10/12 PASS**. The second [#44041473497](https://github.com/AbdullahZaher/vibress/actions/runs/44041473497) observed **15/16 PASS** after correcting a *test-only* table-lock inspection deadlock. [#44041817864](https://github.com/AbdullahZaher/vibress/actions/runs/44041817864) observed **17/18 PASS**. All three jobs are **FAIL** because the confirmed noncooperating external DDL race remains unremediated. The number of tests has since increased; prior outcomes must **not** be attributed to the latest HEAD.

| Phase / operation | Mechanism | Proven before latest changes |
| --- | --- | --- |
| Before authorization | Adapter exception before approval SELECT | PASS |
| After authorization | Adapter exception after approval SELECT | PASS |
| After advisory fence | Adapter exception after `pg_advisory_xact_lock` | PASS |
| Before DDL | Adapter exception immediately before `ALTER TABLE` | PASS |
| After DDL before journal | Adapter exception after real `ALTER TABLE` | PASS |
| Registry UPDATE rejected | Actual revoked PostgreSQL column UPDATE privilege | PASS |
| Journal INSERT rejected | Original PR #198 real SQL privilege negative test (A–D) | PASS at original SHA only |
| Journal inserted, before COMMIT | Adapter exception after actual INSERT | PASS |
| ROLLBACK path failure | Real client socket destroyed during attempted rollback | PASS |
| Backend killed | `pg_terminate_backend` after physical DDL | PASS |
| TCP interrupted before COMMIT | Socket destroy, fresh independent observer | PASS |
| COMMIT caller acknowledgment suppressed | COMMIT returns from PG, test destroys real TCP connection before operator return | PASS |
| Real COMMIT wire packet dropped | Loopback proxy discards server CommandComplete; true TCP disconnect | **PENDING latest CI evidence** |
| SIGKILL process after DDL | Parent sends SIGKILL to separate operator Node process | PASS |
| Retry after uncertain COMMIT | Independent observer verifies journal, registry, catalog and checksum; then ALREADY_APPLIED | PASS |
| Conflicting journal | Deliberately forge digest in disposable database, require JOURNAL_CONFLICT | PASS |
| Different approved plans | Two operator sessions/approvals, exactly one physical ADD COLUMN and one journal | PASS |
| Noncooperating external DDL after fence | Independent admin runs ALTER while operator is fenced | **FAIL — confirmed race** |
| External ACCESS EXCLUSIVE table lock | Independent session blocks operator; bounded timeout then safe retry | PASS |
| Termination during actual DDL lock wait | Wait for `pg_stat_activity.wait_event_type='Lock'`, then backend terminate | **PENDING latest CI evidence** |
| Full catalog reconciliation | Fresh repeatable-read read-only snapshot, manifest text/digests/catalog/checksum | PASS for old/new/conflicting states at previous run |

**Consequence:** do not claim AG06-S03-03 fixed, do not consider the full suite passed, and do not automatically retry DDL after connection loss. Existing authorization and database security controls remain in force.

## Recovery state machine

| Independently observed durable state | Decision | Safe action |
| --- | --- | --- |
| Old full manifest, old catalog, no journal, original seed checksum | `ROLLED_BACK` | Fresh authenticated approval + authority + drift verification required before retry |
| New full manifest, target catalog, one matching completed journal, original rows/checksum | `COMMITTED` | Only `ALREADY_APPLIED`, never run physical DDL again |
| Mixed registry/catalog or invalid/incomplete/contradictory journal; tampered digest; missing rows; unknown database | `HALT_UNRECONCILABLE` | `DENIED`; independent DBA/Agent 06 review, no retry |
| Connection unavailable or observer cannot finish read-only snapshot | `HALT_UNRECONCILABLE` | Preserve evidence, no re-execution |

The state machine is test-only; integration into the operator's production recovery workflow needs Agent 02/05 design review. No evidence here claims zero data loss in all failure modes.

## Required follow-up and owners

1. **Agent 02 — P2 BLOCKING, before release:** explicit relation lock before all live catalog reads, noncooperating DDL adversarial proof, lock ordering/timeouts, row-preservation and concurrent different-plan re-run; provide written verdict and tested code SHA.
2. **Agent 05 — P1/P2 blocking, before release:** trusted approval identity/provenance and revocation races must be solved independently, no forged text identities accepted.
3. **Agent 03 — before release:** TypeScript/test-source + dependency and Node24 advisory review, no test-only fault hooks in exported runtime.
4. **Agent 04 — before release:** demonstrate final exact-SHA CI, commit packet-loss test, backend/process termination and cleanup; reconcile all failures and artifact SHA.
5. **Agent 06 — before release:** independent exact-source reproduction and approval. Neither Agent 04 nor test author approves own work.

**Operational rollback:** No production rollout occurred. For disposable labs, close/terminate only owned test connections; drop test DB/roles, verify none remain. For any future production migration, don't auto down-migrate or replay unknown COMMIT. Halt and inspect live catalog+registry+journal under independent approval with verified database backup/PITR and rehearsed recovery.

## Sources researched (2026-11-17)

- Node.js 24.22.3 official security announcement, 2026-11-11: https://nodejs.org/en/blog/release/v24.22.3
- Node.js November 2026 vulnerability details, 2026-11-11: https://nodejs.org/en/blog/vulnerability/november-2026-security-releases/
- Docker Official Images (Node 24.22.3 Alpine index digest): https://hub.docker.com/layers/library/node/24.22.3-alpine/images/sha256-d8d97e479cdc64f052f81f129362168717c59783ade8dcc1abd22e1cca8dbd7c
- PostgreSQL 16 advisory/table locks: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 protocol termination: https://www.postgresql.org/docs/16/protocol-flow.html
- PostgreSQL 16 COMMIT: https://www.postgresql.org/docs/16/sql-commit.html
- PostgreSQL 16 server administrative functions: https://www.postgresql.org/docs/16/functions-admin.html
