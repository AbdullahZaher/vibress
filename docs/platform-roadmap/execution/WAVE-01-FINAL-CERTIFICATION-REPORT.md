# Wave 1 Final Certification Report — M00–M02

> **Date: 2026-11-15. Branch:** `feat/wave1-platform-kernel-tenant-isolation`
> **Verified source HEAD:** `a9d99a414f671583485900433286702f6a5b6a2c`.
> **PR:** #166 (**open, not merged**). **Decision: WAVE 1 — NO-GO.**
>
> **Scope:** this report certifies Wave 1 only (M00–M02). It is **not** a
> program-wide certification; Waves 2–5 are not started, and
> [FINAL-PROGRAM-CERTIFICATION-REPORT.md](FINAL-PROGRAM-CERTIFICATION-REPORT.md)
> remains an interim placeholder for the eventual program-wide review.
>
> This report is evidence-based. Every result below was executed on this host
> against the dev PostgreSQL/Redis/MinIO services or read from GitHub Actions on
> the head SHA named. Nothing in this report is inferred from a document, a
> naming convention or an unexecuted plan. No production system, shared
> database, migration journal or git tag was changed.
>
> **Publication note:** the report text itself is published in
> documentation-only commits on top of the verified source HEAD `a9d99a41`;
> those commits do not change code or evidence. The docs-only commit
> `0d308dfa` passed its own CI run 43752560245 (all three jobs), recorded in
> §1 and §2. That run attests the documentation tree only; it does not
> re-attest the code evidence measured on `a9d99a41`.

## 1. Gate summary

| Mandatory gate | Status | Evidence |
| --- | --- | --- |
| PR #166 and CI on the exact head | **PASS per head** | Runs 43685146696 → `9684362f`, 43690688602 → `0d712005`, 43706333296 → `d0fc26c3`, 43742169334 → `0d248dc6`, 43744722260 → `beaeeb71`, 43750359129 → `a9d99a41` (verified source HEAD) and 43752560245 → `0d308dfa` (subsequent docs-only head) each report their own `head_sha`; no run is attributed to another commit |
| R26 `PUBLIC` EXECUTE revoked | **BLOCKED — DB owner + AppSec** | Proposal 0055 corrected and proven in a disposable DB (4/4); **not applied** to the shared database |
| F-012 CMS RLS decision | **BLOCKED — owners** | Option B recommended, not accepted; no RLS/grant change |
| F-012 supported topology enforced | **IMPLEMENTED and verified** | `UnsupportedTopologyError` before any DB URL read; 8 tests including a spawned-process refusal |
| Production non-superuser owner | **BLOCKED — deployment** | Dev/Compose owner is a superuser; non-superuser `FORCE RLS` proven only in an isolated test |
| Serving identity separation | **PARTIAL — verified for runtime/reader/verifier** | 8/8 throwaway-role deny-matrix tests; registry-provisioning and worker identities not split |
| Redis/S3/queue/secrets isolation | **BLOCKED — infrastructure authorization** | Harness and deny matrix specified in [W1-T06 request](W1-T06-RESOURCE-ISOLATION-REQUEST.md); nothing executed |
| Production IdP | **BLOCKED — IdP administrator** | Offline adapter contract and deny matrix prepared in [W1-T07 request](W1-T07-IDENTITY-PROVIDER-REQUEST.md) and `apps/platform-reference/src/oidc-principal-verifier.ts`; the static directory remains reference-only and is refused in production-shaped processes and for any non-`reference` auth mode |
| R35 views/materialized views | **GUARDED — review pending** | Materialized views rejected; declared views must be `security_invoker`; 3/3 measured tests; auditor code/catalog review recorded in §2.1 |
| R40 version identity | **BLOCKED — release owner** | [Decision record](R40-VERSION-IDENTITY-DECISION.md) prepared, unsigned |
| ADR/A1–A8/G0 sign-offs | **BLOCKED — unassigned** | No signature recorded, none fabricated |
| Independent review | **NOT PERFORMED** | Requested in the [ownership assignment request](OWNERSHIP-ASSIGNMENT-REQUEST.md); no reviewer identity exists |
| CMS/Studio compatibility | **PASS (unchanged)** | 6 files / 82 tests after the topology gate; pinned fixture pack green |
| Docs integrity | **PASS** | 692 links / 305 files (full tree), 120 links / 17 files (platform roadmap) |
| GO decision | **NO-GO** | Critical blockers above remain |

## 2. Implemented and verified in this round

| Increment | What was proven | Evidence |
| --- | --- | --- |
| R26 revocation proposal corrected | The draft `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public` was a measured no-op on PostgreSQL 16.15; the global form was substituted and proven in a disposable database with a non-superuser owner | `tests/integration/platform-r26-revocation.test.ts` **4/4**; shared DB audit unchanged (33 functions, 33 `PUBLIC`, 0 default ACLs); **nothing applied** |
| F-012 topology gate | The serving process refuses `PLATFORM_TOPOLOGY` other than `single-installation` and enabled external onboarding **before reading any database URL** | `tests/architecture/platform-deployment-topology.test.ts` **8/8** (topology + auth-mode gates), including two spawned-process refusals |
| Production-shaped identity separation | Runtime, membership-reader and deployment-verifier logins are distinct, `NOSUPERUSER NOBYPASSRLS`, hold no SET-able memberships, and each is denied beyond its own surface with real `42501`; tenant RLS verified under the runtime identity; throwaway roles/rows dropped | `tests/integration/platform-production-topology.test.ts` **8/8**; cleanup verified (0 `topo_%` roles/rows) |
| R35 runtime view surface | Materialized views are rejected by contract validation; a declared view without `security_invoker` fails boot with `view_not_security_invoker`; the leak is measured (direct table read 0 rows, non-invoker view returns the row on the superuser-owned dev fixture); an accepted view respects tenant scope | `tests/integration/platform-view-surface.test.ts` **3/3**; cleanup verified (0 `r35_%` roles/views/rows); contract-validation test extended |
| Offline OIDC verifier (W1-T07 safe portion) | RS256/ES256 algorithms only, strict `kid` lookup against a static JWKS, signature and `iss`/`aud`/`exp`/`nbf`/`iat` verification with bounded skew, required `sub`, application+installation binding, derived principal id, and no trust in tenant/role/permission claims. **Not wired** into serving | `apps/platform-reference/src/oidc-principal-verifier.test.ts` **21/21** with generated in-memory keys |
| Reference auth-mode gate | Static bearer tokens are refused when `NODE_ENV=production` or `PLATFORM_ENVIRONMENT` is production-shaped, and any non-`reference` mode is refused; a spawned process stops before reading a database URL | `tests/architecture/platform-deployment-topology.test.ts` **8/8** (3 auth-mode tests incl. spawned process) |
| CI attribution | Reports now attribute runs only to their own `head_sha` | Runs listed in §1 |
| Docs and links | All changed docs validate, including the new R35 and W1-T06/T07 documents | Link validators above |

Platform suite after these changes: **15 files / 214 tests passed**, exit 0,
19.14 s (`platform-reference-app` 86/86). Targeted `tsc` for
`packages/database` and `apps/platform-reference` passed; ESLint on all changed
files passed. CI run
[43750359129](https://github.com/AbdullahZaher/vibress/actions/runs/43750359129)
on verified HEAD `a9d99a41` passed typecheck, lint, explicit-any guard, docs
links, unit, integration, locale replay, build, clean-tree, dependency audit,
`e2e` and `container-scan`; the prior head `beaeeb71` passed run
[43744722260](https://github.com/AbdullahZaher/vibress/actions/runs/43744722260)
on `build`, `e2e` and `container-scan`; the subsequent docs-only head
`0d308dfa` passed run
[43752560245](https://github.com/AbdullahZaher/vibress/actions/runs/43752560245)
on `build`, `e2e` and `container-scan`.

## 2.1 Auditor code/catalog review — R35 view surface and function authority

Reviewed files: `packages/database/src/platform-runtime-role.ts`,
`packages/database/src/platform-runtime-privilege-contract.ts`,
`tests/integration/platform-view-surface.test.ts` and the policy record.

| Requirement | Verdict | Measured basis |
| --- | --- | --- |
| Materialized views rejected | **Enforced** | `assertValidRuntimePrivilegeContract` throws before any SQL for `kind: "materialized_view"`; validated by the R35 test and the reference-app contract test |
| Ordinary views must be `security_invoker=true` | **Enforced** | Boot inspects `pg_class.reloptions` for every declared view; `security_invoker` absent or not `true`/`on` produces `view_not_security_invoker`. Measured catalog behavior in a rolled-back transaction: before `ALTER VIEW` reloptions are empty; after it they are `{security_invoker=true}` |
| Authorization precedes traffic | **Enforced** | The assertion runs at boot before the server starts serving; the reference app refuses to start on any violation |
| Underlying table authority evaluated as the runtime identity | **Enforced** | Contract inspection uses `has_table_privilege`, `has_any_column_privilege`, `has_sequence_privilege` and `has_function_privilege` for `current_user` and `session_user`, so direct, inherited and `PUBLIC` authority are all visible |
| RLS remains effective through an approved view | **Enforced for `security_invoker` views** | With the option set, the runtime sees 0 rows unscoped and exactly its tenant's row when scoped; the same view without the option leaks a row on the superuser-owned dev fixture (leak measured, not assumed) |
| Cross-tenant leakage through approved views | **Prevented within scope** | Tenant policies on `platform_crm_customers` are evaluated as the caller through the view; the R35 test proves the scoped result is exactly `[customerId]` |
| `SECURITY DEFINER` cannot bypass | **Enforced** | Any executable non-system `SECURITY DEFINER` function produces `security_definer_execute`; reference-app tests cover both a named function and a contract-authorized name |
| Unsupported report surfaces excluded | **Enforced for materialized views** | Materialized views are excluded outright; foreign tables remain an accepted contract kind and are **not** covered by PostgreSQL RLS (see residual scope) |

**Auditor conclusion (not an independent reviewer):** R35 is **technically
enforced within the verified Runtime Contract scope**. It is not a general
guarantee that every PostgreSQL view or reporting path is caller-safe:

- views read by owner-credential code (provisioning, operators) are outside the
  runtime contract and are not evaluated;
- non-runtime identities (reader, verifier, worker, migration) are not view
  consumers today and are not covered by this check;
- trigger functions are excluded from the executable-function check and remain
  part of the R26 `PUBLIC` EXECUTE inventory;
- a declared `foreign_table` is accepted by the contract, but PostgreSQL cannot
  apply row-level security to a foreign table, so declaring one requires a
  separate review of the foreign server's authorization.

No path above is claimed secure by absence of a guard; each is explicitly
excluded and remains open where noted.

## 2.2 Auditor review — F-012 gate and serving topology

| Requirement | Verdict | Measured basis |
| --- | --- | --- |
| Unsupported topology fails closed before DB access | **Enforced** | `assertSupportedTopology` runs before any database URL is read; 3 topology tests plus a spawned-process refusal |
| Reference auth cannot become production auth | **Enforced at boot** | `assertReferenceAuthenticationMode` refuses reference tokens in `NODE_ENV=production` or production-shaped `PLATFORM_ENVIRONMENT`, and refuses any other mode; spawned-process refusal proven |
| Serving identities are distinct and least-privilege | **Verified** | 8/8 production-topology tests: runtime, membership reader and deployment verifier are distinct `NOSUPERUSER NOBYPASSRLS` logins with no SET-able memberships; each denied beyond its own surface with `42501`; tenant RLS verified under the runtime identity |
| Production non-superuser owner | **Not verified in this topology** | The dev fixture owner and Compose owner remain superusers; a non-superuser `FORCE RLS` proof exists only in an isolated database |
| Registry-provisioning and worker identity split | **Not implemented** | Registry writes still run as the database owner; no worker identity exists in this build |
| CMS table RLS (F-012 option A) | **Not implemented** | Decision remains with the security review owner and DB owner; option B is recommended, not accepted |

**Auditor conclusion (not an independent reviewer):** the F-012 topology gate
is fail-closed and the three serving identities are genuinely separated and
denied beyond their surface. This does **not** accept option B, does not provide a production
non-superuser owner, and does not close F-012. The option A/B decision remains a
human gate.

## 3. Implemented but awaiting review

| Item | Why it is not certified |
| --- | --- |
| R35 view policy | Enforced in code and measured, but no independent reviewer has examined the decision that runtime views must be `security_invoker` and that materialized views are excluded. The author's code/catalog review is recorded in §2.1 and does not replace an independent reviewer |
| Offline OIDC verifier | Contract and deny matrix are implemented and tested offline, but the adapter is not wired, has no live issuer/JWKS/revocation, and no IdP administrator or security owner has approved it |
| F-012 topology gate | Fail-closed gate is proven; it does **not** accept option B and does not enable CMS RLS |
| Identity separation harness | Runs against a dev superuser owner; the production non-superuser owner proof exists only in an isolated database |
| R26 corrected proposal | SQL is executable and proven, but approval, scope B (legacy role grants) and application are still required |
| Reference three-identity serving process | Refuses `DATABASE_URL`, requires three distinct URLs and removes them from the environment after pool creation; operational adoption still needs the deployment owner |

## 4. Blocked by human authorization

| Item | Required approval |
| --- | --- |
| R26 revocation and default-privilege change | DB owner + AppSec lead, including global-blast-radius acceptance and scope B |
| F-012 option A/B | Security review owner + DB owner |
| Non-superuser deployment owner | DB owner/infrastructure owner; re-verification in the deployment topology |
| Registry-provisioning identity and worker identity split | Architecture owner + DB owner; requires a reviewed grant/code change |
| ADR-PLAT-001/002/003, A1–A8, G0 | Named owners; currently unassigned |
| R40 version identity | Release owner |
| Independent review | Security owner must name a reviewer other than the author |
| PR #166 merge | All of the above plus release approval; **not merged** |

## 5. Blocked by external infrastructure

| Item | Blocker |
| --- | --- |
| W1-T06 Redis/S3/queue/secrets deny matrix | Authorization to create throwaway Redis ACL users, MinIO user/policy/bucket on the dev stack (or a disposable production-shaped stack), and to use the dev root credentials. Exact harness and deny matrix: [W1-T06 request](W1-T06-RESOURCE-ISOLATION-REQUEST.md) |
| W1-T07 production IdP | Non-production IdP tenant, client registration, claims agreement, revocation choice, three test principals and out-of-band secrets. **The offline verifier and auth-mode gate are complete; live wiring remains blocked.** Exact contract and deny matrix: [W1-T07 request](W1-T07-IDENTITY-PROVIDER-REQUEST.md) |
| Broader CMS Playwright/staging acceptance | Staging secrets and environment not available |

## 6. Failed or incomplete — not reported as PASS

| Item | Status |
| --- | --- |
| Full local integration suite | **Re-run 2026-11-15: 49 files / 610 tests passed**, exit 0, 141.47 s. The earlier full runs recorded 44/46 files and 583/595 tests with 12 LMS tests failing on `*.localhost`; that failure does not reproduce on this host today (measured: `dscacheutil` and `dns.lookup` resolve `site-a-probe.localhost` to `::1` and `127.0.0.1`). Those earlier failures remain environment-specific evidence and are not retroactively passed. A first run on this tree recorded one failure — `real-lms-pilot-host.test.ts` Step 4 exceeded the default 5 s timeout under load; the same file then passed **8/8** standalone (Step 4 891 ms) and the sequential full rerun passed **610/610**. Not hidden: the 5 s default remains a load-sensitive timeout, not a product pass on the first attempt |
| Unit suite, supported engine | **364 files / 2614 tests passed** under Node 24.16.0 (the repo declares `>=24 <25`), exit 0, 246.53 s. A first run under Node 26.13.0 (outside the declared engine) had 5 failures in `apps/portal/src/lib/return-to.test.ts` and `apps/admin/.../ImportExportCard.test.tsx`: Node 26 defines a `globalThis.localStorage` accessor that returns `undefined` without `--localstorage-file`, and the jsdom global population skips the already-present key. Measured directly on both runtimes; environment-specific, not a product regression |
| CMS table RLS | **Not implemented** (F-012). Isolation is application-level only |
| Artifact provenance | The digest is operator-supplied; no mechanism proves executable code matches it |
| Worker identity | Does not exist in this build |
| Non-superuser owner in the live topology | Not applied; superuser owner remains in dev/Compose |
| R26 legacy role grants (scope B) | Open; 0055 alone does not close them |

## 7. Score

Per the directive, **the score is not recalculated** on documentation alone. The
six-dimension rubric stands at **8.3/10** (privilege separation 8.7, verification
correctness 8.7, test evidence 8.7, compatibility 8.5, operational readiness 6.5,
auditability 8.5). The critical blockers in §4 and §5 override any score.

## 8. Exact next actions (owners, in order)

1. **DB owner + AppSec lead:** sign the [R26 approval request](R26-REVOCATION-APPROVAL-REQUEST.md) (global default ACL, scope B) and authorize execution in the shared database.
2. **Security review owner + DB owner:** accept or reject F-012 option A/B; RLS work cannot start without this.
3. **DB/infrastructure owner:** approve a non-superuser deployment owner and the [W1-T06](W1-T06-RESOURCE-ISOLATION-REQUEST.md) harness access.
4. **IdP administrator + security owner:** provide the [W1-T07](W1-T07-IDENTITY-PROVIDER-REQUEST.md) tenant, client, claims and revocation decision.
5. **Security owner:** name an independent reviewer and record the review.
6. **Release owner:** decide R40 and the framework version line.
7. **Architecture owner:** decide the registry-provisioning and worker identity split.
8. Only after 1–7: recompute the rubric, re-verify in the production-shaped topology, and issue a new GO/NO-GO.

## 9. Statement of limitations

- No production system, shared database, migration journal, release tag or
  published contract was modified by this round.
- The dev PostgreSQL owner is a superuser; this is disclosed wherever RLS or the
  R35 leak proof depends on it.
- Local test evidence is local; CI evidence is cited only for the run whose
  `head_sha` matches the named commit.
- This report does not accept any ADR, does not approve any residual, and does
  not authorize Wave 2.

---

## 2026-11-16 governance reconciliation — no new certification or test execution

**Coordinator classification: NO-GO; all human and independent approval gates remain open.**
The source evidence and earlier 2026-11-15 measurements above remain historical;
this addendum neither changes their original test dates nor upgrades them into
newly executed results. The PR HEAD **before** governance-only document changes was
`a96ea073767e303b02121d87558adbd12ce111f3`; its GitHub [CI run 43755004357](https://github.com/AbdullahZaher/vibress/actions/runs/43755004357)
has `build`, `e2e`, and `container-scan` **success** on that **same**
`head_sha`. This commit follows source commit
`f0d8aaedb90c4debca5cf792480e297ca12e1832` by three docs-only commits.
Any subsequent governance commit requires its own CI result; past head results
are **not** a substitute.

The new [WAVE-01-GATE-CLOSURE-MATRIX.md](WAVE-01-GATE-CLOSURE-MATRIX.md)
documents 35 acceptance criteria and the outstanding R26, F-012, R35, R40,
production owner, infrastructure, IdP, restore/monitoring, ADR and independent
review gaps. The [WAVE-01-APPROVAL-REGISTER.md](WAVE-01-APPROVAL-REGISTER.md)
records 37 decision/approval entries, including individually tracked A1–A8 and
G0–G7, with **no fabricated named owners or signatures**. The
[WAVE-01-RELEASE-DECISION-PACKET.md](WAVE-01-RELEASE-DECISION-PACKET.md)
binds GitHub checks and historical tests to their correct SHAs and records
the proposed **NO-GO** only.

**New review data:** the connector returned four `COMMENTED` PR reviews,
zero `APPROVED` reviews, all from the PR author; 20 of 20 inline review
threads are unresolved (some are marked outdated). These do **not** establish
independent reviewer approval. `main` reports `protected: false`, the
accessible rulesets list is empty, and the detailed branch protection API
returns HTTP 403 to this connection: effective merge safeguards require
administrator verification, not inference.

**New supply-chain finding SUPPLY-2026-01 (Medium, CVSS 5.9):** the PR lockfile
pins `fastify@5.12.7`; [GHSA-3qgw-9275-xf8w /
CVE-2026-120216](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w),
published 2026-11-02 and cross-checked against
[OSV](https://osv.dev/vulnerability/CVE-2026-120216) (modified 2026-11-09),
affects `>=5.8.0 <5.12.8` when a non-default nonzero `handlerTimeout`
is combined with a streaming route. Whether Vibress configures that
exploitable combination is **unverified**, so Agent 03 must check actual
reachability and provide an evidence-based disposition, ideally upgrading
to `>=5.12.8` and retesting. A passing historical dependency-audit step
does not establish the absence of a newly identified Medium finding.

**Historical quality score remains 8.3/10 (change = 0.0).** No production
environment was accessed; no secret, privilege, migration, tag, branch
protection, release authorization, PR merge, or Wave 2 work was performed by
this documentation update. For any report whose header states a former
verified source head, this addendum records the **later governance baseline**
without overwriting the prior source/date history.



## Six-agent integration addendum — 2026-11-16 (technical evidence, NO-GO)

A separate integration candidate was assembled on branch integration/wave1-agents-01-06-20261116 from #166 HEAD 3c55c5b0a1bcbd9093ade62c5b6f738acbe42021. Exact specialist sources: #171 9ee1d2b3, #172 d149804e, #173 e97ff02d and #174 bf1a63ce. The combined code/evidence path through 108ae9497974217948fd1a273044198553b33243 adds AG06-05 transactional role provisioning and fault tests, R35 foreign-table denial, offline membership-enriched OIDC (not production-wired), disposable Redis/S3 harness, and a reference CRM Playwright CI job. This document update is a further SHA change and requires final-head CI.

No R26 proposal was applied; F-012 remains undecided; actual BullMQ worker, production IdP and patched production PostgreSQL are unverified; image provenance and restoration remain open. The last independent Agent 06 review predates integration; 22 #166 threads and all required human signatures remain outstanding. Github main was reported unprotected by branch API; administrator policy change is not authorized by this addendum. Preserve the recorded 8.3/10 until independent reassessment. No merge, Wave 2, release or risk exception is authorized.

Full decision-ready evidence, role matrix and mandatory remaining gates: WAVE-01-SIX-AGENT-INTEGRATION-2026-11-16.md.
