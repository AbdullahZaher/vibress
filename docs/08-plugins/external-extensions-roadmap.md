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
| EXT-001 | Inventory **both** `@vibress/plugin-sdk.PluginModule` and `plugin-core.VibressPlugin` consumers, repair developer docs/examples, choose canonical runtime ABI | Signed-off SDK adapter mapping; bundled v1 and any supported legacy shapes validated; lifecycle callbacks preserved |
| EXT-002 | Threat model + ADR for trusted package format, **external release digest/attestation**, plugin admission, UI/worker surfaces | Security/Architecture/Ops agree no circular digest or false JS sandbox claim |
| EXT-003 | Inspect existing global plugin settings/status plus dual SDKs, hooks, member/public privacy middleware, DB migration baseline | Compatibility matrix, **no automatic cross-publication enable/settings copy**, upgrade and negative-case fixtures checked in |
| EXT-004 | Approve versioned typed repositories, authority-bound Member/public context, Next.js renderer/assets, SDK package boundaries and billing bridge | Shared schemas compile in independent SDK consumer, Member publication mismatch denied, no `unknown` transaction contract |

**Exit:** platform technical design approved, no implementation assumed.

## Phase 1 — Trusted external package lifecycle (P0)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-101 | Immutable trusted artifact + externally pinned digest/signature, deterministic deployment, archive allowlist and admission | Tampered final bytes, self-referential checksum, symlink/path escape, unknown package, multi-node/restart rejected |
| EXT-102 | Canonical `plugin-sdk` protocol negotiation and explicit `plugin-core` compatibility decision/adapter (only for proven consumers) | Unknown or mixed protocol rejected; `activate/deactivate/onEvent` semantics and SDK v1 plugin verified |
| EXT-103 | `installation` vs `publication enablement` schema, legacy status/settings adapter and explicit operator enablement | Fresh/upgrade with legacy global plugin/settings data, secrets not copied, no unexpected enablement, concurrency |
| EXT-104 | Activation/deactivation actual callbacks, event dispatch name, admission stop, drain and health | Correct eventName, hook missing not falsely successful, cleanup invoked, failure/retry/in-flight tests |

**Exit:** independently built sample package can be deployed by operator and enabled for publication A but not B, with no private import or dynamic Admin upload.

## Phase 2 — Host-mediated API and data (P0)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-201 | Admin/member/public namespaced route descriptor registry and shared contracts; host-owned auth + origin + limits | 401/403/404, forged tenant, collision, schema error, rate limits |
| EXT-202 | Authority-bound principal/publication, Member-publication equality check, site privacy and per-call capability enforcement | Member from B denied on A, forged ID ignored, mixed cookies, event/job scope and privacy tests |
| EXT-203 | Namespaced schema migrations + **typed publication-scoped repository contracts**, schema ownership and core Member FK review | No raw transaction/SQL exposed, incompatible member FK rejected, expand/backfill/crash/retry/large data tests |
| EXT-204 | Versioned, scoped member/entitlement/content read bridges as needed by pilot | No payment authority bypass; wrong member/plan/publication denied |

**Exit:** API can manage plugin-owned course and enrollment through **public SDK only**, not `@vibress/database` or private domain deep imports.

## Phase 3 — Admin/Web/Theme extension points (P1)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-301 | Declarative nav, version/hash-addressed admin assets or reviewed iframe, CSP and translations | Forbidden origin/token leak, stale cache/disabled route, keyboard/RTL/long text tests |
| EXT-302 | Next.js reserved dispatcher, site privacy, theme fallbacks, SSR cache and locale/SEO policy | No private/hydration leak or route collision, 404, canonical/hreflang, preview/disabled tests |
| EXT-303 | Sanitized view-model/theme slot and accessible fallback | External Liquid + built-in themes, escaping, Arabic/RTL, no slot |
| EXT-304 | Docs + SDK reference implementation and independent plugin build/test workflow | Docs builds, sample package passes consumer contract CI |

**Exit:** LMS admin and public course page display using declared contributions, without modifications to individual core themes.

## Phase 4 — Async, operations and hardening (P1)

| Ticket | Deliverable | Required tests |
| --- | --- | --- |
| EXT-401 | Versioned worker task/event artifact resolution, real dispatch, idempotency, stop/drain and dead-letter | Named events, process restart, incompatible replica, retry/replay/crash/disable tests |
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
