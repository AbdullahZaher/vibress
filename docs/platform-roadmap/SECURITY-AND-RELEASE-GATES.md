# Security, Compatibility, Reliability and Release Gates

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

## Cross-cutting P0 invariants

1. App A cannot access App B data; tenant T1 cannot access T2 via any API, worker, storage, cache, export, admin route or link.
2. No client-controlled publication/tenant/app selector can grant authorization; identity and membership are resolved on server.
3. Supported shared-Postgres tenant tables use reviewed RLS policies; same transaction/connection `SET LOCAL`, nonowner/non-BYPASSRLS roles and `FORCE ROW LEVEL SECURITY` where needed; fail closed without tenant context.
4. API/worker DML credentials cannot perform broad DDL; migration and plugin physical-storage provisioning have separate roles and approvals.
5. Generated API fields and relationships enforce read and write scopes at runtime; UI hiding is insufficient.
6. Webhook signatures and duplicate events are handled with durable inbox/idempotent effects; outbox writes commit atomically with state changes.
7. Plugin trust is explicit; signed in-process Node code is privileged trusted code, not safe for untrusted marketplace execution.
8. Secrets are scoped, encrypted, redacted, rotated and never embedded in browser; outgoing URL/upload operations apply SSRF, type, size and integrity controls.
9. HTTPS/TLS edge, origin/CSRF, cookies, rate limiting and HSTS must be verified in real deployed staging.
10. Restore, schema migration, previous-version app/Studio fixture and independent security checks precede GA.

## Required evidence suite

| Gate | Verification |
| --- | --- |
| Application and tenant isolation | two-app/two-tenant integration + HTTP/worker negative tests |
| Database roles and RLS | direct nonowner Postgres connection tests, pool reuse, transaction isolation |
| Generated API | unauthorized row/field/relation/search/export tests and bounded query budgets |
| Plugins | untrusted payload denial, tampered SHA, signer/capability mismatch, crash recovery |
| Event reliability | duplicate webhook, queue reconnect, worker crash and end-state assertions |
| Backward compatibility | pinned CMS/Studio document, billing, media, publication and migration tests |
| Release quality | SAST, dependency/image scan, SBOM, CI URLs, independent review, real backup restore |

## Baseline disclaimer

The [2026-11-13 Vibress Security Review](../../SECURITY-REVIEW.md) recommends **conditional launch**, records disabled RLS, incomplete external staging/edge verification and no independent penetration test. [Studio readiness](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/production-readiness.md) likewise does not certify production. This roadmap must not be presented as remediation already executed.

## GA acceptance

No known unresolved Critical/High findings inside the independently audited scope; if not satisfied, block GA. Benchmark results and recovery measurements include exact release SHAs, environment, fixture, p50/p95/p99, measured RPO/RTO and limitations. Explicit approved final release decision is necessary.
