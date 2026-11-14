# M00 — Reviewed Baseline, Ownership and ADR Blockers

> **Status: RECORDED BASELINE — NOT A CERTIFICATION.** This document pins the immutable
> inputs used by the Wave 1 implementation branch. It does not merge the roadmap, does
> not assign owners, and does not approve any ADR.

## 1. Immutable inputs

| Input | Value | Note |
| --- | --- | --- |
| Host repository | `AbdullahZaher/vibress` | |
| Implementation base (this branch) | `5183f34f0c404de9c02ba8c79cc54b42bc6975e6` (`main`) | `fix(setup-e2e): boot production-mode stack past config guards` |
| Roadmap source PR | [#151](https://github.com/AbdullahZaher/vibress/pull/151) — **OPEN, DRAFT, MERGEABLE** | Branch `docs/universal-platform-master-roadmap-2026-11-14` |
| Roadmap head SHA (pinned) | `c9997a9353a229a4287256f5ba3b94d718e3a5d9` | Normative planning input; **not merged** |
| Studio repository | `AbdullahZaher/vibress-studio` | |
| Studio `main` SHA at baseline | `eda4c52e7d14318c1275de6c8a367528d1722a83` | Read-only reference |
| Latest host release | `v1.2.0-beta.2` (2026-11-09) | Tagged releases `v1.0.0`, `v1.1.0`, `v1.2.0-beta.1/2` |
| Root package version | `1.2.0` | ADR-013 unified SemVer |

**Integration strategy.** PR #151 is not merged, so the implementation branch is cut
from `main` at `5183f34f`, and the roadmap head SHA above is pinned as normative
input. No roadmap document is copied, edited or pre-merged by this branch. The
`docs/platform-roadmap/execution/` path is new and does not collide with PR #151.

## 2. Runtime and dependency baseline

| Component | Baseline | Source |
| --- | --- | --- |
| Node.js | `>=24.0.0 <25` (session: v24.22.1) | `package.json` `engines` |
| pnpm | `11.22.0` | `package.json` `packageManager` |
| TypeScript | `^5.5.3`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | `package.json`, tsconfigs |
| PostgreSQL | 16 image via Compose, dev port `127.0.0.1:5433` | `docker-compose*.yml` |
| Redis | 7 image, dev port `127.0.0.1:6380` | `docker-compose*.yml` |
| Drizzle ORM | `^0.45.2` | `packages/database/package.json` |
| Fastify | `^5.12.7` | `apps/api/package.json`, workspace override |
| BullMQ | `^5.7.8` / ioredis `^5.4.1` | `apps/api`, `apps/worker` |
| Next.js / React | `^15.5.28` / `^18.3.1` | `apps/web/package.json` |
| Vitest | `^4.1.10` | root devDependencies |
| `pg` | `^8.22.0` (added this branch) | root devDependencies |
| Migrations at baseline | 54 journal entries, last `0053_email_suppressions_publication_scope` | `packages/database/migrations/meta/_journal.json` |

Workspace globs: `apps/*`, `packages/*`, `packages/domains/*` (`pnpm-workspace.yaml`).

## 3. Existing assets this branch builds on

| Asset | Path | Finding relevant to Wave 1 |
| --- | --- | --- |
| Pooled connection | `packages/database/src/connection.ts` | `getDb()` is pooled and outside any verified tenant scope; unchanged by this branch |
| Transaction context | `packages/database/src/transaction/transaction-context.ts` | ALS-based; the new unit of work is separate and stricter |
| Transaction runner | `packages/database/src/transaction/transaction-runner.ts` | Nested calls reuse the outer transaction **without savepoints**; unchanged |
| Runtime role (legacy) | `packages/database/src/runtime-role.ts` | Grants `CREATE` on `public`, DML on all tables, `EXECUTE ON ALL FUNCTIONS`, plus default privileges |
| Plugin SDK | `packages/plugin-sdk/package.json` | `private: true`; not an independently released package |
| Security review | `SECURITY-REVIEW.md` | F-012 residual risk records RLS not activated; launch recommendation remains conditional |
| Release identity | `docs/14-decisions/release-versioning-strategy.md` (ADR-013) | Unified SemVer; no Framework `v1.0.0` artifact exists |

## 4. Ownership and decision blockers (all OPEN)

| ID | Blocker | Required owner role | State |
| --- | --- | --- | --- |
| ADR-PLAT-001 | Installation topology | Architecture lead | **PROPOSED — unassigned** |
| ADR-PLAT-002 | Application / tenant / principal vocabulary | Architecture lead + DB/security | **PROPOSED — unassigned** |
| ADR-PLAT-003 | Tenant transaction and RLS contract | DB/security lead | **PROPOSED — unassigned** |
| ADR-PLAT-004 | Schema DSL and DDL authority | Architecture + DB/security | Not started (Wave 2) |
| ADR-PLAT-005 | Generated authorization and query limits | Security + API lead | Not started (Wave 2) |
| ADR-PLAT-006 | Module ABI and trust | Plugin lead | Not started (Wave 2) |
| ADR-PLAT-007/008 | v1 scope, version stream, upgrades | Release owner | Not started (Wave 3) |
| ADR-PLAT-009/010 | Frontend boundary, data lifecycle | Architecture + privacy owner | Not started (Waves 3–5) |
| A1–A8 | Organizational sign-offs | Human owners | **OPEN** |
| G0–G7 | Execution gates | Named reviewers | **G0 not signed** |
| R26–R40 | Audit findings | DB/security/release | Open; R26 partially measured (see Wave 1 report) |

Named humans are **not** invented here. Until real owners sign, every ADR remains
`PROPOSED` and the program remains blocked for acceptance, not approved.

## 5. Reproduced baseline commands

Executed on the branch base `5183f34f` before any change:

```
pnpm install --ignore-scripts          # workspace link, pnpm 11.22.0
docker ps                              # vibress-postgres-1 on 127.0.0.1:5433
```

The database used by this branch's integration proof is the existing
`vibress-postgres-1` container; no production system, tag or migration was modified.
