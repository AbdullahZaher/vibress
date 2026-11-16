# Production PostgreSQL Role and Ownership Topology — Wave 1

**Date:** 2026-11-16; **Reviewed SHA:** `a96ea073767e303b02121d87558adbd12ce111f3`; **Status:** DESIGN / NOT DEPLOYED / NOT APPROVED.

## 1. Threat and deployment context

`compose.prod.yml` sets `POSTGRES_USER` (bootstrap superuser) and runs migrations through the same owner credentials, while API and worker share `POSTGRES_APP_USER` and one environment. Reference-platform serving uses three distinct roles, but worker and registry provisioner are not separated in deployed topology. This design is a **proposed** target and does not assert any permission has been changed.

## 2. Seven independently scoped identities

| Identity (illustrative name; NOT deployed) | Allowed work | Forbidden authority |
| --- | --- | --- |
| `vibress_db_admin` | Bootstrap/admin maintenance under explicit controlled runbooks, backup restore operations | Never exposed to app/worker/runtime; never permanently held in app environment |
| `vibress_migrator` | Non-superuser owner or tightly scoped DDL on reviewed application schemas, migrations with schema ownership | No LOGIN used by serving tier; no SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE; no unreviewed extensions |
| `vibress_registry_provisioner` | Exact CRUD on registry/installation tables and audit append through narrow operator code | No CMS/tenant DML, ALTER/DROP, broad grant authority, connection from serving tier |
| `vibress_platform_app` | Only contract-declared tenant-table DML under verified Unit of Work | No registry, membership, other tenant data, ownership, CREATE, TRUNCATE, REFERENCES, TRIGGER, arbitrary EXECUTE |
| `vibress_platform_reader` | Read `platform_memberships` for pre-scope verification | No mutation or tenant content data; no impersonation |
| `vibress_platform_verifier` | Read installation + application registrations for boot identity | No tenant/customer data and no mutation |
| `vibress_worker` | Only explicitly necessary job/outbox objects, separate DB role and secret per installation | No shared legacy API credential, registry owner, unscoped CMS all-table grants or runtime code execution privilege |

An eighth restricted `vibress_deploy_checker` role may be used for read-only operational catalog assertions if needed; it must not inherit owner/admin access. Role names are illustrative; actual principals and scope require operator assignment.

## 3. Binding and non-escalation

- All serving and worker logins: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, no `SET`-able membership; no inherited write owner role, no PUBLIC schema CREATE or database CREATE; scoped CONNECT only to installation database.
- Migration owner: separate `NOLOGIN` object owner where feasible with a time-bounded migrator executor able to assume only that owner during a controlled release; no runtime can assume it. Object ownership cannot be revoked with a normal GRANT, so role membership must be audited.
- Provisioner is a privileged **operator service**, not the interactive serving process. Review any extra DDL/GRANT authority separately; no implicit superuser or broad owner access.
- Break apart application and worker credentials and network/service-account identity. Secrets supplied out of band; never in reports, tests, logs or source. Explicit rotation and expiry plans.
- `REVOKE CONNECT ON DATABASE <installation_db> FROM PUBLIC` is necessary for a strong installation boundary, coupled with explicit CONNECT on required identities and negative cross-database logins. This needs planned change authority, not an unreviewed migration.
- PUBLIC default EXECUTE must be addressed per creating role and existing functions; R26 Scope A+B.
- `security_invoker=true` is mandatory for declared runtime views; reject materialized views until a separate security design. Foreign tables cannot be protected by standard PostgreSQL table RLS and need explicit isolated credentials and reviews.
- Separate PostgreSQL sessions for runtime/worker/reader/verifier; do not trust context if untrusted SQL can set `vibress.*` GUCs.

## 4. Bootstrap and release sequence (proposed only)

1. Verify PostgreSQL 16.16+ and immutable deploy digest; preserve current backup/WAL and demonstrate restore into isolated environment.
2. Create non-superuser migration owner, object ownership and required schemas with transaction/lock plan; inventory all existing owners, triggers, extensions, RLS and dependent objects.
3. Create separate tenant, reader, verifier, worker and registry-provisioner logins with secrets from vault, distinct identities per installation and no memberships. Verify catalog `rolsuper=false` etc.
4. Revoke public database CONNECT/CREATE where applicable; grant exact schema, table, column, sequence and function surface per identity. Reconcile existing default ACL and inherited grants.
5. Test startup guard (runtime privilege contract) and real negative matrix with `42501`. Repeat with two installations and post-migration reprovisioning.
6. Rollout with sampled transaction traces, RLS/authorization anomaly alerts, rollback triggers, and app/worker error-rate thresholds fixed **before** rollout.

## 5. Real PostgreSQL deny matrix

- Runtime A -> its tenant A: only expected rows; runtime A -> tenant B: 0 rows or `42501` for writes; no registry/membership access.
- Runtime A -> installation B: authentication/CONNECT rejected; owner A -> installation B: rejected; separate DB volumes and backups.
- Reader -> customer/registry: `42501`; reader -> memberships: SELECT succeeds, UPDATE `42501`.
- Verifier -> registrations/installations: SELECT succeeds, UPDATE `42501`; verifier -> tenant/worker data: `42501`.
- Worker -> API/tenant/registry tables outside named job contract: `42501`.
- Runtime/reader/verifier/worker -> `SET ROLE` owner/admin: `42501` or permission denied; no indirect membership path.
- Direct `PUBLIC` and inherited EXECUTE on owner routines: deny after R26; legitimate CMS triggers and approved extension functions still work.
- `row_security=off` and FORCE RLS on a non-superuser table owner: query denied `42501`.
- Pooled session with failed COMMIT / rollback and malformed scope: connection destroyed if state uncertain.

**None of this matrix was independently run in this assessment.**

## 6. R26 and F-012 interaction

**F-012 Option A:** enumerate all production CMS/publication content tables, map publication ownership and foreign keys, add RLS and verified-scope transaction routing, test CMS compatibility under non-superuser owner. Inventory candidates include the CMS tables named by the F-012 record (posts, pages, publication memberships, media, comments and related dependent tables); exact names, policy count and ownership must be obtained from the deployed catalog, not guessed.

**Option B:** legacy CMS remains application-isolated, so compromise of its broad SQL login can potentially read/write across publication boundaries inside its installation. Restrict B to self-hosted **single installation** with no external onboarding or public multi-tenant hosting, separate credentials and networks, SQL-injection protections and logs, risk-expiry and signed F-012 decision. Database-level cross-publication assurance **cannot** be claimed.

## 7. Recovery and evidence requirements

- Document verified base backup + WAL/PITR recovery, storage encryption/TLS, retention and off-host immutable copies; record actual RPO, RTO and restore transcript.
- Rehearse `0054`, `0056`–`0058` clean replay and failure recovery on PG16.16+; `0055` stays outside journal until separately authorized.
- Capture lock duration, transaction outcome, failed migration rollback, catalog drift, security alerting and post-release data-integrity smoke tests.
- Provide owner/Agent 03/Agent 06 signed verdicts; no auto-approval by this document.

## Sources (checked 2026-11-16)

- https://www.postgresql.org/docs/16/ddl-priv.html
- https://www.postgresql.org/docs/16/role-membership.html
- https://www.postgresql.org/docs/16/ddl-rowsecurity.html
- https://www.postgresql.org/docs/16/sql-alterdefaultprivileges.html
- https://www.postgresql.org/docs/16/release-16-16.html (2026-11-12)
- https://github.com/AbdullahZaher/vibress/blob/a96ea073767e303b02121d87558adbd12ce111f3/compose.prod.yml
- https://github.com/AbdullahZaher/vibress/blob/a96ea073767e303b02121d87558adbd12ce111f3/packages/database/src/platform-runtime-role.ts
