# Wave 1 — Integrated PR/Commit Evidence Register

> Snapshot 2026-11-16 16:03 Asia/Riyadh. **NO-GO**. This register records GitHub metadata and prior report claims; it does not issue specialist approval. Pre-document-update candidate `63c47b3adda183d816727edc7b590979b2a8c2da`. Any subsequent commit invalidates final-head CI attribution until rerun.

| PR / owner | Source HEAD | Integration commit | Changed surface | CI / tests / review | Disposition |
| --- | --- | --- | --- | --- | --- |
| #166 / Agent 01 | `3c55c5b0a1bcbd9093ade62c5b6f738acbe42021` | integration base | kernel, RLS, reference, governance | Run [43862790731](https://github.com/AbdullahZaher/vibress/actions/runs/43862790731) PASS historical; 5 COMMENTED reviews, 0 APPROVED, 22 unresolved threads | SOURCE BASE ONLY; no GO |
| #171 / Agent 03 | `9ee1d2b3639aa717c4a09689dfb916b5970b04c6` | `a0d3177f6a1b976337340ad2c3ba24213fc6b195` | F-012, R35 foreign-table guard, AppSec findings | Draft; 0 approvals; 4 proposed architecture tests, integration CI pending | IMPORTED, INDEPENDENT REVIEW PENDING |
| #172 / Agent 02 | `d149804e19b2a8cfbe7c3eee849e5651bb12ce41` | `e739d8df3cbdb35dbf3ec2912f73db671e8087d7` | R26 audit SQL, PG role topology, DB findings | Draft; 0 approvals; SQL census prepared not executed | IMPORTED, DB APPROVAL BLOCKED |
| #173 / Agent 05 | `e97ff02deb8e8c733df9e4d3cbc110b368c6fd1c` | `48b601542aac6caf973e01d1643cdc0384718a80` | offline OIDC adapter + tests, revocation design | Draft; 0 approvals; live IdP not connected | IMPORTED, PRODUCTION IDP BLOCKED |
| #174 / Agent 04 | `bf1a63ce43d8e812f08fd9364eda2b2afc1d9169` | `17dfa343e6dd1fd2e94c3670269b4f43182d8c99` | disposable Redis/S3 38-case harness, workflow | [43864193113](https://github.com/AbdullahZaher/vibress/actions/runs/43864193113) PASS at source HEAD; no real BullMQ/staging deny | IMPORTED, PRODUCTION INTEGRATION BLOCKED |
| #175 | 404 inaccessible/not found | — | cited by prior T06 report as issue; not confirmed | No PR evidence | DO NOT ASSUME EXISTS |
| #176 / Integration | `63c47b3adda183d816727edc7b590979b2a8c2da` | same | all imports plus AG06 fixes | [43870098128](https://github.com/AbdullahZaher/vibress/actions/runs/43870098128) **IN PROGRESS**, checkout and job head SHA matched this source commit; `build` job unfinished, resource-isolation check SUCCESS. 0 review approvals | CANDIDATE ONLY / NO-GO |

## Integration-owned changes (not specialist approvals)

| Commit | Source ownership | Claim and verification gap |
| --- | --- | --- |
| `4373f074041176b527dcca35290290f9d8bf6d49` | DB engineer / Agent 02 review required | AG06-05 transactional multi-role provisioning; unknown COMMIT requires operator reconciliation |
| `4a6c7a2085e7e15dd4a9e7290791a40a8ffd7d67` | QA / Agent 02 | PG rollback/retry/race tests; need exact final-head execution |
| `2ec1054daf0ba4fa2066f915b0aa9ac6ea2640fc` | CI / Agent 03/04 | reference Playwright required job; final run not complete |
| `108ae9497974217948fd1a273044198553b33243` | QA / Agent 02 | E2E atomic roles, PostgreSQL 16.16 fixture guard; verify checkout and runtime version |
| `63c47b3adda183d816727edc7b590979b2a8c2da` | Governance | integrated intake and owner packet; **not** a source validation pass |

## Exact-checkout integrity

GitHub run 43870098128 is a **push** on `integration/wave1-agents-01-06-20261116`, not a synthetic PR merge ref; run `head_sha` and build job `head_sha` were `63c47b3a` at inspection. The `actions/checkout@v7` step was successful, but the logs have **not** independently shown the resulting `git rev-parse HEAD`; do not claim the checked-out SHA is verified until a log or emitted provenance file establishes it. Future PR-triggered checks must distinguish `refs/pull/176/merge` synthetic checkout from `pull_request.head.sha`. Record event, run ID, run attempt, workflow head_sha, job head_sha, checkout commit, container digest, and fixture digest for every final proof.

## Source conflict and ownership rule

Specialist PRs are **not merged**; integration cherry-picked/ported pinned source snapshots. Any edit to `packages/database` or provisioning requires Agent 02 review, to runtime contracts/auth requires Agent 03/05, to Redis/S3/CI requires Agent 04, and to acceptance/governance requires Agent 01; all technical changes require Agent 06 independent final verification. Do not cherry-pick new specialist commits without diff review, explicit file ownership and new tests.

## Independent finding issue register

| ID | Issue | Remediation candidate | Test/approval disposition |
| --- | --- | --- | --- |
| AG06-01 | [#177](https://github.com/AbdullahZaher/vibress/issues/177) | NONE | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-02 | [#178](https://github.com/AbdullahZaher/vibress/issues/178) | NONE | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-03 | [#179](https://github.com/AbdullahZaher/vibress/issues/179) | NONE | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-04 | [#180](https://github.com/AbdullahZaher/vibress/issues/180) | 48b60154 (offline only) | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-05 | [#181](https://github.com/AbdullahZaher/vibress/issues/181) | 4373f074 + 4a6c7a2 | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-06 | [#182](https://github.com/AbdullahZaher/vibress/issues/182) | NONE | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-07 | [#183](https://github.com/AbdullahZaher/vibress/issues/183) | 2ec1054d | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-08 | [#184](https://github.com/AbdullahZaher/vibress/issues/184) | NONE | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-09 | [#185](https://github.com/AbdullahZaher/vibress/issues/185) | a0d3177f | OPEN, requires exact-final-SHA tests and independent disposition |
| AG06-11 | [#186](https://github.com/AbdullahZaher/vibress/issues/186) | NONE | OPEN, requires exact-final-SHA tests and independent disposition |

Agent 06's previously documented IDs include AG06-01..09 and AG06-11; **AG06-10 is not in the reviewed integration finding register**, so it is not invented here. Issue #175 returned 404 as PR and has not been assumed to contain a validated finding. No issue is closed.

## Verification references (checked 2026-11-16)

- [PR #176](https://github.com/AbdullahZaher/vibress/pull/176), [run 43870098128](https://github.com/AbdullahZaher/vibress/actions/runs/43870098128).
- [GitHub Actions PR merge refs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request) and [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- [PostgreSQL 16.16 release](https://www.postgresql.org/docs/16/release-16-16.html), published 2026-11-12.
- [Fastify advisory](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w), published 2026-11-02.
