# M03-S03 P05/R1 — Trusted Actor Linearization Experimental Certification

**Date:** 2026-11-18 Asia/Riyadh · **Verdict: REQUEST CHANGES / NOT CERTIFIED.**  
**Owner:** P05/R1 approved policy only for AUTHOR+APPROVER ([decision #6968063436](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6968063436)). P02 Policy A and P04 D1 2517ms remain restricted to disposable PostgreSQL 16 dev/test.  
**Canonical PR #198:** b5cfc0687076c86a7450a8a785a072f6e63ad289, unchanged. **Original Policy A #203:** 1fb5e1600fd2300d7509ec998ff3b1fa1fff5078. **Original real PG bug source #206:** fb6e12203c3ca8e589419467369bf908e645c7cb.

## 1. Source-pinned engineering finding

The original operator checks actor active state before acquiring the target ACCESS EXCLUSIVE lock. Final Policy A query checks only approval expiry/revocation, so privileged actor deactivation COMMIT during the target wait is missed. Real PG16 IAM-RACE-01A/B previously proved APPLIED after the committed deactivate event. Under owner P05/R1 this is an OPEN authorization contract violation.

**First experimental source (REJECTED):** code/test checkpoint 2e4a75cc4c45672ceb1cf5c42c077f147d11ad28 proposed actor SELECT FOR SHARE after target lock. [CI #44234590759](https://github.com/AbdullahZaher/vibress/actions/runs/44234590759) failed: 7 focused tests passed, 4 failed plus two unhandled rejections; original 55P03 classification still open. Crucial root cause: PostgreSQL 16 SELECT FOR SHARE requires UPDATE privilege on an actor roster column, which dedicated operator DOES NOT have and MUST NOT receive. **This row-lock proposal is rejected in this experiment; no grants were issued.** [PG16 privileges](https://www.postgresql.org/docs/16/ddl-priv.html).

**Revised experiment:** operator code commit 871089fe032c45dbcdc40259a7ad244edc6be866 (blob 292b6275769aec77b408e13c9432643007b627c4); real-PG fixture/tests commit e636a54e5100359ee772bdebb47ffc9bd0a16515 (test blob 8dc3b1601e75f98e1783b3611f81c1c977809bf2). Current test code installs a **nonprivileged SECURITY INVOKER** disposable-only actor mutation trigger AFTER unchanged migration 0060. Its UPDATE/INSERT/DELETE paths acquire actor-specific transaction advisory keys; the operator acquires the exact same per-login keys in sorted order, then reads/revalidates both active identities, then final Policy A server clock timestamp, immediately before DDL.

## 2. Correctness argument (conditional on a complete trusted writer protocol)

- An actor deactivation that COMMITs before operator obtains its actor-specific advisory lock is visible in the following READ COMMITTED actor read and must deny.
- If a writer holds that advisory lock with an uncommitted actor UPDATE, operator waits; on writer COMMIT/ROLLBACK, operator obtains lock, reads current authoritative actor state and denies/allows accordingly.
- If operator holds actor advisory locks before writer can COMMIT, the mutation trigger must wait; such a deactivation COMMIT occurs after final authorization, so R1 specifies nonretroactivity.
- Both AUTHOR and APPROVER actor keys are acquired in deterministic login order before the fresh final Policy A check. Final DDL has no additional unrelated blocking stage between decision and execution.
- Hashtext key collisions can over-serialize but do not silently omit the shared lock; direct privileged DML that bypasses the actor trigger is NOT protected. Owner/superuser can disable/bypass triggers and remains a trusted, audited root.
- A test-only trigger is NOT a deployable migration. Adopting it requires human IAM and DBA review, lock-order tests, an approved additive migration, tested backfill/rollback, and owner approval of unresolved actor epoch policy.

## 3. Evidence matrix

| Requirement | Observed status |
|---|---|
| Old real PG16 IAM-RACE-01 reproduction | VERIFIED on old source, security evidence [#6960695638](https://github.com/AbdullahZaher/vibress/issues/197#issuecomment-6960695638) |
| Rejected first row-lock experiment | FAILED CI #44234590759; no new operator UPDATE privileges |
| Revised actor advisory + disposable writer trigger | IMPLEMENTED IN ISOLATED EXPERIMENT, real PG16 rerun MUST be verified on final SHA |
| AUTHOR/APPROVER table-wait committed deactivation | R1-01/R1-02 tests inverted to deny, rerun PENDING |
| Post-final queued and uncommitted pre-final actor updates | New R1-06/R1-09 real PostgreSQL wait-event tests, rerun PENDING |
| Deactivate→reactivate old approval replay | Known uncovered threat; epoch/reapproval UNAPPROVED |
| Mixed actor+approval revocation admin deadlock | Credible wait-cycle; not yet proven safe/closed |
| D1 supervisor / margin M / SQLSTATE / watchdog | NOT INTEGRATED / NOT DETERMINABLE / OPEN / OPEN |

## 4. Technical reviewer dispositions

**Agent05 IAM lens: REQUEST CHANGES.** Cooperative writer fence can close direct table-wait race, but full lifecycle needs immutable actor instance/generation and explicit reapproval decision.  
**Agent02 DBA lens: REQUEST CHANGES.** Advisory lock correctness depends on all trusted writer paths; existing owner/direct DML is not modified by normative migrations. Mixed actor+approval admin transactions can deadlock; negative tests/recovery needed.  
**Agent03 AppSec lens: REQUEST CHANGES.** New privilege grant is prohibited; initial row-lock candidate was rejected, revised test-only solution still lacks epoch replay protection and hardening against admin bypass.

These are coordinated technical analyses, not independent human or separately authenticated agent signatures. **Human IAM and DBA PENDING. Agent06 final PENDING.**

## 5. Risk, rollback and next authorized action

No change to migrations 0059/0060, table privileges, production or canonical #198. Trigger only in fresh disposable PostgreSQL fixture and is discarded with fixture database. Rollback experiment via revert Draft PR #208; unknown COMMIT still requires fenced reconciliation, never blind retry. D1 2517ms has not been integrated and added advisory waits must be covered by a future owner-approved supervisor.

**Next:** source-pinned revised PG16 CI; fix observed defects; independently review writer trigger and global lock ordering; obtain human IAM/DBA and owner epoch/reapproval decisions before normative code/migration.

**Primary sources checked 2026-11-18:** [PG16 privileges](https://www.postgresql.org/docs/16/ddl-priv.html), [advisory locks](https://www.postgresql.org/docs/16/functions-admin.html), [READ COMMITTED](https://www.postgresql.org/docs/16/transaction-iso.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [PG16.16 release](https://www.postgresql.org/docs/release/16.16/).


## 2026-11-18 — FINAL EXECUTABLE-SOURCE TEST EVIDENCE ADDENDUM (supersedes earlier PENDING CI notices)

**Exact tested executable commit:** `e340e92154dde6d98cad441cddc87793dde4d756` (root tree `3a0514cd5a44b3a2bee70306df7a1265f1044161`); **operator blob** `292b6275769aec77b408e13c9432643007b627c4`; **test blob** `6098d225817bba9280ffb383823cd3038e70e75a`. [GitHub Actions CI #44236955524](https://github.com/AbdullahZaher/vibress/actions/runs/44236955524) **SUCCESS**; platform-roadmap documentation workflow [#44236955480](https://github.com/AbdullahZaher/vibress/actions/runs/44236955480) **SUCCESS**. Real **Node 24.22.3 / PostgreSQL 16.16** (`server_version_num=160016`); frozen pnpm install, TypeScript typecheck, ESLint and explicit-any checks succeeded. This addendum is **documentation-only**; each new documentation head needs its own CI when required by release policy.

| Real PostgreSQL test execution group | Exact run result |
|---|---|
| Focused actor/race/watchdog/P05/R1 including R1-10 | **12 passed, 47 skipped by filter (59 total definitions)** |
| Full authenticated operator, approval and R1 tests | **59/59 passed** |
| Original fault-injection/COMMIT/rollback suite | **21/21 passed** |
| Disposable test database leaks | **0** |
| Owned test PostgreSQL cleanup | **SUCCESS** |

**Counting:** 92 passing *executions* across 3 sequential groups. The 12 focused definitions are repeated in the 59 full-suite tests; there are **80 distinct test definitions** (59+21), not 92. No failing or skipped tests in the two full suites. Test-only CI rerun on `e340e...` verified previously failing fixture dollar quoting and the no-new-grant advisory fence.

**R1-10 confirmed dangerous global lock inversion:** real PostgreSQL positive assertion to *observe* a `40P01` deadlock between actor-first privileged admin and approval-key-first operator transactions (test ran both in the focused cohort and full suite). The test asserts transaction rollback integrity and no unauthorized physical DDL, manifest mutation or completed journal. **A passing negative test does NOT close the deadlock risk**. It confirms a required admin protocol redesign before implementation admission.

**Narrow lab result:** the revised actor advisory + disposable-only mutation trigger passes tested R1-01/R1-02 race-denial and approved pre/post-final ordering scenarios. **Not a full policy implementation:** normative actor writer trigger is absent from 0059/0060, adversarial privileged bypass paths remain, actor deactivate→reactivate still allows older approval reuse pending E2, D1 supervisor still unintegrated, numerical M unknown, SQLSTATE classification and watchdog open. No production or canonical code changed. **Agent05, Agent02, Agent03 technical dispositions remain REQUEST CHANGES; human IAM/DBA PENDING.**


**Independent certification conclusion:** experimental correctness demonstrated for selected real PG16 races only, not a complete independent Agent06 or human IAM/DBA certification. P05/R1 final authorization implementation gate stays BLOCKED.