# M01 — Universal Application Kernel Engineering Implementation Report

**Branch:** `m01-external-consumer-continuation` (isolated from M00 closure)
**Scope:** E01–E10; reuse-first. No CMS rewrites, no production hosting, no private package publication.

## Implemented in this increment

| File | Behavior | Epic |
|---|---|---|
| `packages/platform-kernel/src/identity.ts` | Added branded `WorkspaceId` / `asWorkspaceId`; `pub_default` remains rejected for all platform identities | E01 |
| `packages/platform-kernel/src/lifecycle.ts` (new) | Pure application lifecycle state machine: REGISTERED→INSTALLED→ACTIVE→SUSPENDED/REMOVED, CAS revision guards, installation binding, signed manifest digest and schema revision on upgrade, fail-closed invalid transitions | E02, E06 |
| `packages/platform-kernel/src/index.ts` | Public export of lifecycle contracts | E02 |
| `packages/platform-kernel/src/__tests__/lifecycle.test.ts` (new) | 7 positive/negative tests for identity and lifecycle | E01, E02 |
| `tests/architecture/m01-external-consumer-negative.test.ts` (new) | 7 deterministic negative fixtures: private workspace paths, DB/config adapters, Fastify, relative siblings; canonical consumer positive | E04, E09 |
| `M01-EXTERNAL-APPLICATION-LIFECYCLE-TEST-MATRIX.md` (new) | Lifecycle test inventory with explicit NOT EVIDENCED rows | E09 |
| `scripts/platform/m01/installation-isolation-drill.sh` (new) | Disposable PG16 A/B schema and role isolation plus Redis DB isolation drill, 7 assertions | E10 |

## Reused without reopening

- `packages/platform-kernel/src/{application,contracts,manifest,registry}.ts` — existing typed definitions, registry and route/action contracts.
- `apps/platform-reference` — independent reference application with custom routes/actions.
- `examples/external-crm-consumer` + `scripts/verify-external-consumer.mjs` — packed-kernel external consumer proof.
- `packages/tenancy/src/scope.ts` — server-verified tenant scope (M02 dependency, not reimplemented).
- `tests/architecture/platform-boundaries.test.ts` and `m00-boundary-contract.test.ts` — dependency inversion enforcement.
- Two-publication CMS/Studio pinned fixture pack — strangler compatibility.

## Explicitly not claimed

- Live OIDC/JWKS membership integration (M02 dependency).
- Production application hosting, M04 Batch 03 runtime, generated REST/Admin runtime.
- Published public SDK/CLI (A2/G6 authorization pending).
- OS-level isolation inside one Node process.

## Verification

- Kernel suite: 24/24 tests pass (3 files including new lifecycle tests).
- M01 negative consumer fixtures: 7/7 pass.
- Kernel TypeScript check: clean.
- Disposable A/B drill: 7/7 PASS, exit 0.
- Full milestone-end cycle results recorded in `M01-FINAL-MILESTONE-VERIFICATION.md`.
