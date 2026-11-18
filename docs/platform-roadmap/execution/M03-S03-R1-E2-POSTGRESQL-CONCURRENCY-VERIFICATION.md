# M03-S03 — R1/E2 PostgreSQL 16 Concurrency Verification & Source Provenance

**Date:** 2026-11-18 Asia/Riyadh · **Status: EXACT-SHA TEST CERTIFICATION PENDING / REQUEST CHANGES.**  
**Do not inherit success from older source.** **Canonical PR #198:** `b5cfc0687076c86a7450a8a785a072f6e63ad289`, unchanged and Draft. **Prior tested executable #208:** `e340e92154dde6d98cad441cddc87793dde4d756`, tree `3a0514cd5a44b3a2bee70306df7a1265f1044161`, [CI #44236955524](https://github.com/AbdullahZaher/vibress/actions/runs/44236955524) SUCCESS on PostgreSQL 16.16. The older run reproduced the original `40P01`; it did not test the proposed E2 corrections. **New isolated experiment:** [Draft #209](https://github.com/AbdullahZaher/vibress/pull/209), based on Draft #208 docs SHA `130bd9633c07a10368286dd9c0c8ecc8f11421b5`. The new executable source for an E2 fixture and corrected L1 admin test is **after** `e340e921`, and MUST get its own exact-SHA CI.

## 1. Original real-PG diagnostic evidence (verified and not promoted to remediation PASS)

Prior executable `e340e92154dde6d98cad441cddc87793dde4d756`, [workflow #44236955524](https://github.com/AbdullahZaher/vibress/actions/runs/44236955524):
- Node 24.22.3, PostgreSQL `server_version_num=160016` (16.16).
- Focused actor/adversarial tests **12 passed**, 47 skipped only under focus filter. Original operator whole suite **59 passed**; fault injection whole suite **21 passed**. These are **92 passing test executions / 80 unique full-suite definitions**, because 12 focused are repeated within 59. Disposable fixture leak count 0, teardown PASS.
- **R1-10** passes as a safety-negative test only by reproducing a real `SQLSTATE 40P01` wait cycle. It demonstrates a KNOWN LOCK-ORDER DEFECT, not a corrected path.
- Original actor-race direct table wait is denied under disposable-only writer-cooperative advisory trigger and operator final actor revalidation. No universal privileged admin enforcement or E2 provenance existed then.

## 2. New exact-source experimental changes to verify

| Code artifact | Experimental behavior | Verification |
|---|---|---|
| `tests/fixtures/m03-s03-e2-actor-generation-experimental.sql` | after 0059/0060: UUID actor instance, generation, plan+approval bindings, lifecycle and provenance triggers (SECURITY INVOKER) | Clean PG16 fixture replay, SQLSTATE and ACL catalog |
| `packages/database/src/platform-schema-migration-operator.ts` | compare original AUTHOR and independent APPROVER actor instance+generation both initially and under final actor lock | E2 stale replay denial, no physical DDL/manifest/journal |
| `tests/integration/platform-schema-migration-operator.test.ts` | retain old R1-10 diagnostic, add `R1-10-FIX` governed approval-first admin ordering, E2-01/02/03/04 negative tests, invert old deactivate/reactivate expectation | Independent PostgreSQL sessions and actual transaction wait observations |
| `.github/workflows/m03-s03-agent05-ag03-race-security.yml` | bind new experiment branch, run focused and full operator/fault suites, pinned Node/pnpm and disposable PG16, leak/teardown | GitHub Actions run at exact new SHA |

## 3. Test matrix and required physical assertions

| ID | Expected outcome | Evidence condition |
|---|---|---|
| Old R1-10 | Detect 40P01, roll back both, no unauthorized DDL/registry/journal change | Keep diagnostic regression active, do not mark defect fixed |
| R1-10-FIX | Admin waits on approval A **before touching actor X/tuple**; operator holding A can acquire X and COMMIT; admin later commits deactivation+revocation without a known cycle | Verify wait via independent pg_stat_activity, physical states and timestamps; successful test cannot establish universal absence |
| R1-01/R1-02 | Committed author or approver deactivation during target wait must DENY | Absent column, unchanged manifest, journal empty, seeded checksum preserved |
| R1-06/R1-09 | Post-final deactivation cannot COMMIT first; uncommitted pre-final actor mutation forces operator wait and latest committed decision | Real backend wait event barrier, no blind retry |
| E2-01 | APPROVER deactivate/reactivate increments generation twice; old approval DENY | Old instance same, new generation different, no column/journal |
| E2-02 | AUTHOR deactivate/reactivate invalidates old plan; generation tamper denied | 42501 for direct generation rewrite, no DDL |
| E2-03 | DELETE/re-register same LOGIN/principal yields new UUID | Old approval DENY |
| E2-04 | NULL legacy generation never upgraded silently | Old approval DENY |
| AUTH and Policy A previous | authenticated provenance, role separation and expiry continue to work | Full operator suite PASS, not just focused filter |
| Fault injection | lock timeout/deadlock/COMMIT/rollback tests remain safe | Full fault suite PASS, no claim of D1 supervisor |
| Least privilege | operator/runtime cannot UPDATE roster nor issue privileged lifecycle mutation | grant diff and unauthorized SQL tests |
| D1 | added actor keys/epochs inside a 2517ms cumulative monotonic timer | **NOT INTEGRATED — DO NOT CERTIFY** |
| Recovery | COMMIT-ACK unknown must be INDETERMINATE and fenced | Not made production-safe by these tests |

## 4. How to retain machine-readable evidence

On actual CI runs record: branch, full commit SHA, root tree SHA, operator/test/fixture blob hashes, Docker PostgreSQL server_version_num, Node version, package lockfile hash, workflow and job IDs, full test names, pass/fail counts, skip reasons, test-run repetitions, SQLSTATE, pid/backend_start for race barriers, pg_stat_activity wait events, catalog/manifest/journal checksum assertions, zero fixture leak count, cleanup result. Do not print or store database passwords or private DSNs; GitHub masking is not a substitute for data minimization.

**Repeated executions:** do not infer independent repetitions from running a focused subset and the same tests again within the whole suite. If no fresh repeated independent runner evidence exists, label repetitions NOT RUN. One successful deterministic wait trace is not an SLO or a universal latency bound.

## 5. Stage status and remaining risks

- Expected outcome of **new** experiment is NOT yet certified until exact-SHA workflow completes. If CI fails, publish exact step and findings; do not mark PASS.
- Even a complete green experimental CI leaves: unapproved E2-A policy, unreviewed normative migration/admin gateway, privileged direct-DML bypasses, D1 whole-operation and positive COMMIT admission M, 55P03 misclassification, watchdog identity-safe cancellation, and human IAM/DBA signatures.
- Agent02 and Agent05 technical reviewers cannot substitute for independently accountable human authorities; Agent03 adversarial review and Agent06 independent review must be retained as separate gates.
- No canonical #198 integration, merge or production.

**Rollback:** discard experimental branch/fixture only; no changes to 0059/0060. If an actual COMMIT result is ambiguous, quarantine and reconcile authoritative catalog, registry and journal with fresh trusted access. Never interpret an RPC timeout as definitive rollback.

**Research checked 2026-11-18:** [PG16 locks](https://www.postgresql.org/docs/16/explicit-locking.html), [PG16 pg_locks](https://www.postgresql.org/docs/16/view-pg-locks.html), [PG16 transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [PG16 errors](https://www.postgresql.org/docs/16/errcodes-appendix.html), [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
## Verified final experimental executable-SHA CI addendum — 2026-11-18

**This supersedes earlier PENDING / incomplete test notes in this report, but does not supersede the owner or human approval gates.** Tested executable commit: `3a8dce2fa296fd6a3b51c14bdd193d757cc4aa5c`, Git tree `30fd302094db904ed537f1809c6b69e607312d00`. [GitHub Actions run #44242532694](https://github.com/AbdullahZaher/vibress/actions/runs/44242532694): **COMPLETED SUCCESS**, all required workflow steps including clean teardown SUCCESS. Node v24.22.3, PostgreSQL 16.16 (`server_version_num=160016`). Verified pinned dependencies, TypeScript typecheck, ESLint and explicit-any checks PASS.

| Suite / runner execution | Observed |
|---|---|
| Focused `IAM-RACE-01|IAM-WD-01|P05/R1|R1-0|R1-10|E2-` | 20 PASS, 47 filter-skipped |
| Full operator suite (includes R1-10 original and R1-10-FIX/FIX2 plus E2 cases) | 67/67 PASS |
| Full fault-injection suite using same disposable actor/E2 fixtures | 21/21 PASS |
| Repeated independent Vitest processes with R1-10 and E2 tests | 3 separate process runs, each 10 PASS (57 filter-skipped) |
| Disposable PG16 fixture DB leak count | 0 |
| Owned Docker service/volumes teardown | PASS |

**Counting:** 138 successful test *executions* across these groups; the full suites contain **88 distinct test definitions** (67 operator + 21 fault). The 20 focused and 30 repeated executions overlap with full operator suite, therefore NOT 138 distinct cases. All three repetitions used fresh Vitest processes on one GitHub-hosted runner, not three independent runner machines. No statistical D1 guarantee follows. The run includes sanitized `R1_10_BACKEND_TRACE` of actual backend PID, backend_start, pg_blocking_pids, wait_event and `pg_locks` class/object identity. In the first run, backend 172 waited for advisory lock held by backend 170; it proves a real PG wait; the diagnostic R1-10 also induced PostgreSQL `40P01`. Corrected governed L1 cases passed on the supported fixture protocol; this does NOT imply universal deadlock absence.

**Gate disposition:** the corrected experimental R1-10 test scenario and E2 anti-replay regressions are VERIFIED for the exact executable snapshot only. **Global lock-order implementation is NOT accepted**: legacy privileged direct DML and human DBA/IAM authority remain unreviewed, fixture gateway not normative. **E2-A** fresh plan+independent approval remains a recommendation ONLY; owner has NOT selected E2-A/B/C. Human IAM PENDING; human PostgreSQL DBA PENDING; Agent06 exact integrated candidate review PENDING. Agent04 standalone timing certification PENDING. D1 2517ms cumulative supervisor and pre-COMMIT M NOT IMPLEMENTED / NOT DETERMINABLE; IAM-WD-01 and AG06-S03-10 OPEN; canonical PR #198 untouched and Draft. No risk accepted.

**Containment and rollback:** all schema alterations and `SECURITY INVOKER` gateway remain in owned disposable PG16 fixture SQL, with **zero new GRANT statements**, no changes to migrations 0059/0060, no runtime/operator privilege expansion. Reverse experimental branch changes or discard disposable fixtures. If a future COMMIT is uncertain, isolate/fence and reconcile via fresh trusted catalog/registry/journal; never infer rollback or blindly retry DDL.

**Research provenance checked 2026-11-18:** [PostgreSQL 16 explicit locks](https://www.postgresql.org/docs/16/explicit-locking.html), [PG16 transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [PG16 trigger definition](https://www.postgresql.org/docs/16/trigger-definition.html), [PG16 error codes](https://www.postgresql.org/docs/16/errcodes-appendix.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

**Exact next permitted step:** independent human IAM and DBA review with E2/reapproval owner policy decision and globally governed mutation lock ordering; require source-pinned new test+review for any modification, then independent Agent06 before any new canonical integration authorization. **REQUEST CHANGES; MERGE BLOCKED; PRODUCTION NO-GO.**
