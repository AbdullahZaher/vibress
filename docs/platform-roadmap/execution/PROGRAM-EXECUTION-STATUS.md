# Program Execution Status — M00–M12

> **Last updated: 2026-11-14.** Implementation branch:
> `feat/wave1-platform-kernel-tenant-isolation`, cut from `main` at
> `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`. Roadmap input pinned at
> PR #151 (draft) head `c9997a9353a229a4287256f5ba3b94d718e3a5d9`.
>
> **No wave has passed its gate. No ADR is accepted. No production authorization
> exists.** This file records measured status only.

## Wave status

| Wave | Milestones | Status | Gate |
| --- | --- | --- | --- |
| 1 | M00–M02 | **IN PROGRESS — partial implementation, NO-GO** | Not passed |
| 2 | M03–M06 | Not started | Blocked by Wave 1 |
| 3 | M07–M08 | Not started | Blocked |
| 4 | M09–M10 | Not started | Blocked |
| 5 | M11–M12 | Not started | Blocked |

## Wave 1 milestone detail

| Milestone | Done on branch | Missing before exit |
| --- | --- | --- |
| M00 Engineering baseline | Baseline SHAs, dependency/runtime pin, asset inventory, ownership map, ADR blockers, boundary test, docs-link validator wired into CI, unit/integration split in CI | Legacy docs link cleanup, pinned two-publication CMS/Studio fixture pack, named owners |
| M01 Universal kernel | Branded identity, public contracts, definition helpers, in-memory registry, serializable manifest with digest, persisted registry (drift/integrity refusal, two-way verification), kernel route execution adapter, bootable standalone reference app, kernel-only import boundary | Independent review and named sign-off; production identity-provider adapter and deployment runbook |
| M02 Security/identity/tenancy | Verified scope, default-deny policy, tenant unit of work, additive RLS migration, least-privilege runtime role (registry and membership tables denied), 22-test PostgreSQL deny matrix including non-superuser owner `FORCE RLS`, R26 read-only function inventory, two-database installation boundary | R26 revocation approval/application, deployment non-superuser owner, views/report policy decision, Redis/S3 boundary tests, audit/secrets scope |

## Evidence executed on this branch

| Suite | Result |
| --- | --- |
| Kernel + tenancy unit tests + architecture boundary (`vitest.platform.config.ts`) | 61 tests passed (7 files) |
| PostgreSQL tenant isolation (`tests/integration/platform-tenant-isolation.test.ts`) | 22/22 passed |
| Persisted registry + reference app over HTTP/PostgreSQL (`tests/integration/platform-reference-app.test.ts`) | 14/14 passed; runtime role denied registry and membership tables (`42501`) |
| Two-installation database boundary (`tests/integration/platform-installation-isolation.test.ts`) | 8/8 passed, cross-database `CONNECT` denied |
| R26 read-only function audit (`scripts/audit-function-privileges.mjs`) | 33 public functions, 0 `SECURITY DEFINER`, 0 default-ACL entries |
| CMS compatibility subset (publications, content, transactions, Studio persistence, outbox) | 79/79 passed |
| Unit/boundary/component suite (`pnpm test:unit`) | 361 files / 2571 tests passed, exit 0 |
| Full integration suite (`vitest.config.ts tests/integration`) | 45 files / 518 tests passed, exit 0 |
| `pnpm test:integration` (now runs `vitest run --no-file-parallelism tests/integration`) | 45 files / 518 tests passed, exit 0, two consecutive runs |
| `pnpm docs:validate-links` (`docs/platform-roadmap`) | 25 links across 7 files resolve |
| Full platform suite (`vitest.platform.config.ts`) | 11 files / 107 tests passed |
| Targeted typecheck (kernel, tenancy, database, reference app) | passed |
| Targeted ESLint (new packages, executor, registry store, reference app, boundary test, integration tests) | passed |
| Workspace-wide typecheck (`nx run-many --target=typecheck --all --skip-nx-cache`) | 74/74 projects succeeded |

Integration suites share the dev database and must run sequentially. One run that
overlapped a second suite produced 2 spurious `setup.test.ts` failures (shared tables
truncated mid-test); the cause is recorded in the
[Wave 1 report](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md). Two later sequential
runs passed.

## Known residual risks carried forward

| ID | Risk | Status |
| --- | --- | --- |
| R26 | `PUBLIC` default `EXECUTE` lets the platform role call owner functions | Inventoried; revocation proposed, **not applied** |
| F-012 | CMS tables are not covered by RLS; security review remains conditional | Unchanged, open |
| R35 | PostgreSQL views/materialized reports do not inherit caller RLS | Open, feature excluded from contract |
| R37 | Legacy transaction runner nests without savepoints | Unchanged, documented |
| — | Reference app uses an operator-configured static bearer-token directory, not a production identity provider | Reference only; replace before any shared deployment |
| — | Membership directory is not RLS-protected (read before a scope exists); runtime role is denied the table | By design; auth-service access model needs review |
| — | No application/tenant provisioning API; registry drift update needs a deployment runbook and has no change audit | Open |
| — | 76 pre-existing broken links in legacy docs outside `docs/platform-roadmap` | Docs rot | Recorded, cleanup not started |
| — | Playwright E2E/acceptance suites require staging secrets and have not run | Open |
| R40 | Release/version identity (`1.2.0` vs Framework GA) | Unresolved |
| A1–A8, G0–G7 | Human sign-offs and gates | Open, unassigned |

## Rules in force

- Do not start Wave 2 before Wave 1 GO, independently reviewed and signed.
- Do not mark any milestone complete from documentation alone.
- Do not enable public application hosting or external tenant onboarding.
- Do not rewrite tags, migrations, audit records or historical issue status.

## Linked evidence

- [Wave 1 report](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md)
- [M00 baseline and ownership](BASELINE-AND-OWNERSHIP-M00.md)
- [ADR-PLAT-001](adr/ADR-PLAT-001-installation-topology.md)
- [ADR-PLAT-002](adr/ADR-PLAT-002-identity-vocabulary.md)
- [ADR-PLAT-003](adr/ADR-PLAT-003-tenant-transaction-rls.md)
- [R26 function EXECUTE inventory](R26-FUNCTION-EXECUTE-INVENTORY.md) and [proposed revocation](proposals/0055_revoke_public_execute.sql)
