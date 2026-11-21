# M02 — SQL / S3 / Queue Tenant Offboarding

**Status:** NOT EXECUTED; functional M02-E11 remains OPEN.

The existing `packages/tenancy/src/lifecycle.ts` contains manifest, retention and legal-hold contracts, and fixes `backupErasureClaim = "NOT_CLAIMED"`. No live SQL export/deletion, S3 inventory/delete, queue drain/delete, audit reconciliation or restore has been performed in this new cycle.

The additive receipt ledger in [draft PR #217](https://github.com/AbdullahZaher/vibress/pull/217) intentionally adds **RESTRICT** foreign keys against tenant and installation deletion. This fails closed: a tenant with retained receipts cannot be dropped until a separately reviewed replay retention policy, durable tombstone and in-flight Worker barrier exist. It does **not** implement offboarding.

| Surface / safety requirement | Result |
|---|---|
| Authorized request, server-verified principal and lifecycle record | NOT EXECUTED |
| SQL export and manifest reconciliation | NOT EXECUTED |
| S3 object inventory/export and per-tenant ACL | NOT EXECUTED |
| BullMQ queued/active/delayed/dead-letter job inventory | NOT EXECUTED |
| Approved retention, legal hold and backup references | NOT EXECUTED |
| Actual SQL/S3/queue deletion with durable progress journal | NOT EXECUTED |
| Partial SQL or S3 failure and idempotent recovery | NOT EXECUTED |
| Cross-installation/cross-tenant deletion denial | NOT EXECUTED |
| In-flight Worker/late replay resurrection prevention | NOT EXECUTED |
| Final audit events and deletion-verification manifest | NOT EXECUTED |

**Backup erasure:** `NOT_CLAIMED`. Live-store deletion must be distinguished from backups retained under operator policy. No destructive migration, forced cleanup, privileged grant, or real tenant deletion was performed.

**Decision:** BLOCKED. Safe deletion requires real disposable SQL/S3/BullMQ tests and authorized governance.
