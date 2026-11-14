# Program Execution Status — M00–M12

> **Last updated: 2026-11-14.** Implementation branch:
> `feat/wave1-platform-kernel-tenant-isolation`, cut from `main` at
> `5183f34f0c404de9c02ba8c79cc54b42bc6975e6`. Current reviewed baseline
> `b62ffdf5` (PR #166 head); the P0-A/P0-B/P1 security remediation is an
> uncommitted working tree on top of it. Roadmap input pinned at
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
| M00 Engineering baseline | Baseline SHAs, dependency/runtime pin, asset inventory, ownership map, ADR blockers, boundary test with relative escape detection and missing dir failure, docs-link validator wired into CI, unit/integration split in CI, legacy docs links cleaned (612 links / 296 files resolve), pinned two-publication CMS/Studio fixture pack with digest and HTTP proof | Named owners |
| M01 Universal kernel | Branded identity, public contracts, definition helpers, in-memory registry, serializable manifest with digest, persisted registry (drift/integrity refusal, CAS update, two-way verification), atomic installation binding with CAS guards, kernel route execution adapter, bootable standalone reference app with runtime/reader/verifier verification, **separate operator provisioning executable with owner credentials**, **request-serving process that refuses `DATABASE_URL` and has no provisioning authority**, pinned read-only installation/environment/artifact/manifest verification, kernel-only import boundary | Independent review and named sign-off; production identity-provider adapter and deployment runbook |
| M02 Security/identity/tenancy | Verified scope, default-deny policy, tenant unit of work with hardened comment/schema-qualification scope mutation detection, role-switch rejection, async-escape fail-closed, connection destruction on unknown session state and a pre-commit role identity probe, additive RLS migration, least-privilege runtime role (registry and membership tables denied), boot-time privilege assertions over `current_user` and `session_user`, **all SET-able role memberships (privileged, ordinary, indirect and `NOINHERIT`)**, schema/database CREATE, database/schema/table/function ownership, registry table/column ACLs and SECURITY DEFINER EXECUTE, 22-test PostgreSQL deny matrix plus escape/role-switch/membership tests including non-superuser owner `FORCE RLS`, R26 read-only function inventory, two-database installation boundary | R26 revocation approval/application, deployment non-superuser owner, views/report policy decision, Redis/S3 boundary tests, production IdP, independent review |

## Evidence executed on this branch

Suites and typecheck were re-measured on 2026-11-15 for the final remediation
increment (commit `0f64936a` on top of `6b31320d`): platform suite, reference-app integration,
architecture, full unit, full integration, workspace typecheck, lint, Playwright and
both docs link validators all passed on that tree. CI run
[43641264614](https://github.com/AbdullahZaher/vibress/actions/runs/43641264614) on
`0f64936a` passed build, container-scan and e2e; only docs-only edits followed that
SHA. The R26 read-only audit was last re-run on
2026-11-14T19:12:39.618Z with identical totals; the CMS-subset audit was run earlier
on this branch.

| Suite | Result |
| --- | --- |
| **Full platform suite, final remediation tree** (`pnpm exec vitest run --config vitest.platform.config.ts`) | **11 files / 174 tests passed**, exit 0 |
| **Reference app, final remediation tree** (`tests/integration/platform-reference-app.test.ts`) | **69/69 passed**; matching installation boots; environment/artifact/application-id/manifest drift fails read-only with rows unchanged; verifier SELECT-only and denied writes/other relations; runtime/reader/verifier reject privileged, ordinary, indirect and `NOINHERIT` memberships; child-process serving start exits 1 with `DATABASE_URL` or non-distinct URLs; CAS-guarded provisioning leaves rows unchanged on mismatch; 11 contract/provisioning tests (ten real-PostgreSQL negatives plus a pre-existing-grant revocation) and 4 atomic-provisioning tests (manifest update + forced CAS failure leaves manifest, installation and both audit streams unchanged; forced audit failure rolls back; idempotent retry; single concurrent winner) |
| Architecture boundary (`tests/architecture/platform-boundaries.test.ts`) | 6/6 passed, including no provisioning imports/owner identifiers in `server.ts`/`start.ts` |
| Typecheck + lint, final remediation tree | `tsc` for `packages/database` and `apps/platform-reference` passed; ESLint on all changed files clean |
| Reference-app Playwright, final remediation tree | 8/8 passed |
| Kernel + tenancy unit tests + architecture boundary (prior commit content) | 70 tests passed (7 files) |
| PostgreSQL tenant isolation (`tests/integration/platform-tenant-isolation.test.ts`) | 24/24 passed |
| Two-installation database boundary (`tests/integration/platform-installation-isolation.test.ts`) | 8/8 passed, cross-database `CONNECT` denied |
| R26 read-only function audit (`scripts/audit-function-privileges.mjs`) | Re-measured 2026-11-14T19:12:39.618Z: 33 public functions, 0 `SECURITY DEFINER`, 31 extension-owned, 2 trigger functions, 33 with `PUBLIC` EXECUTE, 0 default-ACL entries, one superuser role |
| CMS compatibility subset (publications, content, transactions, Studio persistence, outbox) | 79/79 passed |
| Pinned CMS/Studio fixture pack (unit) | 4/4 passed — digest, drift refusal, deterministic encoding |
| Pinned CMS/Studio fixture pack (HTTP + PostgreSQL) | 3/3 passed — per-publication pinned documents, non-disclosing cross-publication 404/403, Studio round-trip and pinned restore |
| Full docs link validation (`node scripts/validate-docs-links.mjs docs`) | Re-run 2026-11-14 after the W1-T09 E2E/usability increment: 661 links across 300 files resolve (657/300 after the W1-T09 E2E section; 652/300 after the W1-T09 runbook; 629/298 after W1-T09 #27/#28; 626/297 after W1-T05; 612/296 at W1-T08; 76 legacy links rewritten; `/vibress/<path>` legacy prefix supported) |
| Unit/boundary/component suite (`pnpm test:unit`, earlier split-suite increment) | 362 files / 2584 tests passed, exit 0 |
| Full integration suite (`vitest.config.ts tests/integration`, earlier split-suite increment) | 46 files / 542 tests passed, exit 0 |
| `pnpm test:integration` (now runs `vitest run --no-file-parallelism tests/integration`, earlier increment) | 46 files / 542 tests passed, exit 0, run sequentially, 95.35 s wall (59.92 s test execution) |
| `pnpm docs:validate-links` (`docs/platform-roadmap`) | Re-run 2026-11-14: 89 links across 12 files resolve (85/12 after the W1-T09 E2E section; 80/12 after the W1-T09 runbook; 57/10 after W1-T09 #27/#28; 54/9 after W1-T05; 40/8 before it) |
| Full platform suite (prior commit content) | 11 files / 137 tests passed |
| Targeted typecheck (kernel, tenancy, database, reference app) | passed |
| Targeted ESLint (new packages, executor, registry store, reference app, boundary test, integration tests) | passed |
| Full unit suite on the final remediation tree (`pnpm test:unit`) | 362 files / 2585 tests passed, exit 0, 317.19 s |
| Full integration suite on the final remediation tree (`pnpm test:integration`) | 46 files / 578 tests passed, exit 0, 127.31 s, sequential |
| Workspace typecheck on the final remediation tree (`nx run-many --target=typecheck --all`) | 74/74 projects succeeded |
| CI on the final remediation source SHA | **PASS** — run [43641264614](https://github.com/AbdullahZaher/vibress/actions/runs/43641264614) on `0f64936a`: build, container-scan and e2e succeeded |
| Workspace-wide typecheck (`nx run-many --target=typecheck --all --skip-nx-cache`) | 74/74 projects succeeded |

Integration suites share the dev database and must run sequentially. One run that
overlapped a second suite produced 2 spurious `setup.test.ts` failures (shared tables
truncated mid-test); the cause is recorded in the
[Wave 1 report](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md). Two later sequential
runs passed.

## Wave 1 remediation tickets

| ID | Priority | Status |
| --- | --- | --- |
| W1-T01 runtime-role privilege assertions | P0 | **Done, extended** — boot fails closed on unsafe `current_user`/`session_user` attributes, privileged membership, schema/database CREATE, ownership, registry ACLs and SECURITY DEFINER EXECUTE; real-PostgreSQL negative tests. Now also enforces the versioned runtime privilege contract on effective table/view/column/sequence/schema/function authority |
| W1-T02 split owner/registry access from serving | P0 | **Superseded by P0-A/P1** — the owner pool was removed from the serving process entirely; provisioning is a separate executable |
| W1-T03 atomic installation binding | P0 | **Superseded by the P1 create/update split** — creation is one statement with its audit row; installation changes are a separate mandatory-CAS operation with a transactional audit row |
| W1-T04 transaction trust boundary | P0 | **Done** — scoped handle sealed at settlement, escaped in-flight work fails the unit closed and destroys the connection, role switching rejected and re-verified against the identity captured at `BEGIN`, failed `ROLLBACK`/`COMMIT` destroys the connection; six unit and two real-PostgreSQL negative tests |
| W1-T05 R26 PUBLIC EXECUTE revocation | P0 | Blocked — requires DB-owner authorization; [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) prepared and proposal 0055 hardened (fail-closed checks, verification, rollback), **not applied**; Scope B legacy-role grant decision also required |
| W1-T06 Redis/S3/queue isolation proof | P1 | Pending — requires production-shaped infrastructure authorization |
| W1-T07 production identity provider | P1 | Pending — static bearer-token directory remains reference-only |
| W1-T08 CMS/Studio fixture pack; F-012 decision; legacy docs links | P1 | **Done** — digest-pinned two-publication CMS/Studio pack with run-scoped provisioning and teardown, 4 pack unit tests and 3 real HTTP+PostgreSQL compatibility tests (per-publication pinned documents, non-disclosing cross-publication 404/403, Studio round-trip and restore); 76 legacy docs links rewritten and the full docs tree validates (612/296); F-012 decision record proposed (option B), **not accepted** |
| W1-T09 runbooks, registry change audit, reference-app Playwright, R40, ownership | P2 | **Done** — [registry change audit](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md) with migration 0057 and real-PostgreSQL tests (69 reference-app tests on the final tree); [boot/registry/deployment runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md) and `pnpm platform:provision-roles`; [reference-app Playwright](PLATFORM-BOOT-REGISTRY-RUNBOOK.md#9-reference-app-playwright-harness) **8/8 passed** with per-run roles/rows cleaned; [R40 decision record](R40-VERSION-IDENTITY-DECISION.md) and [ownership assignment request](OWNERSHIP-ASSIGNMENT-REQUEST.md) prepared but unresolved/unsigned |
| P0-A privileged provisioning authority out of the serving process | P0 | **Done in code, unreviewed** — separate `pnpm platform:provision-reference` executable; serving refuses `DATABASE_URL`, holds no owner pool/registry store, and a source-boundary test enforces it; child-process negative tests |
| P0-B full SET-able membership closure | P0 | **Done in code, unreviewed** — runtime/reader/verifier reject any non-self membership, including indirect and `NOINHERIT`; real-PostgreSQL tests |
| P1 separate provisioning and pinned read-only verification | P1 | **Done in code, unreviewed** — CAS-guarded operator provisioning; dedicated SELECT-only verifier role; environment/artifact/application/manifest drift fails before serving without mutation; audit attribution |
| P1 strict runtime privilege contract | P1 | **Done in code, unreviewed** — versioned, extensible allowlist (schemas, relations by kind, sequences, functions) enforced on effective authority at boot and provisioning; ten real-PostgreSQL negatives plus a pre-existing-grant revocation test; reference CRM profile is one contract instance |
| P1 atomic provisioning transaction | P1 | **Done in code, unreviewed** — one checked-out connection and one transaction for manifest, installation, both audit streams and the read-only proof; stale-CAS, forced-audit-failure, idempotent-retry and one-winner-concurrency tests |
| P1 mandatory CAS + installation audit | P1 | **Done in code, unreviewed** — `registerInstallation`/`updateInstallation` split; actor, reason and both expected-state values required for updates; migration `0058` audit row written in the same statement |

## Known residual risks carried forward

| ID | Risk | Status |
| --- | --- | --- |
| R26 | `PUBLIC` default `EXECUTE` lets the platform role call owner functions; the legacy runtime role also holds explicit function EXECUTE | Inventoried and re-measured 2026-11-14; [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) prepared, **not applied**; 0055 alone would not close the legacy role (Scope B open) |
| F-012 | CMS tables are not covered by RLS; security review remains conditional | Open — [CMS disposition proposed](F-012-CMS-RLS-DECISION.md) (option B: self-hosted application-level isolation; multi-tenant hosting gated on RLS activation), **not accepted**; no RLS or grant change made |
| R35 | PostgreSQL views/materialized reports do not inherit caller RLS | Open, feature excluded from contract |
| R37 | Legacy transaction runner nests without savepoints (the scoped tenant unit of work is hardened) | Unchanged by design, documented |
| — | Owner credentials exist only for the separate provisioning executable | **Fixed in code (P0-A)** — serving refuses `DATABASE_URL`; provisioning must still run as a controlled deployment step with least-time credentials |
| — | Installation `artifact_digest` is supplied by the deployment pipeline; provenance is not cryptographically verified | Partially addressed (P1) — required and pinned by provisioning and boot verification; CI provenance open |
| — | Reference app uses an operator-configured static bearer-token directory, not a production identity provider | Reference only; replace before any shared deployment |
| — | Membership directory is not RLS-protected (read before a scope exists); runtime role is denied the table and the reader role has SELECT only | By design; auth-service access model needs review |
| — | No application/tenant provisioning API; registry drift is now a documented, audited manual deployment step | Provisioning API open; [runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md) and change audit added in W1-T09 |
| — | 76 pre-existing broken links in legacy docs outside `docs/platform-roadmap` | Docs rot | **Resolved (W1-T08)** — rewritten to relative targets; `node scripts/validate-docs-links.mjs docs` passes 612 links / 296 files |
| — | Broader CMS Playwright E2E/acceptance suites require staging secrets and have not run | Open; reference-app Playwright **8/8 passed** locally (W1-T09) |
| R40 | Release/version identity (`1.2.0` vs Framework GA) | Unresolved — [decision record](R40-VERSION-IDENTITY-DECISION.md) prepared; release-owner signature required |
| A1–A8, G0–G7 | Human sign-offs and gates | Open, unassigned — [role request](OWNERSHIP-ASSIGNMENT-REQUEST.md) recorded |

## Rules in force

- Do not start Wave 2 before Wave 1 GO, independently reviewed and signed.
- Do not mark any milestone complete from documentation alone.
- Do not enable public application hosting or external tenant onboarding.
- Do not rewrite tags, migrations, audit records or historical issue status.

## Linked evidence

- [Wave 1 report](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md)
- [M00 baseline and ownership](BASELINE-AND-OWNERSHIP-M00.md)
- [Platform boot, registry and deployment runbook](PLATFORM-BOOT-REGISTRY-RUNBOOK.md)
- [R40 version-identity decision record](R40-VERSION-IDENTITY-DECISION.md)
- [Ownership assignment request](OWNERSHIP-ASSIGNMENT-REQUEST.md)
- [ADR-PLAT-001](adr/ADR-PLAT-001-installation-topology.md)
- [ADR-PLAT-002](adr/ADR-PLAT-002-identity-vocabulary.md)
- [ADR-PLAT-003](adr/ADR-PLAT-003-tenant-transaction-rls.md)
- [R26 function EXECUTE inventory](R26-FUNCTION-EXECUTE-INVENTORY.md), [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) and [proposed revocation](proposals/0055_revoke_public_execute.sql)
