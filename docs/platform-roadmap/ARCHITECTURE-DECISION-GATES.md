# Required Architecture Decision Gates — ADR-PLAT-001..008

> **Status: PROPOSALS — none approved by this document.** M00 owners must review these choices, update existing ADRs or create new accepted ADRs, and record signatures/links before changing the production runtime.

| ID | Decision to approve | Proposed default | Rejected shortcut | Proof / milestone |
| --- | --- | --- | --- | --- |
| **001** | v1 runtime deployment/isolation topology | **One application per installation** (separate app DB credential and resource boundary), optional multiple tenants *inside* app with Postgres RLS | Multiple untrusted customer apps in one privileged Node process | M00 architecture ADR, M01 bootstrap, M02 threat tests |
| **002** | Principal/ownership/tenant vocabulary | Typed scopes: control-plane org/project/app/environment/installation vs runtime app-user/tenant/principal; CMS publication via adapter | Reuse `pub_default` as a universal application fallback | M01 contract tests, CMS data migration |
| **003** | Tenant transaction/RLS contract | No tenant-owned repository access without trusted app/tenant context; use exact transaction/connection; nonowner DB runtime; no arbitrary plugin SQL | Merely setting a client-provided custom GUC or relying on ORM filters | M02 real Postgres checks |
| **004** | Schema DSL and DDL authority | Validated canonical IR → deterministic migration plan → distinct installer actor/DB role and approval | Accept raw SQL or unreviewed DDL from an API user, visual builder or agent | M03 compiler and migration tests |
| **005** | Generated authorization and query limits | Default-deny server-side policies before query composition and after response projections; exports/search/jobs included | Treat UI hidden fields or generated schema visibility as sufficient | M04 negative conformance |
| **006** | Module ABI and trust | Extend *existing* Plugin SDK; explicit platform/SDK/ABI compatibility, operator-trusted Tier-1; no untrusted ESM | Publish `private` SDK as-is or claim node:vm is isolation | M05 external pack/upgrade proof |
| **007** | Code-first v1 scope | CMS regression + clean CRM + secure REST/OpenAPI/admin + minimal trusted modules + job/outbox + CLI + real PG isolation; others optional | Gate all five Golden Apps and Wix-like editor on v1 | M07/M08 scope ledger |
| **008** | Upgrade and release semantics | Expand/contract, compatibility windows, evidence-led GA approval, reversible app rollback or documented forward-fix/restoration | Promise automatic schema downgrade with zero data loss | M08/M11 recovery drill |

## ADR status workflow

`proposed → reviewed → accepted (signed) / rejected (with rationale) → implemented (evidence) → verified (tests) → production approved (separate)`. Acceptance of an ADR is **not** implementation or security verification.

Each ADR must include:

- Scope, alternatives considered, tradeoffs, blast radius and examples for both CMS and independent CRM.
- Data ownership, app/tenant identity, upgrade boundary and permission/secret blast radius.
- Threat model, expected failure behavior and actual denial tests.
- Source references, affected `Mxx-Eyy` Epics and sign-off roles; exception expiry if the selected design departs from safe defaults.

## Decision sequencing

- **Before starting M01 runtime extraction:** accepted ADR-PLAT-001 and 002; explicitly commit to no multi-app shared runtime v1 without new gate.
- **Before any tenant-owned data path:** accepted ADR-PLAT-003 and working tenant-bound Postgres prototype; no external tenants during prototyping.
- **Before generated schemas/API are exposed:** ADR-PLAT-004 and 005 + negative security tests.
- **Before third-party modules:** ADR-PLAT-006 + independent consumer and upgrade checks.
- **Before v1 release candidate:** ADR-PLAT-007 and 008, scoped independent review, immutable evidence.

**Ownership:** architecture lead decides topology; database/security leads co-approve identity, RLS and migrations; plugin lead co-approves ABI/trust; release owner co-approves v1 scope and upgrades. Until owners are assigned, the status is BLOCKED FOR ACCEPTANCE, not implicitly approved.
