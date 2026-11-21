# M02 — Atomic Worker SQL Receipts: Engineering Slice

**Status:** IMPLEMENTED_IN_DRAFT / NOT EXECUTED / NOT ACCEPTED
**Prepared by:** Agent 01 (implementer, not independent auditor)
**Baseline:** `6326a37a8e34315358ea37f1ee75bfaf4523329a` / tree `a82e7fbe0b099ed3f0d4d3b3315ecee3cf49456d`
**Draft PR:** [#217](https://github.com/AbdullahZaher/vibress/pull/217)
**Initial code candidate:** `f97dd350c7ae9cb69f69b16e72ee34b8af503941` / tree `5bb3fadd3df08931df887a74fcc093efd9066ee1`

## Implemented but unactivated

- `packages/tenancy/src/atomic-worker-effect.ts` adds `runAtomicWorkerSqlEffect`. It verifies signed installation/application binding, matches a server-verified application/tenant/principal scope, requires a transaction-bound current-authority callback, and executes a SQL-only protected effect after an atomic unique-index INSERT. It returns only after `TenantUnitOfWork.run` commits.
- `packages/tenancy/src/worker-envelope.ts` exposes a stable SHA-256 digest of the authenticated job type, schema revision, and payload.
- `packages/database/migrations/0059_platform_worker_effect_receipts.sql` and Drizzle schema add a receipt keyed by (installation, application, tenant, nonce), binding immutable principal/type/schema/digest. Composite installation/tenant FKs RESTRICT deletion; FORCE RLS defaults to denied unless trusted scoped context and explicit grants exist.
- No UPDATE or DELETE role grant, no generated API activation, no queue replacement, no change to migration 0061. The existing CMS/plugin job path is untouched.
- Unit tests are authored at `packages/tenancy/src/__tests__/atomic-worker-effect.test.ts` but **have not been executed** in this environment. Their transaction fixture is NOT PostgreSQL proof.

## Atomicity argument (pending real proof)

The receipt INSERT and protected SQL operation share one Unit of Work and one SQL transaction. A competing INSERT on the same unique key waits for the first transaction. Rollback removes both receipt and effect; committed receipt prevents retrying the effect; conflicting authenticated claims fail closed. An unknown COMMIT must not be blindly repeated with a new operation ID: BullMQ must retry the SAME signed operation and reconcile against the persisted receipt. This is **at-most-one committed SQL effect**, not exactly-once message delivery, not an external S3/HTTP/payment guarantee.

**Unsupported without further implementation:** the repository's reference runtime role currently has no receipt-table privileges; current-membership revocation cannot yet be proved transaction-atomic with existing read-only membership role; no real application Worker invokes the helper; the durable receipt-retention and tenant offboarding tombstone policy is not approved. No live atomicity claim is made.

## Required next safety gates

1. Regenerate/diff Drizzle migration and test the upgrade from an existing populated PostgreSQL 16 database. Test FORCE RLS and any separately authorized exact SELECT/INSERT role contract with the nonowner profile.
2. Wire the worker to an independently verified transaction-bound authorization/revocation fence; prove no stale authority and no cross-installation queue access.
3. Run independent BullMQ processes and all 20 crash/retry/identity fault scenarios with raw SQL/Redis evidence.
4. Resolve retention/tombstone/backup requirements before permitting deletion of receipt-bearing tenants.
5. Complete full milestone CI, AppSec/DBA/IAM/SRE/QA assessments, independent Agent 06 recertification, and human governance.

**No outcome represented in this document is a real runtime test result.**
