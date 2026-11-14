# Existing Vibress Assets — Reuse and Traceability

> **PROPOSED / NOT CERTIFIED** · 2026-11-14 · Based on `main` at `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`.
>
> Planning content only: existence of a document or issue does **not** mean code shipped or production was approved. New `M00–M12` IDs do not replace the existing Plugin Platform `M0–M6` roadmap.

The master roadmap must reuse *actual* existing work and preserve *historical* progress, without treating proposals as shipped features.

| Existing subsystem | New ownership / target | Caution |
| --- | --- | --- |
| Content Modeler and Drizzle relational schema | M01/M03 schema DSL and data adapter | currently publication-scoped; not universally app-owned |
| Users, roles and permission services | M02 policy and principal adapters | resource-level generated authorization still required |
| Publication isolation and composite FKs | M02 baseline compatibility | RLS not currently activated per security review |
| Plugin SDK, operator lockfile and signed release admission | M05 trusted module runtime | trusted ESM has Node process privileges |
| Plugin upgrade plans and preflight | M05 staged execution/restore | preparatory plan is not completed automated upgrade lifecycle |
| BullMQ and transactional outbox | M06 durable commands/jobs | must verify same transaction and idempotent effects |
| Billing, plans, subscriptions | M06 reusable entitlements/provider adapters | CMS member plans not all SaaS entitlements |
| Vibress Studio Lexical/renderer | M00 baseline + M09 reusable editor controls | Lexical content doc is not app visual layout schema |
| Docker Compose/API/Worker/observability | M08/M11 release & operations | cloud deployment/control plane not yet implemented |

## Code-first runtime finding (second review)

The current repository exposes Fastify routes and Next.js/React applications owned by the CMS host; the generic contract for a *third-party application* to register safe typed custom HTTP handlers, a user-facing web page and an authenticated transactional action is **proposed, not already implemented**. Its public SDK and clean-install/SSR security acceptance are tracked in [Application Runtime](APPLICATION-RUNTIME-AND-EXTENSIBILITY.md) and M01/M04/M07. Do not infer arbitrary application hosting from a collection CRUD generator alone.

## Additional validated source observations for R26–R34

- Current [runtime-role.ts](../../packages/database/src/runtime-role.ts) grants `EXECUTE ON ALL FUNCTIONS`; the role uses PostgreSQL's actual effective ACL, including PUBLIC and inherited privileges, not only direct role grants.
- [CI workflow](../../.github/workflows/ci.yml) checks code, dependencies and E2E but is **not** evidence that a dedicated roadmap link/ID/scope checker has been built; M00 owns that new work.
- [Connection pool](../../packages/database/src/connection.ts) and [ALS transaction context](../../packages/database/src/transaction/transaction-context.ts) expose different trusted data entry points; no tenant-safe security proof is claimed by current code.
- Redis namespaces and S3 prefixes are not access isolation absent restrictive credentials/ACL/IAM. The proposed application-per-installation topology requires explicit operational proof.
- Developers can author custom Node server code only as **trusted installation owners**. Framework contracts and GUC/RLS are not hostile-code sandbox boundaries. See [third review](THIRD-REVIEW-AND-RATING-2026-11-14.md).

## Current authoritative source documents

- [Existing architecture](../01-architecture/overview.md), [dependency rules](../01-architecture/dependency-rules.md).
- [Publishing implementation phases](../13-roadmap/implementation-phases.md).
- [Plugin platform v3 roadmap](../08-plugins/plugin-platform-master-roadmap-v3.md) and [execution ledger](../08-plugins/plugin-platform-master-execution-plan.md).
- [Plugin trust model](../14-decisions/plugin-trust-model.md).
- [Security review](../../SECURITY-REVIEW.md).
- [Studio readiness source](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/production-readiness.md).

This plan adds master milestones M00–M12; legacy Plugin Platform M0–M6 stays unchanged. PRs crossing repositories must pin both host and Studio candidate SHAs and validate real host persistence and rendering.


## Additional code findings affecting implementation sequencing

1. **Database transaction context:** [`getDb()`](../../packages/database/src/connection.ts) uses a pooled connection except within an [ALS transaction](../../packages/database/src/transaction/transaction-context.ts); a validated tenant-aware transaction port is **new work**. Do not treat existing Drizzle transactions as a complete RLS solution.
2. **Runtime privileges:** [`runtime-role.ts`](../../packages/database/src/runtime-role.ts) grants `CREATE` on `public` and `EXECUTE` on all functions there; a separate migration/plugin provisioner is required before general app isolation claims.
3. **Legacy model identity:** [Content Modeler](../../packages/domains/content-modeler/src/application/content-modeler-service.ts) defaults several operations to `pub_default`; new app schema must use a separate identity/adapter instead of a global publication fallback.
4. **Plugin distribution:** [`@vibress/plugin-sdk` package metadata](../../packages/plugin-sdk/package.json) has `private: true`; it cannot be described as an independently released package. Plugin Platform v3 also distinguishes package version from runtime SDK ABI.
5. **Plugin execution:** [`ExtensionHost`](../../packages/plugin-core/src/extension-host.ts) returns a synthetic hook result; independently evaluate or retire this route. [Trusted ESM host](../../packages/domains/plugins/src/application/trusted-external-plugin-host.ts) does load approved code but **does not isolate it from Node process privileges**.
6. **Legacy security report:** security review records a conditional launch and RLS disabled; keep this in the release register until new test evidence exists.

These are code-informed *review observations*, not a complete security audit or a statement that a vulnerability is exploitable without further tests.
