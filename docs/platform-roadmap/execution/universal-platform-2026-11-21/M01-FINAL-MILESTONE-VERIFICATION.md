# M01 — Final Milestone Verification

**Runtime:** Node v24.22.3, pnpm 11.22.0, PostgreSQL 16, Redis 7, S3-compatible Silo, Mailpit (disposable).
**Scope:** E01–E10, reuse-first; no runtime hosting, no M04 activation, no package publication.

## Gate results

| Gate | Result |
|---|---|
| Full unit suite | **381 files / 2748 tests passed**, exit 0 (single final M01 cycle) |
| Kernel suite | 24/24 tests pass (3 files; new lifecycle + workspace identity tests) |
| M01 negative external-consumer fixtures | 7/7 pass |
| Disposable PG16/Redis A/B isolation drill | 7/7 PASS, exit 0 |
| Packed external consumer proof | typecheck exit 0, 5/5 tests, zero private imports |
| Kernel TypeScript check | clean |
| Architecture boundary tests | pass (kernel/tenancy/UI-database/CMS compatibility) |
| Repository inventory / traceability / evidence verifiers | pass |
| Roadmap + link validation | pass |
| PostgreSQL 16 registry persistence | existing migration 0056/0057/0058 and reference registry tests pass in full suite |
| CMS/Studio compatibility | pinned fixture pack and full suite pass |
| Browser E2E / production OIDC / RLS live proof | NOT RUN — M02/M08 gates, explicitly excluded |

## Epic coverage

| Epic | Status | Evidence |
|---|---|---|
| E01 domain vocabulary | IMPLEMENTED_RESTRICTED | branded WorkspaceId; `pub_default` refusal; identity tests |
| E02 public contracts | IMPLEMENTED_RESTRICTED | lifecycle/CAS contracts exported from kernel; tests |
| E03 persistent registry | IMPLEMENTED_RESTRICTED | existing registry + lifecycle revision guards; PG16 full suite |
| E04 dependency inversion | IMPLEMENTED_RESTRICTED | architecture boundary tests; kernel has zero workspace deps |
| E05 CMS strangler | IN_PROGRESS | pinned two-publication fixture pack; no new claim |
| E06 reference consumer | IMPLEMENTED_RESTRICTED | platform-reference custom route/action + lifecycle contract |
| E07 per-installation runtime | IN_PROGRESS | non-superuser roles inventoried; live IdP is M02 |
| E08 authenticated context | IN_PROGRESS | server-verified scope tests; live OIDC pending M02 |
| E09 packaging | IMPLEMENTED_RESTRICTED | packed tarball consumer + negative fixtures; publication blocked A2/G6 |
| E10 physical isolation | IMPLEMENTED_RESTRICTED | disposable A/B PG schema/role + Redis DB denial drill |

No Epic is formally closed. No capability is generally available.
