# PostgreSQL Views, RLS-safe Backups & Nested Transaction Contract

> **Proposed design/acceptance tests only. No running migration or security remediation is performed by this document.** Pin supported PostgreSQL major versions before implementing any of the contracts below.

## 1. View ownership and row security

By default, PostgreSQL views evaluate their underlying table access and RLS policies with the **view owner's privileges**, not the original caller's. PostgreSQL 15+ supports `security_invoker = true` for views; its behavior must be tested with the exact server version and role graph. `security_barrier` addresses a **different** concern (filter ordering/side-channel safety) and must not be confused with invoker privileges. See official [CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html), [RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) and [rules/privileges](https://www.postgresql.org/docs/current/rules-privileges.html) references.

**Safe v1 choice:** generated resource SQL views and materialized views are **unsupported unless** scoped-owner/role and tenant-negative tests pass. Inventory any trusted *existing* CMS views separately; do not forbid unrelated legacy views without compatibility analysis.

If an app legitimately supports them, require:
- Explicit owner, `security_invoker` setting where supported, scoped `SELECT`, `USING`/`WITH CHECK` policy expectations, secure functions called by the view, and permitted caller roles.
- Tests for a default owner-context view, an invoker-context view and (if supported) a materialized report/snapshot created from tenant rows. **Materialized data is a new object and is not dynamically filtered by its source table's RLS simply because its original SELECT used RLS.**
- Query paths through REST list/detail, relation traversal, counts, exports, analytics, admin reports and trusted workers, not just direct table SELECT.
- On supported PG versions lacking `security_invoker`, decline this feature for tenant-owned resources unless an independently reviewed alternative is demonstrated.

**Reject:** exposing another tenant's row through an owner-owned view, materialized snapshot or privileged function; declare a product-scope limitation if tests cannot be passed.

## 2. RLS-safe backup scope and restoration

A query made with a tenant-scoped runtime account may retrieve **only the rows it can see**. PostgreSQL `row_security=off` is a *filtering alarm*: it errors when RLS would filter data; it **does not grant bypass privileges**. Differentiate complete-installation backup from an authorized tenant-only export.

- Identify an explicitly audited **backup identity**, separate from app request/worker, DDL provisioner and tenant user. Record privileges, RLS behavior, encryption/key ownership and schedules.
- Backup manifest includes installation, schema/migration epoch, table/object inventory, row counts and/or stable checksums by tenant, storage objects, event queue/offset policy, snapshot ID, encryption and retention.
- Full-backup run must either contain all intended installation rows or **fail closed**. A tenant-only extract is labeled tenant-scoped and is not advertised as complete.
- Restore to an isolated staging installation with tenant A+B fixture and independently reconcile data counts, representative values, media references, role/policy behavior, outbox/job redelivery and the supported RPO/RTO.
- Document which encrypted backups are immutable and how deletion obligations/retention are handled; do not promise immediate per-record erasure from expired or retained snapshots.

**Negative test:** deliberately perform a full-database export under tenant-only credentials and confirm failure or clearly restricted scope; complete backup + restore must reproduce both tenants and prevent cross-tenant reads afterward.

## 3. Nested application transaction semantics

The current [`runInTransaction()`](../../packages/database/src/transaction/transaction-runner.ts) **reuses the active transaction** on nested calls, with **no savepoints**. The proposed [scoped tenant unit-of-work](DATA-ISOLATION-AND-MIGRATIONS.md) must not promise recoverable nested partial rollback by default.

Choose and document one consistent policy:
1. An inner action may reuse the parent only with the **same verified principal/application/tenant/authorization scope** and transaction handle; nested scope changes are rejected.
2. By default, **any nested operation failure marks the outer unit rollback-only** even when a callback catches the error. If partial recovery is genuinely required, design explicit savepoints, prove correct scope behavior, and test them as a separate feature.
3. No event/outbox record may commit independently from its associated business state. External nontransactional side effects use outbox, idempotency or explicit compensations, not an assumption of SQL rollback.
4. Retrying after failure opens a new authorized transaction with a stable idempotency boundary; no recycled connection/session scope or stale authorization is reused.

**Failure tests:** caught inner application error, caught inner SQL error, mismatched nested tenant, aborted PG transaction, rollback-only commit attempt, duplicate worker delivery, and event/outbox atomicity. Acceptance must describe observed durable state, not merely successful exception handling.

## Existing work mapping

- **M02-E08/E09/E13:** verified scope, nested transaction/roles, views/RLS policy composition.
- **M04-E08/E10:** API, report, export and generated-view authorization.
- **M06-E01/E08:** atomic business actions, nested failure semantics and durable outbox.
- **M08-E04/E11/E12:** complete RLS-safe backups, restore and scoped releases.
- **M11-E10:** managed-installation backup role/retention.
- **No milestone or security check is complete just because this document exists.**
