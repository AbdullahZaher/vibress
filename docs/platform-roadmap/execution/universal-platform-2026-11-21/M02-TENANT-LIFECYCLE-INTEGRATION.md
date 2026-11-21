# M02 — Tenant Lifecycle Integration

Existing contracts: `packages/tenancy/src/lifecycle.ts` (11 tests) enforce export manifests with deterministic digests, retention bounds, legal holds, required export for data-bearing surfaces and `backupErasureClaim = "NOT_CLAIMED"`. No backup erasure is claimed.

Actual SQL/S3/queue offboarding drill, deletion manifests and idempotent retry across real infrastructure remain **NOT EXECUTED**. This Epic is partially evidenced and must not be marked complete.
