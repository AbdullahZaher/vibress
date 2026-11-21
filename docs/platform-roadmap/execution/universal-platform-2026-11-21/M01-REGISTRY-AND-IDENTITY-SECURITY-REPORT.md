# M01 — Registry and Identity Security Report

**Scope:** E03 registry persistence, E07 installation authority, E08 authenticated context, E10 physical isolation.

## Registry (E03)

- Existing persistent registry behavior in `apps/platform-reference/src/registration.ts` and `packages/database/migrations/0056/0057/0058` is reused; no migration was edited.
- `InMemoryApplicationRegistry` in `packages/platform-kernel/src/registry.ts` enforces duplicate application refusal and module/kernel version compatibility (`isCompatibleKernel`).
- New lifecycle contract adds compare-and-swap revision guards and manifest/schema digest binding so stale operators cannot overwrite newer state.

## Identity (E01/E08)

- `pub_default` is rejected by `parseIdentifier` for all platform identities; only `asPublicationId` (CMS compatibility adapter) accepts it.
- New `WorkspaceId` is branded and follows the same fail-closed rules.
- `packages/tenancy/src/scope.ts` requires server-verified principal, membership, application and tenant agreement; this remains a dependency for M02 live identity.

## Installation isolation (E07/E10) — real disposable evidence

`scripts/platform/m01/installation-isolation-drill.sh` (requires `VIBRESS_M01_DRILL_CONFIRM=1`) ran on disposable PG16 + Redis 7 containers with unique names/ports and cleanup trap:

| Assertion | Result |
|---|---|
| Installation A reads its own secret | PASS `A_SECRET` |
| Installation B reads its own secret | PASS `B_SECRET` |
| A reading B's schema | PASS — `permission denied` |
| Role A has no superuser/CREATEDB/CREATEROLE | PASS `f|f|f` |
| Role B has no superuser/CREATEDB/CREATEROLE | PASS `f|f|f` |
| Redis db1 cannot read db0 key | PASS empty |
| Redis db0 cannot read db1 key | PASS empty |

This is a bounded nonproduction authorization-denial drill. It does **not** claim OS-level process isolation, S3 IAM separation, backup isolation or production hosting authorization.

## Negative boundary enforcement

- `tests/architecture/m01-external-consumer-negative.test.ts` refuses private workspace paths, `@vibress/database`, `@vibress/config`, direct Fastify and relative sibling imports in an external consumer.
- `m00-boundary-contract.test.ts` and `platform-boundaries.test.ts` enforce kernel/plugin dependency rules and dependency cycles.

## Remaining security dependencies

- Non-superuser deployment owner, R26/R35/F-012 decisions and live IdP are M02/Wave 1 gates.
- No privileged SQL, role change or credential was applied to any shared/production database.
