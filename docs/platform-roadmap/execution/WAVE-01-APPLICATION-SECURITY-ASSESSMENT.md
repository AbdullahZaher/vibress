# WAVE-01 APPLICATION SECURITY ASSESSMENT — Agent 03

> AI-assisted technical assessment, **not** human AppSec sign-off. Date: 2026-11-16.
> Repository: AbdullahZaher/vibress; PR #166; baseline `a96ea073767e303b02121d87558adbd12ce111f3`.
> Comparison editor: AbdullahZaher/vibress-studio (main metadata and security test directory reviewed).
> **Verdict: BLOCKED / NO-GO recommendation.** This review does not approve Option B, R26 grant changes, production access, or a merge.

## 1. Evidence and limitations

GitHub PR metadata confirms 107 changed files, a source HEAD `a9d99a414f671583485900433286702f6a5b6a2c`, followed by two documentation-only commits through the pinned review HEAD. The current HEAD has successful GitHub Actions run [43755004357](https://github.com/AbdullahZaher/vibress/actions/runs/43755004357) (`build`, `e2e`, `container-scan`); source HEAD run [43750359129](https://github.com/AbdullahZaher/vibress/actions/runs/43750359129) is reported green across unit, integration, typecheck, lint, dependency audit and other jobs. These runs **predate this remediation branch**. The reviewer read selected source and test files via GitHub; no local database, Redis, S3, container, interactive HTTP application, or installed workspace was available. Tests reported in the existing Wave 1 certification are **third-party historical evidence, not independently rerun** here. There are no independently recorded exploit attempts against real services in this review.

Read source: `apps/platform-reference/src/{server,main,topology,token-directory,oidc-principal-verifier}.ts`; `packages/tenancy/src/{executor,scope,policy,unit-of-work}.ts`; `packages/database/src/{platform-runtime-privilege-contract,platform-runtime-role,runtime-role}.ts`; `apps/api/src/main.ts`; `packages/cache/src/index.ts`; `tests/integration/platform-view-surface.test.ts`; `SECURITY-REVIEW.md`; F-012/R26/R35/W1-T06 reports. Unreviewed routes and external integrations are unverified, not silently cleared.

## 2. Verified implementation controls and exact boundaries

- The platform reference `RouteExecutor` authenticates required route kind and application ID, demands a tenant ID, resolves server membership, checks membership and principal policy, and uses transaction-bound verified scope. Public actions receive a database-denying facade. This is a source-level observation; API misuse and role-integrity tests are not independently rerun.
- The reference request server maps bearer credentials to a server-side token directory; production-shaped boot refuses the static token mode. The offline OIDC verifier checks signature, algorithm, issuer, audience, timing, `kid`, application and installation bindings but is intentionally **not connected** to live serving.
- The reference DB runtime contract declares `platform_crm_customers` only. R35 previously rejects materialized views and checks `security_invoker` on declared views at boot. The current baseline **permits** `foreign_table` (see finding AS-03); the proposed branch adds a fail-closed validation guard.
- Legacy `apps/api` / worker remain a **separate** surface. `packages/database/src/runtime-role.ts` grants broad DML, public schema CREATE and function EXECUTE to `vibress_app`; the new platform reference runtime contract does not automatically protect legacy CMS routes, workers or plugins.
- `apps/api/src/main.ts` configures Redis-backed rate limits with `skipOnError: true`, meaning upstream Redis errors can disable that limiter. Which production routes are exploitable under this outage must be tested.
- `pnpm-lock.yaml` contains `fastify@5.12.7`; vendor [GHSA-3qgw-9275-xf8w](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w) affects 5.8.0–5.12.7 only when a nonzero handlerTimeout is combined with a streaming response (fixed in 5.12.8). The reviewed Fastify constructors do not set a nonzero handlerTimeout. Exposure is **conditional, not demonstrated**; upgrade with regenerated lock and rerun audits.

## 3. Confirmed source-level findings (not claimed exploit demonstrations)

| ID | Priority | Source-backed condition | Exploitability and impact |
| --- | --- | --- | --- |
| AS-01 | P1 / release blocker | CMS publication tables have no `FORCE RLS` and legacy worker/API role can read all CMS tables; `F-012-CMS-RLS-DECISION.md` states this explicitly | Compromise of a service credential or unsafe direct DB/query path could cross publication boundary; no external exploit reproduced |
| AS-02 | P1 / release blocker | Redis and S3/queue clients share identities; prefixes are conventions (W1-T06; `packages/cache/src/index.ts`) | Compromised worker/app credential could access another namespace if infrastructure permits; restricted-principal denial not measured |
| AS-03 | P1 potential / P2 present scope | Runtime relation-kind validator accepts `foreign_table` while R35 relies on locally enforced caller RLS | A future contract can authorize an FDW surface outside this RLS proof; source-level bypass of the validation rule, not an observed data leak |
| AS-04 | P2 | Legacy `provisionRuntimeRole` explicitly grants EXECUTE on all existing/future functions; R26 revocation proposal is unapplied | Future unsafe owner functions or compromised plugins could magnify authority; current inventory records zero SECURITY DEFINER functions |
| AS-05 | P2 / conditional | Redis rate limiter `skipOnError: true` and `fastify@5.12.7` advisories | Controls may fail open on Redis errors; Fastify advisory requires a nonzero handlerTimeout and streaming response—neither exploitation nor active configuration established |
| AS-06 | P0 production-readiness gate (not a discovered exploit) | No wired production IdP and no production-proven isolated credentials, non-superuser owner, backup/restore and rollback | Production release evidence missing; reference app rejects production-shaped static auth as intended |

See [WAVE-01-SECURITY-RISK-REGISTER.md](WAVE-01-SECURITY-RISK-REGISTER.md) for reproduction, conditions and owners.

## 4. Remediation disposition

**Implemented on review branch, pending CI:** reject `foreign_table` in `assertValidRuntimePrivilegeContract` before SQL/provisioning and add four negative/positive unit cases in `tests/architecture/platform-runtime-contract-relation-kinds.test.ts`. No production grants, migrations, secrets, roles or environments are touched.

**Not changed:** R26 `0055` remains a proposal outside migrations; F-012 requires an architectural acceptance; real Redis/S3 ACLs, production IdP wiring and worker credential separation require specialist evidence. No tests are weakened or removed. `pnpm-lock.yaml` is unchanged because an audited dependency-resolution environment was unavailable.

## 5. API / component coverage matrix

| Surface | Assessed | Remaining proof required |
| --- | --- | --- |
| Platform reference route and scope executor | Selected implementation and preexisting tests read | Cross-role/tenant negative HTTP probes on exact new SHA |
| Legacy CMS publication/auth/admin | Existing F-001–F-014 review and API main inspected; full routes not independently exhausted | Full BOLA, mass assignment, staff role-ceiling, CSRF, CORS, session revocation matrix |
| Studio/Lexical/Yjs | Compatibility fixture report and separate Studio security-test directory found | Cross-publication websocket room, document key, replay and permission revocation tests |
| Plugin + worker + webhooks | Legacy DB grant and Redis sharing confirmed | Untrusted plugin isolation, SSRF, signature/replay, queue scope, idempotency and worker impersonation |
| Files/media/S3/backups | Previous report describes magic-byte/size checks | Restricted-bucket deny matrix; object-key traversal, signed URL and backup segregation |
| Dependency/build | Lock Fastify version and GHSA checked; CI status queried | Full SBOM/SCA, exact artifact provenance, conditional advisory reachability |
| R35/R26 | Selected code and SQL proposals read; R35 view test source read | Foreign-table test CI, non-runtime view access audit; production-shaped R26 Scope A+B regression |

## 6. Sources researched (accessed 2026-11-16)

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), accessed 2026-11-16.
- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/), accessed 2026-11-16.
- [PostgreSQL 16 RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) and [CREATE FUNCTION](https://www.postgresql.org/docs/16/sql-createfunction.html), accessed 2026-11-16.
- [PostgreSQL CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html), accessed 2026-11-16.
- [Fastify security advisory GHSA-3qgw-9275-xf8w](https://github.com/fastify/fastify/security/advisories/GHSA-3qgw-9275-xf8w), published 2026-11-02; [OSV CVE-2026-120216](https://osv.dev/vulnerability/CVE-2026-120216), accessed 2026-11-16.
- [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final), published 2022-02; [GitHub dependency review documentation](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action), accessed 2026-11-16.

## 7. Release recommendation

**BLOCKED.** No independent dynamic verification, AppSec human sign-off or Agent 06 concurrence; R26, F-012, W1-T06, W1-T07 and owner-role/backup gates remain open. Do not merge a release or expand tenant hosting based on this assessment. Re-test all code changes at the final release SHA.
