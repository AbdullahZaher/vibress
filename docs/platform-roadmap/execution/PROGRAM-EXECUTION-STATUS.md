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
| M00 Engineering baseline | Baseline SHAs, dependency/runtime pin, asset inventory, ownership map, ADR blockers, boundary test | Documentation validator + CI job, pinned two-publication CMS/Studio fixture pack, named owners |
| M01 Universal kernel | Branded identity, public contracts, definition helpers, registry, action/route/module reference, kernel-only import boundary | Persisted application registry, bootable standalone reference app, kernel route execution adapter |
| M02 Security/identity/tenancy | Verified scope, default-deny policy, tenant unit of work, additive RLS migration, least-privilege runtime role, 22-test PostgreSQL deny matrix including non-superuser owner `FORCE RLS`, R26 read-only function inventory | R26 revocation approval/application, deployment non-superuser owner, views/report policy decision, cross-installation and Redis/S3 denial tests, audit/secrets scope |

## Evidence executed on this branch

| Suite | Result |
| --- | --- |
| Kernel + tenancy unit tests + architecture boundary (`vitest.platform.config.ts`) | 39/39 passed |
| PostgreSQL tenant isolation (`tests/integration/platform-tenant-isolation.test.ts`) | 22/22 passed |
| R26 read-only function audit (`scripts/audit-function-privileges.mjs`) | 33 public functions, 0 `SECURITY DEFINER`, 0 default-ACL entries |
| CMS compatibility subset (publications, content, transactions, Studio persistence, outbox) | 79/79 passed |
| Targeted typecheck (kernel, tenancy, database) | passed |
| Targeted ESLint (new packages, boundary test, integration test, new database files) | passed |
| Workspace-wide typecheck (`nx run-many --target=typecheck --all --skip-nx-cache`) | 73/73 projects succeeded |

## Known residual risks carried forward

| ID | Risk | Status |
| --- | --- | --- |
| R26 | `PUBLIC` default `EXECUTE` lets the platform role call owner functions | Inventoried; revocation proposed, **not applied** |
| F-012 | CMS tables are not covered by RLS; security review remains conditional | Unchanged, open |
| R35 | PostgreSQL views/materialized reports do not inherit caller RLS | Open, feature excluded from contract |
| R37 | Legacy transaction runner nests without savepoints | Unchanged, documented |
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
