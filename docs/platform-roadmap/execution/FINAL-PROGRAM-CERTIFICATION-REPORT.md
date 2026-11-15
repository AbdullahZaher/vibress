# Final Program Certification Report — Wave 1

> **Date: 2026-11-15. Branch:** `feat/wave1-platform-kernel-tenant-isolation`
> **PR:** #166 (**open, not merged**). **Decision: WAVE 1 — NO-GO.**
>
> This report is evidence-based. Every result below was executed on this host
> against the dev PostgreSQL/Redis/MinIO services or read from GitHub Actions on
> the head SHA named. Nothing in this report is inferred from a document, a
> naming convention or an unexecuted plan. No production system, shared
> database, migration journal or git tag was changed.

## 1. Gate summary

| Mandatory gate | Status | Evidence |
| --- | --- | --- |
| PR #166 and CI on the exact head | **PASS for the verified heads; final-head run recorded in §7 after completion** | Runs 43685146696 → `9684362f`, 43690688602 → `0d712005` and 43706333296 → `d0fc26c3` report their own `head_sha`; no run is attributed to another commit. The final documentation head is claimed only after its conclusion is read |
| R26 `PUBLIC` EXECUTE revoked | **BLOCKED — DB owner + AppSec** | Proposal 0055 corrected and proven in a disposable DB (4/4); **not applied** to the shared database |
| F-012 CMS RLS decision | **BLOCKED — owners** | Option B recommended, not accepted; no RLS/grant change |
| F-012 supported topology enforced | **IMPLEMENTED and verified** | `UnsupportedTopologyError` before any DB URL read; 5 tests including a spawned-process refusal |
| Production non-superuser owner | **BLOCKED — deployment** | Dev/Compose owner is a superuser; non-superuser `FORCE RLS` proven only in an isolated test |
| Serving identity separation | **PARTIAL — verified for runtime/reader/verifier** | 8/8 throwaway-role deny-matrix tests; registry-provisioning and worker identities not split |
| Redis/S3/queue/secrets isolation | **BLOCKED — infrastructure authorization** | Harness and deny matrix specified in [W1-T06 request](W1-T06-RESOURCE-ISOLATION-REQUEST.md); nothing executed |
| Production IdP | **BLOCKED — IdP administrator** | Adapter contract and deny matrix specified in [W1-T07 request](W1-T07-IDENTITY-PROVIDER-REQUEST.md); static directory remains reference-only |
| R35 views/materialized views | **GUARDED — review pending** | Materialized views rejected; declared views must be `security_invoker`; 3/3 measured tests |
| R40 version identity | **BLOCKED — release owner** | [Decision record](R40-VERSION-IDENTITY-DECISION.md) prepared, unsigned |
| ADR/A1–A8/G0 sign-offs | **BLOCKED — unassigned** | No signature recorded, none fabricated |
| Independent review | **NOT PERFORMED** | Requested in the [ownership assignment request](OWNERSHIP-ASSIGNMENT-REQUEST.md); no reviewer identity exists |
| CMS/Studio compatibility | **PASS (unchanged)** | 6 files / 82 tests after the topology gate; pinned fixture pack green |
| Docs integrity | **PASS** | 674 links / 303 files (full tree), 102 links / 15 files (platform roadmap) |
| GO decision | **NO-GO** | Critical blockers above remain |

## 2. Implemented and verified in this round

| Increment | What was proven | Evidence |
| --- | --- | --- |
| R26 revocation proposal corrected | The draft `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public` was a measured no-op on PostgreSQL 16.15; the global form was substituted and proven in a disposable database with a non-superuser owner | `tests/integration/platform-r26-revocation.test.ts` **4/4**; shared DB audit unchanged (33 functions, 33 `PUBLIC`, 0 default ACLs); **nothing applied** |
| F-012 topology gate | The serving process refuses `PLATFORM_TOPOLOGY` other than `single-installation` and enabled external onboarding **before reading any database URL** | `tests/architecture/platform-deployment-topology.test.ts` **5/5**, including a spawned-process refusal |
| Production-shaped identity separation | Runtime, membership-reader and deployment-verifier logins are distinct, `NOSUPERUSER NOBYPASSRLS`, hold no SET-able memberships, and each is denied beyond its own surface with real `42501`; tenant RLS verified under the runtime identity; throwaway roles/rows dropped | `tests/integration/platform-production-topology.test.ts` **8/8**; cleanup verified (0 `topo_%` roles/rows) |
| R35 runtime view surface | Materialized views are rejected by contract validation; a declared view without `security_invoker` fails boot with `view_not_security_invoker`; the leak is measured (direct table read 0 rows, non-invoker view returns the row on the superuser-owned dev fixture); an accepted view respects tenant scope | `tests/integration/platform-view-surface.test.ts` **3/3**; cleanup verified (0 `r35_%` roles/views/rows); contract-validation test extended |
| CI attribution | Reports now attribute runs only to their own `head_sha` | Runs listed in §1 |
| Docs and links | All changed docs validate, including the new R35 and W1-T06/T07 documents | Link validators above |

Platform suite after these changes: **15 files / 211 tests passed**, exit 0
(`platform-reference-app` 86/86). Targeted `tsc` for `packages/database` and
`apps/platform-reference` passed; ESLint on all changed files passed.

## 3. Implemented but awaiting review

| Item | Why it is not certified |
| --- | --- |
| R35 view policy | Enforced in code and measured, but no independent reviewer has examined the decision that runtime views must be `security_invoker` and that materialized views are excluded |
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
| W1-T07 production IdP | Non-production IdP tenant, client registration, claims agreement, revocation choice, three test principals and out-of-band secrets. Exact adapter contract and deny matrix: [W1-T07 request](W1-T07-IDENTITY-PROVIDER-REQUEST.md) |
| Broader CMS Playwright/staging acceptance | Staging secrets and environment not available |

## 6. Failed or incomplete — not reported as PASS

| Item | Status |
| --- | --- |
| Full local integration suite | **44/46 files, 583/595 tests**; 12 LMS tests fail on `getaddrinfo ENOTFOUND site-a-<runId>.localhost` because this host no longer resolves wildcard `*.localhost`. The same failures reproduce at baseline `c34e159d`. **Environment defect, not a pass.** CI on Linux resolves the wildcard and its integration step passed |
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
