# M02 — Concurrent API and Worker Authorization

**Status:** NOT EXECUTED against live concurrent API/Worker/PostgreSQL processes.

Baseline source review confirmed `packages/tenancy/src/executor.ts`, `scope.ts`, `authorization.ts`, `unit-of-work.ts`, and the existing CMS API's raw `x-tenant-id` stripping. These are contract/enforcement-path observations, **not a multi-installation integration certificate**.

Draft [PR #217](https://github.com/AbdullahZaher/vibress/pull/217) requires an explicit `assertCurrentAuthority(tx, envelope)` in the same PostgreSQL transaction before the effect. The existing membership reader is a separate read-only role and the required membership/revocation lock/epoch ordering is **not yet integrated**. Treat concurrent revocation as unresolved.

| Mandatory probe | Result |
|---|---|
| Concurrent tenants/installations and distinct API principals | NOT EXECUTED |
| Shared pool reuse after rollback; no GUC leakage | NOT EXECUTED |
| Nested principal switch under real request overlap | NOT EXECUTED |
| Async context across awaits | NOT EXECUTED |
| Worker execution concurrent with membership revocation | NOT EXECUTED |
| Role-cache change and stale membership version | NOT EXECUTED |
| Retry after authorization change | NOT EXECUTED |
| API -> outbox -> worker with tenant/installation identity | NOT EXECUTED |
| Multiple Worker processes using independent DB roles | NOT EXECUTED |
| Field denial, rule precedence, forged queue scope negatives | NOT EXECUTED |

No M04 generated REST/Admin runtime was activated. No caller-controlled installation/tenant header may be treated as authority. **No unauthorized effect may commit** remains an acceptance requirement, not a proven result for this slice.

**Decision:** BLOCKED pending actual API/Worker integration, RLS/ACL and IAM race tests.
