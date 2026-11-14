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


## Security review correction: stricter scoped execution gates

**G0 (before new runtime work):** ADR for **application-per-installation v1 topology**, trusted principal/tenant model, database role boundary and CMS compatibility signed by owners. Prototypes remain isolated until G1 passes.

**G1 (before public tenant data):** Under actual Postgres and normal runtime credentials, demonstrate server-verified app+tenant context; transaction-local session setting on the **same** connection; fail closed without context; block every tenant-owned query via generic `getDb()`; reject tenant switches in nested transactions; test pool reuse and long-lived workers. Use `USING`/`WITH CHECK`, app+tenant identity and composite constraints. Session variables are **defense-in-depth, not authentication** for arbitrary SQL-capable code.

**G2 (before code generation/CLI use beyond staging):** Validate canonical schema input, allowed identifiers/types, generated SQL ownership, migration preview/approval and installer isolation. Deny arbitrary DDL and unsafe default expressions; test relation/filter/aggregate/count/search/export side channels and SSR cache keys.

**G3 (before extensions):** Public Plugin SDK compatibility evidence; signed immutable trusted release checks; no untrusted in-process module. Separate plugin provisioner/owner from HTTP runtime, with audited grant migrations.

**G4 (before GA):** CMS+CRM Golden Apps, reproducible external clean install, cross-repo Studio fixtures, authenticated staging, restore rehearsal, independent security assessment and explicit approval. No automatic certification and no arbitrary zero-loss downgrade claim.

See [DB/RLS authority](DATA-ISOLATION-AND-MIGRATIONS.md), [architecture decisions](ARCHITECTURE-DECISION-GATES.md), and [v1 mandatory scope](V1-SCOPE-AND-RELEASE-CRITERIA.md).

## Additional negative tests

- Generated data: bulk mutations, aggregation/count/filter side channels, nested relation traversal, privileged field projections, unbounded sorting/pagination, SSR/service cache leakage.
- RLS and privileges: app A/B deployments, tenant X/Y, missing context, attempted client context spoof, nested transaction identity switch, SQL injection/raw access path, pool reuse, owner/BYPASSRLS tests, unauthorized `CREATE` and unsafe function execution.
- Migrations: malicious model/default, namespace collision, checksum drift, concurrent deployment race, partial backfill, timeout and documented forward-fix.
- AI/cloud: cross-app tool delegation, prompt-injection source, stale approval, secrets exposure, tenant misrouting, quota/runaway costs and deployment identity escalation.

**Release condition:** The v1 release candidate may be rejected by reviewers. Record accepted audit scope, owner, immutable artifact digest, exceptions, observed RPO/RTO and support limits. A passing CI run is insufficient.
