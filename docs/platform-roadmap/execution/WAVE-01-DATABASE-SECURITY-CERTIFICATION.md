# Wave 01 — Database Security Certification (Agent 02)

**Assessment type:** AI-assisted technical assessment, NOT human DB-owner approval or independent Agent 06 certification.  
**Date:** 2026-11-16 (Asia/Riyadh)  
**Repository:** `AbdullahZaher/vibress`; **PR:** #166  
**Pinned reviewed source SHA:** `a96ea073767e303b02121d87558adbd12ce111f3`  
**Reviewed baseline:** `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`  
**Environment:** GitHub source and GitHub Actions read-only inspection; no database access from this auditor's runtime.  
**Verdict:** **BLOCKED / NO-GO recommendation**. Neither production readiness nor successful live SQL denial is certified.

## Evidence classification

- **Directly verified:** exact PR head and source files via GitHub connector; live GitHub Actions run 43755004357 associated with this SHA has jobs `build`, `e2e`, and `container-scan` all successful. This is CI metadata, **not** DBA runtime certification.
- **Repository-recorded, not independently rerun:** R26 fixture 33 public functions (31 pg_trgm extension-owned, two trigger functions), PUBLIC EXECUTE on 33, 0 SECURITY DEFINER, 0 default ACL entries, measured on PostgreSQL 16.15; isolated R26 proposal 4/4; tenant-isolation, cross-installation and R35 harness passes. These results are from prior project reports and test code, not direct observations from this assessment.
- **Unverified:** production PostgreSQL server version; actual role ACL/inheritance graph; production backups and restore rehearsal; live tenant and installation isolation; migrations on a production-shaped non-superuser owner; scope B compatibility; worker-provisioner role separation; extension upgrade after R26; independent security approvals.
- **Execution limitation:** No PostgreSQL client/server, running disposable PG16 database, or approved deployment database was accessible in the current runtime; no SQL was executed. The read-only collection script `R26-ROLE-PRIVILEGE-READONLY-AUDIT.sql` is prepared, **not executed**.

## Findings

| ID | Severity / impact / exploitability | Concrete source evidence | Required remediation | Owner / deadline / verification |
| --- | --- | --- | --- | --- |
| DB-01 | **HIGH release gate (conditional)**: PG16.15 is below PG16.16, which fixes multiple 2026-11-12 vulnerabilities including RLS disclosure CVE-2026-120154 and RLS-policy alteration CVE-2026-116311; exploitability depends on production version/permissions | R26 reports fixture PostgreSQL 16.15; `compose.prod.yml` uses rolling `postgres:16-alpine`, not a pinned 16.16 digest. No production version inventory | Record `server_version_num` and image digest; require patched PG16.16+ within the 16.x line before any certification; update images in reviewed deployment change, check index/extension release notes | DBA+SRE, before next GO decision, actual server query + immutable image digest + negative tests |
| DB-02 | **HIGH gate / medium current exploitability**: unreviewed PUBLIC function EXECUTE defaults may expose later privileged routines | `R26-FUNCTION-EXECUTE-INVENTORY.md`: 33 PUBLIC functions, no current SECURITY DEFINER; 0055 lives under docs and is unapplied | Approve/rehearse Scope A with effective ACL and extension regression proof; migrate via controlled process only | DB owner+AppSec with Agent 06 concurrence, before release, SQLSTATE 42501 and inventory |
| DB-03 | **HIGH latent impact**: legacy runtime blanket function and relation privileges; weak blast-radius containment if runtime compromised | `packages/database/src/runtime-role.ts`: `GRANT EXECUTE ON ALL FUNCTIONS`, future function grant, `CREATE` public, blanket DML; `migrate.ts` reprovisions on each run | Scope B code + SQL companion to shrink explicit and inherited privileges, enumerate approved plugin needs, test migration rerun | DB architect+AppSec, before release, real-role negative matrix and CMS regression |
| DB-04 | **HIGH architecture**: superuser bootstrap/owner in deployment topology defeats owner separation assurance | `compose.prod.yml`: `POSTGRES_USER` bootstraps PostgreSQL and migrate service uses the same credential; fixture tests have separate isolated non-superuser owner | Introduce separate admin, migration owner, provisioner, runtime identities; refuse superuser migrations; demonstrate FORCE RLS as non-superuser | DBA+SRE, before GO, actual session role/ownership audit |
| DB-05 | **HIGH under shared tenancy**: CMS tables lack RLS, so compromised CMS credential can access more than intended publication boundary | `F-012-CMS-RLS-DECISION.md` proposes A/B and marks unapproved; `0054` enables FORCE RLS only on `platform_crm_customers` | F-012 owner chooses A (RLS) or strictly bounded single-installation B with explicit expiring risk acceptance. Scope A exact CMS table inventory comes from catalog before design | AppSec+DB owner+Agent 06, before release, table/RLS matrix or approved B restrictions |
| DB-06 | **HIGH boundary**: API and worker share `&app-environment` DB identity; registry writer still uses owner | `compose.prod.yml`; `platform-application-registry.ts` operator writes and role provisioning code | Design separately credentialed worker, registry provisioner, verifier, directory reader | DBA+SRE, before GO, denial across actual connections |
| DB-07 | **MEDIUM assurance gap**: several integration tests manipulate a configured dev DB rather than one test-owned disposable database | `platform-tenant-isolation.test.ts` provisions roles and inserts/deletes fixtures on `DATABASE_URL`; `platform-production-topology.test.ts` invokes `DROP OWNED` | Make hardening suites target explicit disposable DB only, forbid shared URLs; run on patched PG16; verify teardown | QA+DBA, before evidence acceptance, tests + cleanup catalog query |
| DB-08 | **MEDIUM operational**: default ACL and extension/SECURITY DEFINER security must be checked after owner-created objects and extensions change | Inventory records only public schema and one fixture owner; R26 Scope A globally changes future default privilege for one creator | Expand read-only full-namespace/current-owner catalog audit, effective grants/role memberships, search_path and extension compatibility | DBA, every migration/release, attached read-only audit and per-role call tests |

The severities above are **release risk classifications**, not proof each issue is actively exploitable in production. Do not assign invented CVSS to application-specific gaps.

## Technical observations

1. `0054_platform_tenant_rls.sql` uses `ENABLE` and `FORCE ROW LEVEL SECURITY` on `platform_crm_customers` with both application and tenant transaction-local GUCs. This is a sound narrow proof, **not** CMS-wide isolation.
2. `TenantUnitOfWork` uses transaction-local `set_config(..., true)`, refuses detectable scope/role mutation, checks identity before COMMIT, destroys uncertain pooled connections. It explicitly does **not** sandbox malicious raw SQL; table permissions and database patch level are essential.
3. `platform-runtime-role.ts` validates current and session identities, membership, effective table/column/sequence/function privileges, `SECURITY DEFINER`, `security_invoker` views, and excludes materialized views. Foreign tables remain a non-RLS surface.
4. Registry mutation and audit share data-modifying CTE statements; installation update uses a compare-and-swap expected state. Code shape is observed; concurrent failure tests and rollback are **not reproduced in this review**.
5. `0055` remains outside migration directory and journal. **Do not move, apply, or backfill the shared migration journal** without the release process.
6. The 2026-11-12 PostgreSQL 16.16 update requires patch testing and review of indexes/extensions. Until the deployed server version is checked, vulnerability applicability is conditional.

## Required test matrix (all must be rerun on the exact release artifact)

| Scenario | Expected evidence | This assessment |
| --- | --- | --- |
| R26 Scope A PUBLIC + default ACL denial | Catalog effective grants; `42501` in independent runtime session; extension similarity still works | **BLOCKED** |
| R26 Scope B explicit/inherited denial and migration replay | `42501` on nonallowlisted calls after fresh `runMigrations` | **BLOCKED** |
| Non-superuser FORCE RLS / tenant A vs B | A reads own, zero cross-tenant; unauthorized INSERT `42501`; `row_security=off` `42501` | **BLOCKED** |
| Two installations / cross-role access | Cross-database login `42501`, no shared database or privileged service credentials | **BLOCKED** |
| security_invoker views, no materialized views | Runtime boot deny for unauthorized views; policy-preserving positive case | Prior fixture tests only |
| CAS / concurrent registry + installation updates | Exactly one authorized CAS winner and immutable audit; loser no mutation | Prior source/tests only |
| Failure/COMMIT/ROLLBACK and pooled reuse | Rollback-only, unknown outcome connection destroyed, next checkout clean | Prior source/tests only |
| Restore and forward-fix | Verified snapshot/PITR, isolated restore, RPO/RTO, timed recovery, extension check | **BLOCKED** |
| Migration replay (0054, 0056–0058; 0055 reserved) | Clean database journal, checksums, LOCK evidence, migration owner and rollback/forward-fix | **BLOCKED** |
| CMS Option A/B | Exact table census and RLS/policy or signed bounded Option B decision | **BLOCKED** |

## Release gates

**BLOCKED** pending: exact PostgreSQL 16.16+ confirmation; R26 A/B authorization and repeatable real-role tests; F-012 disposition; non-superuser owner; distinct worker/provisioner roles; verified restore; Agent 03 and Agent 06 verdicts; owner decision. No accepted High risk is recorded here.

**Recommendation:** NO-GO. The fact that GitHub CI is green does not close deployment, privilege, isolation, or authorization gates.

## Sources (accessed 2026-11-16)

- PostgreSQL 16.16 official release, published 2026-11-12: https://www.postgresql.org/docs/16/release-16-16.html
- PostgreSQL security advisory CVE-2026-120154, published 2026-11-12: https://www.postgresql.org/support/security/CVE-2026-120154/
- CVE-2026-116311, 2026-11-12: https://www.postgresql.org/support/security/CVE-2026-116311/
- CVE-2026-6460, 2026-11-12: https://www.postgresql.org/support/security/CVE-2026-6460/
- PostgreSQL 16 privileges: https://www.postgresql.org/docs/16/ddl-priv.html
- PostgreSQL 16 RLS: https://www.postgresql.org/docs/16/ddl-rowsecurity.html
- PostgreSQL role memberships: https://www.postgresql.org/docs/16/role-membership.html
- GitHub PR #166 pinned SHA: https://github.com/AbdullahZaher/vibress/commit/a96ea073767e303b02121d87558adbd12ce111f3
- Exact-head CI run: https://github.com/AbdullahZaher/vibress/actions/runs/43755004357

## Audit entry

**2026-11-16:** Read-only source and GitHub CI audit conducted. No DB change, migration, secret access, destructive action, approval, or release authorization. Results are blocked where real PostgreSQL evidence is missing. This document is a technical recommendation, not a human signature.
