# Phase 0 — Branch, Pull Request and Evidence Consolidation Inventory

**Date:** 2026-11-21
**Author:** Agent 01 (Engineering Director / Integration Lead)
**Execution branch:** `docs/universal-platform-full-execution-checklist-20261121`
**Checkpoint before consolidation:** `5644492cb3c1f2a4ee3a4c0247a7abd84f088054`
**Verified `main` baseline:** `251bef39325476bcbbe84d80ed451851a079695a`
**Method:** `git fetch --all --prune`, `git merge-base --is-ancestor`, content-presence checks (`git cat-file -e main:<path>`), GitHub PR metadata (`gh pr view --json`). Squash merges mean ancestry alone is **not** proof of inclusion, so every merged PR was verified by file content in `main`.

> This inventory records facts. It does **not** grant merge, release, DBA, IAM or production authority. Production remains **NO-GO**; Risk Acceptance remains **NONE**.

## 1. Repository state

| Item | Verified value |
| --- | --- |
| Remote branches | 169 |
| Ancestor-merged into `main` | 98 |
| Not ancestor-merged (includes squash-merged and stale branches) | 71 |
| Execution branch head at inventory start | `5644492c` (docs-only, child of `main@251bef39`) |
| M03 certified implementation | `a49d0379`, tree `419ebd78ebd2294dd7c2482d5fed6f78ec462b5e` |
| M03 docs-only head | `cf99126a`, tree `70599eb47e7f29d2e6fd36c5c708db27d06c54ec`, parent `a49d0379` |
| Local uncommitted changes | none (`git status --porcelain` empty before work began) |
| Pre-existing worktrees | `vibress-m03-exec`, `vibress-ticket4`, `vibress-ticket4-clean`, two prunable `/private/tmp` checkouts |

## 2. Already-merged historical foundation (content-verified)

All five PRs below are included in `main@251bef39`. Their branches must **not** be re-merged or cherry-picked.

| PR | Merge commit | HEAD SHA | Files | Included in `main` | Verdict | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| #151 master roadmap | `73cb0a6b` | `c9997a93` | 47 | Yes (100%) | MERGED | `ALREADY_MERGED` |
| #166 Wave 1 kernel/tenancy | `272fd300` | `c2f2e30a` | 100 | Yes (100%) | MERGED; not Wave 1 GO | `ALREADY_MERGED` |
| #174 W1-T06 isolation harness | `6f166bfa` | `e5a43dc1` | 21 | Yes (100%, verified by path) | MERGED; fixture-only evidence | `ALREADY_MERGED` |
| #176 Wave 1 integrated remediation | `3df799b3` | `3df799b3` | 37 | Yes (100%) | MERGED; not Wave 1 GO | `ALREADY_MERGED` |
| #193 M03-S02 schema planning | `251bef39` | `cae6e1f5` | 8 | Yes (100%) | MERGED; restricted | `ALREADY_MERGED` |

**Ancestry caveat recorded:** `#174`'s merge commit `6f166bfa` is *not* an ancestor of `main`, yet all 21 changed paths are present in `main`. The PR was merged into its feature base and arrived through the integrated branch. A naive ancestry check would wrongly classify it as unmerged. Content verification is mandatory.

## 3. Open engineering candidates

| Branch / PR | HEAD SHA | Git tree | Base ancestry | Implemented scope | In `main` | Independent verdict | Security restrictions | Conflicts | Integration decision | Owner approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **#213** `experiment/m03-remaining-functional-exec-20261119` | `cf99126a5e5ac8a8fbfada75424047196ddd6062` | `70599eb4` (docs head); impl tree `419ebd78` | `main@251bef39` | M03-S03 functional execution, migrations 0059/0060/0061, operator CLI, PITR/restore workflows, 161 files | **No** (76 of 100 PR paths absent from `main`) | `M03_CONDITIONALLY_ACCEPTABLE` (issue #197) | D-01 READY V2 deferred; D-02 PITR evidence incomplete; D-03 0061 needs human DBA/IAM; no M04 runtime | Mergeable, but governance-blocked | **`BLOCKED_BY_GOVERNANCE`** — do not merge into `main` or treat as M03 closure | **PENDING** (no merge authorization in repository) |
| **#212** `feat/wave2-m04-s01-pure-crud-contracts-20261118` | `7e6cfdb72a19e4232cb944dde326143da3945b86` | `fc740fb4` | `main@251bef39` | Pure CRUD/OpenAPI/typed-client/Admin contracts + mock consumer, 20 files | No (15 of 20 paths absent) | Owner-accepted **restricted contract** | Not a generated API/Admin runtime; M04 Batch 03 runtime `NOT AUTHORIZED` | Mergeable | **`BLOCKED_BY_GOVERNANCE`** — draft, restricted, runtime unauthorized | Owner accepted restricted contract; canonical merge **PENDING** |
| **#198** `feature/wave2-m03-s03-secure-migration-executor` | `b5cfc06870` | `48087886` | `main@251bef39` | Operator-gated schema execution, trusted plan registry, 39 files | No | WIP/NO-GO | Privileged DDL boundary | 26 files identical in #213, 13 evolved | **`SUPERSEDED_BY_NEWER_IMPLEMENTATION`** (#213) | PENDING |
| **#200** `fix/m03-s03-agent04-pg-fault-recovery-20261117` | `504beb4d0e` | — | `main@251bef39` | Disposable PG16 failure injection/recovery, 32 files | No | NO-GO | Fault injection only | 17 identical in #213, 15 evolved | **`SUPERSEDED_BY_NEWER_IMPLEMENTATION`** | PENDING |
| **#201** `fix/m03-s03-iam-provenance-revocation-20261117` | `ddc4824955` | — | `main@251bef39` | DB-authenticated approval provenance, revocation negatives, 17 files | No | NO-GO | IAM provenance | 6 identical, 11 evolved | **`SUPERSEDED_BY_NEWER_IMPLEMENTATION`** | PENDING |
| **#202** `integration/m03-s03-final-security-remediation-20261117` | `b5cfc06870` | `48087886` | `main@251bef39` | Unified staging of #198/#200/#201 scope, 39 files | No | NO-GO | Same as #198 | Same head as #198 | **`SUPERSEDED_BY_NEWER_IMPLEMENTATION`** | PENDING |
| **#203** `fix/m03-s03-ag01-ag05-approval-expiry-linearization-20261117` | `1fb5e1600f` | `4d0e7f19` | `main@251bef39` | Pre-DDL approval expiry linearization, 41 files | No | Draft, no GO | P05/R1 approval lifecycle | 28 identical, 13 evolved | **`SUPERSEDED_BY_NEWER_IMPLEMENTATION`** | PENDING |
| **#204** `test/m03-s03-ag04-whole-operation-benchmark-20261117` | `aa8d55f3e6` | — | #203 | Whole-operation benchmark | No | NO-GO | Deadline evidence | CONFLICTING | **`EXPERIMENTAL_KEEP_SEPARATE`** | PENDING |
| **#205** `docs/m03-s03-agent05-independent-iam-security-review-20261117` | `a7bfab5f56` | — | #203 | IAM concurrence + D1 2517 ms trust review (docs only) | No | Evidence, not code | D1 = 2517 ms frozen | — | **`EXPERIMENTAL_KEEP_SEPARATE`** (preserve evidence) | PENDING |
| **#206** `test/m03-s03-ag05-ag03-trusted-actor-watchdog-20261117` | `fb6e12203c` | — | #203 | Trusted-actor race + watchdog least privilege | No | NONPROD evidence | Privilege boundary | — | **`EXPERIMENTAL_KEEP_SEPARATE`** | PENDING |
| **#207** `docs/m03-s03-p05-governance-evidence-20261118` | `2f3a6afde7` | — | `main@251bef39` | P05/R1 policy-only owner decision + NO-GO evidence, 9 files | No | Evidence, not code | P05/R1 approved policy only | 6 paths absent from #213 | **`EXPERIMENTAL_KEEP_SEPARATE`** (preserve decision evidence) | P05/R1 policy recorded; no code merge |
| **#208** `experiment/m03-s03-r1-actor-linearization-20261118` | `130bd9633c` | — | #203 | R1-10 actor-fence experiment; deadlock proven | No | NO-GO | Deadlock proven | — | **`EXPERIMENTAL_KEEP_SEPARATE`** | PENDING |
| **#209** `experiment/m03-s03-r1-lock-order-e2-20261118` | `999246ce8a` | — | #208 | Lock-order + E2 actor-generation fixtures | No | NO-GO | — | — | **`EXPERIMENTAL_KEEP_SEPARATE`** | PENDING |
| **#210** `docs/m03-s03-p06-e2a-l1-governance-handoff-20261118` | `c8453f2e07` | — | #209 | P06/E2-A owner decision + L1/PG16 governance handoff, 8 files | No | NO-GO evidence | P06/E2-A frozen | 8 identical in #213 | **`EXPERIMENTAL_KEEP_SEPARATE`** | PENDING |
| **#211** `experiment/m03-s03-p06-e2a-l1-d1-final-engineering-20261118` | `035ec80346` | `0b8d1792` | #210 | P06/E2-A identity, delegated L1 gateway, D1 dispatch, SQLSTATE, 27 files | No | NO-GO | D1 scope restricted | 21 identical, 5 evolved | **`EXPERIMENTAL_KEEP_SEPARATE`** | PENDING |

### Experimental family counts

| Family | Branches (unmerged by ancestry) | Classification |
| --- | --- | --- |
| `experiment/m03-*` | 17 | `EXPERIMENTAL_KEEP_SEPARATE` — preserved, never merged wholesale |
| `audit/*` | 4 | `EXPERIMENTAL_KEEP_SEPARATE` — evidence only |
| `docs/m03-s03-*`, `docs/ag02-*` | 11 (family total) | `EXPERIMENTAL_KEEP_SEPARATE` — governance evidence |
| `dependabot/*` | 10 | Out of scope for this program; unchanged |
| legacy `fix/*`, `feat/*`, `codex/*`, `test/*`, `integration/*`, `chore/*`, `security/*`, `design/*`, `feature/*` | remainder | `ALREADY_MERGED` by content or stale/superseded; no action |

## 4. Classification summary

| Classification | Count / subjects |
| --- | --- |
| `ALREADY_MERGED` | #151, #166, #174, #176, #193 and the 98 ancestry-merged branches |
| `SAFE_TO_INTEGRATE` | **None** |
| `REQUIRES_INDEPENDENT_REVIEW` | None new; #213 already reviewed as conditional |
| `BLOCKED_BY_GOVERNANCE` | #213, #212 |
| `SUPERSEDED_BY_NEWER_IMPLEMENTATION` | #198, #200, #201, #202, #203 |
| `EXPERIMENTAL_KEEP_SEPARATE` | #204–#211, `experiment/m03-*`, `audit/*`, governance-doc branches |
| `CONFLICT_REQUIRES_REMEDIATION` | #204 (GitHub reports CONFLICTING); #199 also CONFLICTING |

## 5. Consolidation decision and evidence

**No executable code was integrated into the execution branch.**

Rationale, in dependency order:

1. The execution branch is `main@251bef39` plus ten planning documents. Every merged historical PR is already present through `main`; re-integrating would duplicate history.
2. The only substantial unmerged implementation (#213) carries three open governance gates (D-01, D-02, D-03), a conditional independent verdict, and **no recorded owner merge authorization**. Integrating it would silently convert a restricted, conditionally acceptable candidate into the coordinated baseline. The milestone protocol forbids that.
3. #212 is an owner-accepted **restricted contract**, not runtime, and M04 Batch 03 runtime is explicitly `NOT AUTHORIZED`.
4. #198–#211 are draft/NO-GO experiments. Most of their files are already absorbed, often in evolved form, by #213; merging them would reintroduce superseded races and privileges.
5. Every remaining branch is either already merged, stale legacy, dependabot, or evidence-only.

Therefore Phase 0 produces an **evidence-backed refusal to consolidate**, not a silent merge. This preserves the original certification boundary and prevents duplicate or regressed implementation.

**What was consolidated instead:** the machine-readable Epic execution ledger and this inventory, both documentation/verification artifacts with no runtime effect.

## 6. Mandatory approval blockers (unchanged)

- [ ] M03 **D-01** — READY V2 principal+tenant fence: Agent 05 scope note + owner approval + Agent 06 concurrence. No M04 runtime activation.
- [ ] M03 **D-02** — Backfill-specific retained/rewound PG16 PITR evidence, external authority/anchor, executable recoverable operator plan.
- [ ] M03 **D-03** — Named human DBA/IAM approval for migration 0061 trusted-owner UPDATE/TRUNCATE, identity immutability, audited metadata correction.
- [ ] M03 owner merge authorization for #213 after Agent 06 review on the immutable candidate.
- [ ] Wave 1 R26 / F-012 / R35 / R40 owner and AppSec decisions.
- [ ] Real IdP, non-superuser deployment owner, actual API/Worker/Redis/S3/backup isolation drills.
- [ ] M04 Batch 03 runtime authorization (not granted).

## 7. Preservation guarantees

- No branch was deleted, force-pushed or rewritten.
- No historical migration (`0059`, `0060`, `0061`) was edited.
- Frozen restrictions preserved: Policy A, P05/R1, P06/E2-A, D1 = 2517 ms, M = `NOT DETERMINABLE`, DELTA-08 and P07-RC-C disabled, Production `NO-GO`, Risk Acceptance `NONE`.
- Independent evidence remains distinguishable from newly written code.
