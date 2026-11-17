# M03-S03 — Whole-Operation Deadline Benchmark

**Date:** 2026-11-17 (Asia/Riyadh)  
**Authority:** Agent 04 technical evidence only; Policy A/B, global deadline and operational SLO **NOT APPROVED**  
**Release:** NO-GO · AG06-S03-08 OPEN · Merge NOT AUTHORIZED

**Original canonical PR #198:** b5cfc0687076c86a7450a8a785a072f6e63ad289  
**Unapproved Policy A source PR #203:** 6bf94cc45babd7c73593295900d791a2f03f7a72; confirmed 5 commits descendant of original canonical SHA  
**Independent benchmark Draft PR #204:** https://github.com/AbdullahZaher/vibress/pull/204  
**Current benchmark code and checkout SHA:** see current PR #204 head and CI artifact provenance; **do not conflate HEAD with GitHub synthetic PR merge SHA**.

## 1. Prior evidence and limitations

The previous 350/350 successful specialist PostgreSQL verification represents **repeated correctness tests, not independent latency measurements**. Previously observed ~1.1s expiry fixture, ~2s lock-timeout negative, 21-test fault suite wall time and 4s client connection guard cannot be used as whole-request p99.

The actual restricted operator uses READ COMMITTED, 2s per-lock lock_timeout, 10s per-statement statement_timeout, and 15s idle-in-transaction timeout. These are not additive or universal end-to-end bounds. The currently proposed Policy A final read occurs after target ACCESS EXCLUSIVE and before DDL. **No approved global timeout, cancellation contract or human IAM/DBA signatures exists.**

## 2. Disposable environment and measured workload

Runner: ubuntu-24.04 in GitHub Actions; localhost Docker PostgreSQL 16, explicit disposable DSN at 127.0.0.1:5433/vibress; Node v24.22.3. **Actual PostgreSQL patch number and Node version MUST be observed in CI**. Existing compose.dev.yml PostgreSQL 16-alpine tag is not digest-pinned; Docker resolved immutable image ID should be captured on future topology validation.

Actual migrations **0059 + 0060** create a real operator journal, trusted identity roster, independent non-superuser author/approver/operator/runtime login, bound application and installation. The authorized plan is a real optional ADD_FIELD website text without default on an existing application-owned table, with two seeded rows and checksums. The large table profile adds 10,000 synthetic rows (10,002 total).

The test creates **one independent disposable installation database**, not a multi-tenant production deployment. Each normal attempt uses a **fresh authenticated operator connection**, executes the **real production operator code** through COMMIT acknowledgment and connection disposal, and only then resets its physical column/registry/journal from the isolated superuser **outside the measured interval**. Repeated catalog DDL on the same warm relation is a **hot-cache synthetic benchmark**, not 1,000 independent installations. No production records, secrets, roles or infrastructure touched.

**Monotonic clock:** process.hrtime.bigint starts before connection acquisition. Every SQL query is instrumented in a test-only PG client proxy (no runtime code modification). Data includes full elapsed request, connection, transaction BEGIN, installation and approval advisory fences, registry FOR UPDATE, target ACCESS EXCLUSIVE, approval checks including final pre-DDL, privilege/catalog scans, row counts, real ALTER TABLE, registry CAS, journal insert, COMMIT ACK, rollback if applicable, and client connection disposal. Measurements are **client-observed await duration**, not exclusive server CPU/trace timing.

**Required attempt counts:** 1,000 uncontended true migrations, 100 independent external table-lock contention attempts, 12 cumulative test-only 4ms per-SQL client scheduling delay attempts, 12 large-table attempts and 3 warmups (warmups excluded from normal distribution). Contention holds **120ms, 900ms or 2200ms** after the operator's actual LOCK TABLE statement barrier. 2200ms exceeds the existing 2000ms lock cap and is expected to fail safely. This is an explicit injected workload, **not** evidence of realistic production contention distribution. 4ms client delay is software scheduling injection, **not physical DNS, TLS or network packet latency**.

**No executed production-shaped tests** for external DNS/TLS, regional RTT, high QPS, heterogeneous table sizes/indexes/constraints, full slow catalog under representative schema, concurrent competing operator/advisory locks, actual revoked approval during benchmark, backpressure, real network COMMIT delay or budget cancellation. Independent prior SIGKILL/TCP/lost-COMMIT correctness suite is **not** whole-operation timing proof.

## 3. How to reproduce in an exclusively disposable environment

Requires Node v24.22.3, pnpm 11.22.0, disposable GitHub Actions worker or isolated Docker project. Workflow: .github/workflows/m03-s03-whole-operation-benchmark.yml.

Use a *disposable runner only*: pnpm install --frozen-lockfile; pnpm --filter @vibress/plugin-sdk build; docker compose -f compose.dev.yml up -d --wait postgres. Then execute with DATABASE_URL=postgresql://vibress:vibress@127.0.0.1:5433/vibress and M03_S03_NORMAL_ATTEMPTS=1000, M03_S03_CONTENTION_ATTEMPTS=100:

pnpm exec vitest run --no-file-parallelism tests/integration/m03-s03-whole-operation-benchmark.test.ts --testTimeout=900000 --hookTimeout=120000

After verified fixture cleanup, tear down only the **owned disposable Compose project** using docker compose -f compose.dev.yml down --volumes --remove-orphans. **Do not run volume teardown on shared/production infrastructure.**

## 4. Raw machine-readable benchmark evidence

GitHub Actions artifact **m03-s03-whole-operation-benchmark** (30-day retention) contains:

- **provenance.json**: exact checked-out SHA, PR HEAD SHA, Node version; distinguish PR merge source.
- **raw-attempts.jsonl**: abstract case ID, workload profile, outcome, monotonic elapsed and connection duration, per-stage duration/count and allowlisted SQLSTATE, no raw SQL, actor credentials or customer data.
- **summary.json**: p50/p95/p99/max, separate successful-operation and all-attempt distributions, counts of outcomes/SQLSTATE, per-SQL-stage distributions, explicit source and topology warning.

CI must reject incomplete normal/contended sample matrices; it must never mark a run PASS if the test, checksum, row integrity or fixture cleanup fails. No percentile is accepted from a run whose required case count has not been completed.

**Executed results:** PENDING exact CI evidence. Do not copy values from earlier correctness fixtures. This report is to be amended with raw artifact ID, measured numbers, sample counts and any anomalies after evidence retrieval.

## 5. Deadline sizing and enforceability

**Owner-approved SLO:** MISSING. **Final candidate duration:** NOT DETERMINABLE for production. **Policy A:** recommended but NOT APPROVED. **AG06-S03-08:** OPEN.

Measured local p99 (even at 1,000 trials) cannot prove a production p99. Before proposing finite candidate values, require topology variance, actual network latency (DNS, TLS, connection pool and proxy), expected lock contention and cancellation/rollback/COMMIT ACK reserve, acceptable false-timeout frequency, owner SLO and workload class. Any eventual two numeric alternatives must state all assumptions, predicted exceedance risk *on measured profiles only*, timeout/abort semantics and monitoring, and be separately signed by owner, IAM and DBA.

A client-side monotonic budget can classify a response and prevent **new** operations before COMMIT, but PostgreSQL 16 per-statement and idle timeouts do **not** guarantee that physical transaction completion, TCP response delivery or server cleanup meets the same deadline. COMMIT dispatched with lost/late ACK must be **INDETERMINATE** pending new-session journal+catalog+registry reconciliation; never blindly replay DDL or claim rollback without proof. Earlier real COMMIT wire-loss correctness tests do not measure budget compliance.

## 6. Independent validation and residual risk

Agent 02: confirm PostgreSQL instrumentation, actual dataset/topology, query/lock behavior, safe server timeout caps and cancellation semantics. Agent 05: expiry/revocation linearization under any future watchdog. Agent 03: ensure test-only instrumentation cannot be invoked by runtime, no SQL/secrets in CI artifacts. Agent 06: rerun on frozen exact SHA, review percentiles and unsigned release claims. Agent 01: owner SLO and final policy/number/signature only after sufficient evidence.

**Decision (2026-11-17): Benchmark PENDING; Representative Environment LIMITED; Normal/Contention/COMMIT latency INCOMPLETE; Deadline NOT DETERMINABLE; Policy/deadline approval PENDING; Merge NOT AUTHORIZED; Production NO-GO.**

## Primary source review, 2026-11-17

- PostgreSQL 16 lock_timeout, statement_timeout, idle-in-transaction timeouts: https://www.postgresql.org/docs/16/runtime-config-client.html
- PostgreSQL 16 advisory/table locking: https://www.postgresql.org/docs/16/explicit-locking.html
- PostgreSQL 16 pg_stat_activity lock wait events: https://www.postgresql.org/docs/16/monitoring-stats.html
- PostgreSQL 16 wire protocol/COMMIT: https://www.postgresql.org/docs/16/protocol-flow.html
- Node v24 monotonic timer: https://nodejs.org/download/release/v24.11.0/docs/api/process.html
- Node v24.22.3 release (2026-11-11): https://nodejs.org/en/blog/release/v24.22.3
