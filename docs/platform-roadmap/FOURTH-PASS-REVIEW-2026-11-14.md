# Fourth-Pass PR #151 Review — 2026-11-14

> **Documentation review only, not a penetration test, runtime fix or release approval.** This report follows [R01–R16](REVIEW-FINDINGS-2026-11-14.md), [R17–R25](SECOND-REVIEW-AND-SCORECARD-2026-11-14.md) and [R26–R34](THIRD-REVIEW-AND-RATING-2026-11-14.md). **The earlier roadmap-quality score of 8.0/10 remains provisional and unchanged; it does not rate deployed code.**

## Review process

Re-examined the open Draft [PR #151](https://github.com/AbdullahZaher/vibress/pull/151), M00–M12 milestone files and GitHub issues #152–#164, [nested transaction implementation](../../packages/database/src/transaction/transaction-runner.ts), [Content Modeler](../../packages/domains/content-modeler/src/application/content-modeler-service.ts), and current PostgreSQL [CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html) / [RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) documentation. All **140 existing Epic IDs** in milestone specs were checked against their corresponding issue: no missing or orphan IDs were found. This check is **manual/static**, not a passing automated CI gate.

## Newly identified findings

| ID | Priority | Specific issue | Required design correction | Evidence gate |
| --- | --- | --- | --- | --- |
| **R35** | **High — security** | Ordinary PostgreSQL **views** access underlying tables with the **view owner's** rights and RLS policies by default, not necessarily those of the invoking user. PostgreSQL 15+ supports `security_invoker=true`; owner-owned views or materialized report copies can defeat the assumption that querying through a view uses the caller's tenant policy. | [Views and RLS test contract](RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md), map to M02-E09/E13, M04-E08/E10 and M08-E11. Prohibit tenant-owned views in v1 if safe behavior is not certified. | Multi-tenant ordinary/invoker view and snapshot/export denial tests on actual supported PG versions. |
| **R36** | **High — data integrity** | Logical dumps/exports taken under RLS-filtered roles can omit rows; PostgreSQL `row_security=off` is **not a policy bypass** but signals an error if filtering would apply. The roadmap lacks a precise **complete-backup principal, scope manifest and restore row reconciliation**. | [Backup and RLS contract](RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md), M08-E04/M08-E11 and M11-E10. | Full-installation A+B row counts/checksums, backup role ACL, encrypted snapshot and restore; partial backups rejected or explicitly marked tenant-only. |
| **R37** | **High — consistency** | Current `runInTransaction()` reuses an outer transaction for nested calls and explicitly **does not create savepoints**. The proposed tenant UoW does not define nested error handling and rollback-only behavior; a caught inner application error can otherwise permit the outer operation to commit earlier writes. | [Transaction contract](RLS-VIEWS-BACKUP-AND-TRANSACTIONS.md), M02-E08 and M06-E01/E08. | Caught inner error, wrong tenant nested scope, SQL-aborted transaction, outbox consistency, retry and outer rollback tests. |
| **R38** | **High — legacy migration** | The architecture rejects `Publication` as the universal app identity but lacks a concrete **multi-publication CMS → Application/Installation/Tenant mapping**, with `pub_default`, media, Studio documents, memberships, URLs and delayed jobs. | [Legacy CMS identity migration contract](LEGACY-CMS-IDENTITY-AND-MIGRATION.md), M00-E04, M01-E05, M03-E09 and M08-E02. | Seeded multi-publication CMS upgrade plus independent CRM install, compatibility fixtures, checksum and rollback/forward-fix evidence. |
| **R39** | **Medium — feasibility** | 140 Epics and 146 unchecked acceptance criteria are not an executable priority plan by themselves. More review-only Epics risk obscuring a first proven release slice. | [Execution-first priority and owner handoff](EXECUTION-FIRST-SLICE.md). **Use existing Epic IDs**, define P0 design/P0 GA vs later scope; assign actual owners after approval. | First executable proof, explicit stop/go, owner and real capacity estimate, issue→PR→test evidence. |

## Release-blocking sequence

1. **M00:** approve topology/identity ADRs and review the tenant transaction spike; inventory CMS migration scope and effective PostgreSQL privileges/views.
2. **M01/M02:** demo isolated Task/CRM, prove transaction/RLS/views/roles and physical per-installation access boundaries as the actual runtime identity.
3. **M03/M04:** develop CRM resources, generated API/Admin and custom business HTTP/UI under scoped authorization; no CMS-domain dependency.
4. **M05–M07:** trusted module + packaged SDK, versioned event/job and external clean install.
5. **M08:** real CMS multi-publication upgrade fixture, full RLS-safe backup/restore, mixed-version deployment test, independent audit and explicit GO/NO-GO.

**Evidence caveat:** no database, backup, build, Studio E2E or penetration test was executed in this review. Documentation improvements do **not** remediate production code. PR #151 should remain **Draft** pending owner review and actual CI.

## Official references

- PostgreSQL [CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html) — default view-owner context and optional invoker context.
- PostgreSQL [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — `row_security=off` is a guard for potentially filtered dumps, not a bypass.
- Vibress [transaction runner](../../packages/database/src/transaction/transaction-runner.ts) — no nested savepoints.
