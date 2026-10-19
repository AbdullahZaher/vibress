# External plugin platform: implementation roadmap

**Status: PROPOSED; no tickets are implemented by this document.**  
**Anchor:** current Vibress `main` reviewed 2026-10-19.  
**Outcome:** external operator-installed trusted package runs end-to-end, without plugin-specific core edits.  
**Pilot:** `vibress-lms` (separate private repository).

## Delivery principles

Small additive PRs, one platform concern per ticket; never rewrite released migrations. Use a representative existing pattern before implementing; review consumers and keep changes scoped. Validate with progressively broader tests. Preserve backwards compatibility for existing bundled plugins and theme consumers. The roadmap orders **dependencies, not dates**.

## Phase 0 — Baseline and design approval (blocker)

| Ticket | Implementation deliverable | Acceptance gate |
| --- | --- | --- |
| EXT-001 | Reconcile `docs/developer/plugin-sdk.md` and sample plugin with actual `PluginModule`/`SDK_VERSION`, flag mock isolation | Buildable published example; docs contain no false sandbox claims |
| EXT-002 | Threat model + ADR for operator-installed trust, plugin admission and extension surface | Security, Architecture, Ops sign-off; arbitrary remote code stays disabled |
| EXT-003 | Contract inventory of every plugin consumer/route/settings/job + existing migration baseline | Backward-compatibility matrix and negative-test inventory checked in |
| EXT-004 | RFC contracts reviewed against Next.js routing, API namespace, Studio, storage and billing constraints | Versioned schemas and permission vocabulary approved, no fake capability behavior |

**Exit:** platform technical design approved, no implementation assumed.

## Phase 1 — Trusted external package lifecycle (P0)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-101 | Immutable operator-managed package registry/lockfile and artifact checksum verification; deterministic Docker deployment | Tampered artifact, path escape, unknown package, restart/redeploy |
| EXT-102 | Host API compatibility negotiation + shared runtime manifest schema; continue accepting legacy bundled manifests with adapter | Unsupported version/capability rejected; existing plugin passes |
| EXT-103 | `installation` vs `publication enablement` state machine; additive DB schema, backfill & compatibility adapter | Fresh/upgrade with legacy data, concurrent enables, wrong publication |
| EXT-104 | Enable/disable/upgrade sequencing, lifecycle errors, admission stop and health reporting | Failed activation, duplicate requests, in-flight disable, clean retry |

**Exit:** independently built sample package can be deployed by operator and enabled for publication A but not B, with no private import or dynamic Admin upload.

## Phase 2 — Host-mediated API and data (P0)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-201 | Admin/member/public namespaced route descriptor registry and shared contracts; host-owned auth + origin + limits | 401/403/404, forged tenant, collision, schema error, rate limits |
| EXT-202 | Scoped minimal `PluginContext`: principal, publication, locale, request ID, permission and capability services | Mixed staff/member cookies, tenant spoofing, XSS/sensitive fields |
| EXT-203 | Plugin-owned schema migration registry and namespaced typed data services | Expand/backfill, crash/retry, duplicate migration, large existing DB |
| EXT-204 | Versioned, scoped member/entitlement/content read bridges as needed by pilot | No payment authority bypass; wrong member/plan/publication denied |

**Exit:** API can manage plugin-owned course and enrollment through **public SDK only**, not `@vibress/database` or private domain deep imports.

## Phase 3 — Admin/Web/Theme extension points (P1)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-301 | Declarative admin navigation, registered isolated view container, translation catalogue | Staff permission, CSP, keyboard, RTL, long text, disabled plugin |
| EXT-302 | Reserved public page dispatcher + SEO and locale-aware metadata | Route collisions, 404/private, canonical/hreflang, preview |
| EXT-303 | Sanitized view-model/theme slot and accessible fallback | External Liquid + built-in themes, escaping, Arabic/RTL, no slot |
| EXT-304 | Docs + SDK reference implementation and independent plugin build/test workflow | Docs builds, sample package passes consumer contract CI |

**Exit:** LMS admin and public course page display using declared contributions, without modifications to individual core themes.

## Phase 4 — Async, operations and hardening (P1)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-401 | Namespaced worker task/event contracts + idempotency, stop/drain and dead-letter visibility | Retry, replay, crash, out-of-order, disabled plugin |
| EXT-402 | Settings per publication, encrypted secret rotation, audit and operator views | Masking, cross-publication secret denial, corrupted secret |
| EXT-403 | Backup/export/purge semantics, upgrade preflight and rollback runbooks | Restore, irreversible schema, uninstall preserves content |
| EXT-404 | Supply-chain attestation, scanner checks, health/metrics and self-hosted deployment docs | Production image install, no hidden network dependency |

**Exit:** rollout-ready operator workflow and incident playbook.

## Phase 5 — LMS pilot / release gates

| Ticket | Deliverable | Acceptance gate |
| --- | --- | --- |
| EXT-501 | End-to-end `vibress-lms` course + lesson + enrollment vertical slice across API/Studio/Web | Public route, authorized learner, unauthenticated/unauthorized denied |
| EXT-502 | Two-publication, two-theme, two-locale acceptance matrix | No cross-tenant leaks, Arabic RTL, safe SEO, accessible fallback |
| EXT-503 | Fresh install, upgrade old production-like data, disable/reenable and restore | Data remains intact, documented recovery, zero core LMS edits |
| EXT-504 | Contract freeze and versioned SDK docs + changelog and support matrix | Release approved by Architect, Security, DB, API, QA and Ops |

**Exit:** after review, mark shipped features as implemented in docs and announce stable vNext SDK. Do not label ready earlier.

## Dependency order

`EXT-001..004 → EXT-101..104 → EXT-201..204 → EXT-301..304 → EXT-401..404 → EXT-501..504`.

Within phases, run independent contract/test/docs work concurrently where possible; API policy precedes UI exposure, and data ownership precedes enrollment. Optional vanity URLs, one-time commerce bridge, untrusted sandbox and marketplace are **post-pilot**, separately approved initiatives.

## Definition of done (every ticket)

- Scoped code diff, appropriate role review, no unrelated file edits.
- Positive, negative, unauthorized, wrong-publication, disabled and failure-path tests when relevant.
- No private SDK imports, no unvalidated external input, no unsafe TypeScript escapes; published compatibility or migration notes.
- Fresh install and upgrade paths tested; Docker/self-hosting, instrumentation, i18n/RTL/accessibility/theme/plugin effects reviewed.
- Narrow package tests, relevant integration and E2E gates, CI green; no false claims about any unrun check.
- Document `Status / Role Review / Changed / Validation / Compatibility / Security / Blockers` before review.

## Risks and decision checkpoints

1. `node:vm`/in-process JS not secure for unknown publisher code: **block runtime upload**; maintain operator-vetted trust only.
2. Existing package `version` and `SDK_VERSION` differ: publish negotiation policy before advertising API.
3. Next.js cannot safely install arbitrary app routes at runtime by convention: approve reserved dispatcher design first.
4. Legacy global plugin rows and settings need safe adapter/migration; no sweeping rebuild.
5. Billing subscriptions do not equal one-time purchases or course access rules: explicitly scope pilot and build entitlements separately.

### Measure success

- Zero cross-publication/auth boundary failures; all negative-path suites green.
- Operator can deploy two versions and restore previous compatible code with data preserved.
- LMS pilot compiles against only its documented SDK contracts; no plugin-specific core patches.
- Built-in and external themes render an accessible default public LMS page, including Arabic/RTL.
- No external proprietary service required for basic plugin operations.
