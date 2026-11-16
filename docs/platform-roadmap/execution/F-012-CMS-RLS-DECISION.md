# F-012 — CMS Row-Level Security Decision Record

> **Status: PROPOSED — NOT ACCEPTED. No migration or grant change is made by
> this record.** Decision owner: **UNASSIGNED** (security review owner + DB
> owner). This record closes the W1-T08 *decision* item, not the residual risk.
> The unsupported *topologies* are already blocked at boot by a code guard
> (section "Topology enforcement"), so the guard does not preempt the A/B
> decision; it only prevents shipping an unproven posture before one is made.

## Decision requested

F-012 records that CMS tables (`posts`, `pages`, `publication_memberships`,
media, comments, and related content tables) are **not covered by row-level
security**; isolation is enforced in application code by the publication
context. The decision requested is which posture v1 may ship with:

- **A — Activate CMS RLS before v1.** Add a migration with `ENABLE`/`FORCE ROW
  LEVEL SECURITY` and `USING`/`WITH CHECK` policies on every CMS table, route all
  CMS queries through a verified scope, grant the runtime role only the policy
  surface, and re-run the CMS compatibility suites. This is a multi-week project
  requiring DB-owner approval; it cannot be completed inside Wave 1.
- **B — Keep the documented application-level isolation for v1, keep F-012 open
  (recommended).** Ship the current self-hosted, single-operator posture with
  publication isolation enforced by the API and proven by tests, and hard-gate
  public multi-tenant hosting and external tenant onboarding until option A
  lands.
- **C — Declare CMS tables permanently outside the RLS contract.** Rejected: it
  contradicts the direction of [ADR-PLAT-003](adr/ADR-PLAT-003-tenant-transaction-rls.md)
  and would silently drop the residual from the release gate.

## Decision matrix

| Dimension | A — CMS RLS before v1 | B — Application isolation, F-012 open |
| --- | --- | --- |
| Isolation enforcement point | PostgreSQL policies on every CMS table, plus verified-scope query routing | Application publication context at the API boundary |
| Attack surface if a query bypasses the API | Closed by `FORCE RLS` for the runtime role | Open: any owner-credential SQL or a new direct caller crosses publications |
| Blast radius of the change | Every CMS read/write path and the runtime grant surface; a missed path fails closed and breaks the CMS | No CMS code change; residual risk documented and gated |
| Migration and review cost | Multi-week: migration, routing refactor, grant review, full compatibility re-run, DB-owner approval | None inside Wave 1; option A remains queued |
| CMS/Studio compatibility risk | High until the pinned fixture pack and CMS suites pass through verified scopes | Low: current suites already pass unchanged |
| Operational risk | Connection context must be set on every CMS transaction; pooled handles without context return no rows | Misconfiguration is not detectable at the DB layer; relies on the API being the only writer |
| Hosting posture enabled | Shared/multi-tenant hosting and external onboarding become reviewable | Single installation only; shared hosting and onboarding hard-gated |
| Wave 1 deliverability | Not achievable in Wave 1 | Achievable; requires named acceptance of the residual |
| Residual after the change | None for CMS tables (subject to verification) | F-012 remains open and must be carried in the release gate |

The matrix does not choose for the owners. Under either option, the topology
guard below is required: option B needs it as the hard gate, and option A's
rollout still starts from a single-installation deployment.

## Why option A cannot be claimed now

- The additive migration applied in this branch
  ([0054_platform_tenant_rls.sql](../../../packages/database/migrations/0054_platform_tenant_rls.sql))
  covers platform tables only; no CMS table is enabled or forced.
- CMS reads and writes use the pooled `getDb()` handle, which carries no
  `vibress.tenant_id`/`application_id` transaction context. Enabling `FORCE RLS`
  without routing every CMS query through a verified scope would fail closed and
  break the CMS, not secure it.
- The security review still records RLS as disabled by design and lists runtime
  RLS behavior as unverified ([SECURITY-REVIEW.md](../../../SECURITY-REVIEW.md),
  F-012).
- Enabling RLS and changing grants requires explicit DB-owner authorization,
  which has not been given.

## Why option B is defensible for a self-hosted v1

- Publication isolation is measured at the HTTP boundary, not assumed:
  `tests/integration/runtime-multi-publication-isolation.test.ts` proves host
  routing, per-publication staff sessions, cross-publication 404 non-disclosure,
  and publication-owned settings.
- The pinned two-publication fixture pack
  (`tests/integration/platform-cms-studio-fixture-pack.test.ts`) adds a
  versioned, digest-checked compatibility baseline: each publication's pinned
  Studio documents (canonical `studio-card`, RTL Arabic content, inline
  linebreaks) are read, round-tripped, and cross-publication reads/writes are
  refused with the same non-disclosing 404 as a random id.
- The deployment posture remains single-installation: no public application
  hosting and no external tenant onboarding are enabled, per the program rules.

## Conditions attached to option B (if accepted)

1. F-012 stays listed as an **open** residual in the program status; it is not
   reclassified as fixed by this record.
2. Any move to shared/multi-tenant hosting, external tenant onboarding, or
   publication-level self-service requires option A first: RLS migration,
   verified-scope CMS query routing, runtime-role grant review, and CMS
   compatibility re-run.
3. A new review of the authentication/membership read path is required if
   membership data leaves the installation boundary; the membership directory is
   not RLS-protected by design (it is read before a scope exists).
4. This record must be accepted or replaced by the security review owner and DB
   owner before the Wave 1 gate can reference an F-012 disposition.

## Topology enforcement (implemented, not a decision)

The reference serving process now refuses to boot unless the deployment
declares the supported single-installation posture:

- `PLATFORM_TOPOLOGY` must be absent or `single-installation`; `shared`,
  `multi-tenant` and `public-hosting` raise `UnsupportedTopologyError` before any
  database URL is read.
- `PLATFORM_EXTERNAL_TENANT_ONBOARDING` must not be enabled (`1`, `true`, `yes`);
  enabling it raises the same error.
- The message names F-012 and the required option A, so the operator sees why
  the posture is closed rather than a generic configuration error.

This is a fail-closed gate for the *residual*, not a substitute for the
decision: it does not enable RLS and does not make option B accepted. It is
proven by `tests/architecture/platform-deployment-topology.test.ts`, including a
spawned-process test that the refusal happens before the required database
variables are inspected.

## Non-goals of this record

- It does not enable RLS on any CMS table.
- It does not change grants, policies, runtime roles, or migrations.
- It does not accept option B; the topology gate only prevents the unsupported
  postures from being configured.
- It does not downgrade F-012 in the security review; the review text is
  unchanged.
- It does not authorize public hosting or external onboarding.

## Evidence index

- [SECURITY-REVIEW.md](../../../SECURITY-REVIEW.md) — F-012 role separation
  applied, RLS evaluated and deferred, runtime RLS unverified.
- [ADR-PLAT-003](adr/ADR-PLAT-003-tenant-transaction-rls.md) — tenant contract and
  its open blockers (R26, non-superuser deployment owner, views, independent
  review).
- `tests/architecture/platform-deployment-topology.test.ts` — fail-closed
  topology and onboarding gate, including a spawned-process refusal.
- [PROGRAM-EXECUTION-STATUS.md](PROGRAM-EXECUTION-STATUS.md) — F-012 residual row
  remains open; Wave 1 gate NO-GO.
- [0054_platform_tenant_rls.sql](../../../packages/database/migrations/0054_platform_tenant_rls.sql)
  — the only RLS migration applied.
- `tests/integration/platform-tenant-isolation.test.ts` — platform-table RLS and
  role-deny matrix.
- `tests/integration/runtime-multi-publication-isolation.test.ts` — application
  publication isolation.
- `tests/integration/platform-cms-studio-fixture-pack.test.ts` — pinned
  two-publication CMS/Studio compatibility baseline.
