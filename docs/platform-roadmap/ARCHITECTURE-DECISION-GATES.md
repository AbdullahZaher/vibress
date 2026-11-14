# Required Architecture Decision Gates — ADR-PLAT-001..010

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
| **009** | Code-first app frontend/custom runtime boundary | Public route/action extension with authenticated typed SDK and developer-owned web UI; IR for declarative metadata only | Promise 'any project' while delivering only CRUD/Admin or treat arbitrary TS as visual IR | M01/M04/M07 clean CRM test |
| **010** | Data retention, deletion, export and operations | Lifecycle policy, tenant offboarding, privacy ownership and measured SLO/RPO/RTO with compliance review as applicable | Assume row deletion removes every copy or promise universal legal compliance | M00 ownership; M02/M06 policy; M08 GA |

## ADR-PLAT-007/008 release-version collision (new M00 finding)

The **existing approved source** [ADR-013](../14-decisions/release-versioning-strategy.md) uses **unified SemVer**. The monorepo and Plugin SDK currently declare `1.2.0`, but the new roadmap originally advertised "Platform v1.0 GA"; production Compose also defaults `VIBRESS_VERSION` to `1.0.0`. These values must **not** be treated as an already supported new Framework 1.0 release. Before M07 package publication and M08 candidate selection, choose a unified product-version stream or formally approve a separate noncolliding Framework release namespace. Record package/tag/ABI/Studio compatibility, provenance and operator migration strategy. See [versioning matrix](RELEASE-VERSIONING-AND-SUPPORT-MATRIX.md).

**Decision state remains PROPOSED**. M08 is a milestone label, not a SemVer assertion; never silently supersede ADR-013.

## Security-focused decision refinements (PR review R26–R34)

**ADR-PLAT-001 — installation topology:** the v1 recommended physical boundary is a *dedicated PostgreSQL database and role set for each installed app*, with separately enforceable Redis ACLs/instances, storage bucket/IAM and deployment credentials. **Different role names or prefixes in the same shared public schema do not automatically isolate applications.** Shared-DB alternatives require evidence of equivalent effective ACLs and separate approval.

**ADR-PLAT-003 — RLS/privilege security:** test *effective* permissions, including inherited and **PUBLIC** default function EXECUTE, SECURITY DEFINER owner/search_path, permissive-OR policy composition, TRUNCATE/REFERENCES (not covered by RLS), and transaction-local context. A custom GUC is not authentication against arbitrary SQL.

**ADR-PLAT-006/009 — code trust:** custom developer-owned backend code is trusted within its dedicated runtime. A TypeScript port, runtime SDK, manifest capability or RLS GUC does not securely confine malicious server code that has access to the same process/credentials; Tier-1 plugins remain fully trusted in-process.

**ADR-PLAT-008 — releases:** approve API/Worker/Web/DB/Module/Event version-skew matrix and irreversible-backfill recovery before release. **ADR-PLAT-002/009** additionally define authenticated service-to-service cross-application APIs/events rather than shared SQL/queue credentials.

**M00 governance / ADR-PLAT-007:** register a testable customer/developer value hypothesis, competitor-matched proof tasks and real owner/capacity estimates; add required Markdown/epic/ADR consistency CI before claiming docs verification.

See [third review R26–R34](THIRD-REVIEW-AND-RATING-2026-11-14.md). These refinements do **not** change any ADR from PROPOSED to ACCEPTED.

## ADR status workflow

`proposed → reviewed → accepted (signed) / rejected (with rationale) → implemented (evidence) → verified (tests) → production approved (separate)`. Acceptance of an ADR is **not** implementation or security verification.

Each ADR must include:

- Scope, alternatives considered, tradeoffs, blast radius and examples for both CMS and independent CRM.
- Data ownership, app/tenant identity, upgrade boundary and permission/secret blast radius.
- Threat model, expected failure behavior and actual denial tests.
- Source references, affected `Mxx-Eyy` Epics and sign-off roles; exception expiry if the selected design departs from safe defaults.

## Decision sequencing

- **Before starting M01 runtime extraction:** accepted ADR-PLAT-001 and 002 plus a reviewed ADR-PLAT-003 transaction/security prototype; explicitly commit to no multi-app shared runtime v1 without a new gate.
- **Before any tenant-owned data path:** accepted ADR-PLAT-003 and working tenant-bound Postgres prototype; no external tenants during prototyping.
- **Before generated schemas/API are exposed:** ADR-PLAT-004, 005 and **009** + negative security and app custom-route conformance tests.
- **Before third-party modules:** ADR-PLAT-006 + independent consumer and upgrade checks.
- **Before v1 release candidate:** ADR-PLAT-007, 008 and **010**, scoped independent review, measured operational evidence and privacy/data-owner sign-off where applicable.

**Ownership:** architecture lead decides topology; database/security leads co-approve identity, RLS and migrations; plugin lead co-approves ABI/trust; release owner co-approves v1 scope and upgrades. Until owners are assigned, the status is BLOCKED FOR ACCEPTANCE, not implicitly approved.
