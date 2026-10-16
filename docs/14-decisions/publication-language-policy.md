# ADR — Publication-Scoped Language Policy (Single Language by Default)

**Decision:** Accepted — normative product and architecture policy  
**Date:** 2026-10-16  
**Implementation:** Planned; **not** a claim that the running product already conforms  
**Scope:** Setup, Admin/Studio, public web, API, content models, translation workflow, themes, plugins, SEO, migrations  
**Supersedes:** Any documentation or code-level assumption that English is always the source/default publication language, that Arabic is implicitly enabled, or that multilingual tools must appear on a single-language publication.

> Historical implementation and certification reports remain evidence of their original scope and date, **not** verification of this policy. See [implementation plan](../development/LOCALIZATION_POLICY_IMPLEMENTATION_PLAN.md).

## 1. Decision

A Vibress **publication** starts with exactly one explicitly selected **primary language** and no additional language enabled by default. First-run onboarding chooses this primary language. An authorized publication owner/administrator can maintain its configuration under `/admin/settings`.

When exactly one publication language is active, the site operates as a **single-language publication**: the public site and publication Admin interface use that language, while translation navigation, editor panels and generation actions are not offered. When a second or subsequent language is explicitly activated, the translation workspace, matrix, queue and their settings become available to staff with the appropriate permissions.

**No English-to-Arabic pair is privileged.** Translation source and target languages derive from the publication's actual source content and enabled locale configuration. Adding a language does not automatically translate, publish or send content to an AI provider.

## 2. Definitions and ownership

| Term | Definition | Scope |
| --- | --- | --- |
| Primary locale | Language of newly authored original content and default public URLs | Publication |
| Enabled locales | Unique active set of content locales; always includes primary | Publication |
| Admin UI locale | Language of administrative chrome, menus, forms, validation and help text; initially follows the publication primary locale | Publication UI context |
| Editing locale | Language of the specific content field/editor in focus; controls input direction independently from Admin chrome | Document/field |
| Request locale | Public visitor's requested language, validated against the publication's enabled set | Request |
| Translation source locale | Persisted language of the source item, **not** hard-coded `en`; changing primary locale never silently re-labels existing source content | Content item |
| Translation target locale | An enabled locale different from the item's source locale | Content translation |

### Canonical state

- `publications.primary_locale` is the target **canonical** primary-locale record.
- `publication_locales` is the target canonical record of publication-supported/active locales and default marker.
- Legacy `site.locale` must remain an explicit **compatibility projection** until its consumers migrate; never allow independent contradictory writes. Do not create a second persistent source of truth called `enabledLocales` inside unrelated settings.
- Implement a publication-scoped domain resolver/service exposing a typed effective configuration and a single validated update operation. Route/UI code consumes this service or its API contract, not raw database tables.
- Canonicalize and validate BCP 47-style locale tags consistently (`ar` vs `ar-SA`, case normalization, duplicate detection). Do not equate distinct locale variants by substring matching.
- Invariant: one and only one primary, at least one enabled locale, primary is enabled, no duplicate effective locales. Update the primary/default markers and compatibility setting atomically.

The existing database tables are an implementation starting point, not proof that those invariants are currently enforced.

## 3. Mode contract

| Configuration | Admin interface | Public website | Translation management |
| --- | --- | --- | --- |
| Primary `en`; enabled `[en]` | English-only UI, LTR | English-only content, default unprefixed routes | Hidden/inactive |
| Primary `ar`; enabled `[ar]` | Arabic-only UI, RTL | Arabic-only content, default unprefixed routes | Hidden/inactive |
| Primary `ar`; enabled `[ar,en]` | Arabic UI; target-field direction follows target | Arabic at default routes, English at localized routes | Visible with permissions |
| Primary `en`; enabled `[en,fr]` | English UI | English default, French localized | Visible with permissions; no implicit Arabic |

- A single enabled locale means **no** translation menu, matrix, translation editor sidebar, AI translation action, or language switcher on the public site. Preserve historical translation rows; do not delete them.
- Multiple locales enable those features, subject to RBAC and publication ownership. Route guards and server-side write validation must enforce the policy independently of hidden UI.
- Existing authorized staff read/export/recovery flows may retain access to historical records through explicitly permissioned maintenance interfaces; no disabled translation may leak through public endpoints.
- Locale additions must be opt-in. Turning off a locale never erases translations or rewrites original content. Display publication impact, active URLs and pending translations before a change.
- The initial certified **Admin UI** dictionaries must cover the entire surface for English and Arabic. **Onboarding/settings must not offer an uncertified locale as a fully supported primary Admin UI language.** Adding another primary-language choice requires complete dictionary coverage, native-language QA and RTL/accessibility certification where applicable. Additional content-translation targets can be enabled independently. A locale registry entry alone is **not** a claim of fully localized Admin UI.
- Before setup is completed, the wizard itself must honor the chosen language immediately and preserve accessibility; after setup, login/error/recovery routes also resolve the publication UI language. Avoid silent English fallback for visible strings in a certified Arabic interface; missing translations are test failures.

## 4. Onboarding and owner settings

1. First-run setup presents an explicit primary language selection; default selection can be English until the owner chooses another value. Choosing Arabic makes Arabic the persisted default on completion.
2. Optional additional content languages are unselected initially. Selecting one or more explicitly enables multilingual workflows **only after** successful setup.
3. Both new and existing publications can manage the same language configuration from `/admin/settings`, with a clear primary indicator, add/disable controls, impact preview and confirmation for risky changes.
4. Persist related state within a transaction. Maintain setup-token, installation gate, role/permission and origin protections. Do not introduce partial setup when validation or persistence fails.
5. Changing the primary on an existing populated publication is **not** a simple text-field edit: require an explicit, reversible reclassification/content migration process or block with an actionable error. Original posts/pages presently lack an independent source-locale column; account for their existing language before changing the primary.

## 5. Public web, SEO and language negotiation

- Unprefixed `/`, `/posts/...` and `/pages/...` are **always the publication's actual primary locale**, whether `en`, `ar` or any supported primary language. Do not unconditionally redirect `/en` to unprefixed or assume Arabic must use `/ar`.
- Non-primary locales use canonical locale-aware prefixes only while enabled. Explicit URL locale takes precedence over passive `Accept-Language`; neither is permission to activate a disabled locale.
- Invalid/disabled locale routes must not serve unrelated content or an arbitrary fallback. Choose a stable not-found response (or a safe explicit canonical redirect for exact aliases), and handle historic URLs deliberately.
- Serve only publishable translations matching the requested enabled locale; a missing translation must not silently show unrelated source-language text on a localized route.
- Resolve `<html lang>`, `dir`, localized navigation, RSS/feed language, canonical URLs, sitemap and `hreflang` from the same effective publication locale policy. Emit alternates only for genuinely published, enabled variants and `x-default` only when appropriate.
- Cache keys and invalidation must incorporate publication identity and relevant locale configuration so a language change cannot serve stale or cross-publication output.

## 6. Security, data integrity and extensibility

- Every locale read or mutation is scoped to **authoritative** publication context; never trust a caller-supplied `publicationId` as authorization.
- Staff endpoints retain `requireStaffSession`, granular `requirePermission(...)`, origin validation for writes, strict runtime schemas in `@vibress/api-contracts`, and stable error contracts/request IDs.
- Translation create/AI/bulk actions reject disabled or source-equal targets, and enforce publication ownership before revealing record existence. A single-language publication cannot generate or publish a new secondary-locale translation through a direct API call.
- Preserve existing revisions, locale-tagged content, media references, translation groups, historic slugs, plugins/themes/webhook contracts and stored Studio/JSON documents. Do not delete old data on language disable.
- Themes and plugins access resolved locale + direction + enabled locales via documented context/contracts, not private tables. A language switcher must hide itself when no alternative locale is enabled.
- For AI translation, derive the source language from the item; translate all intended text nodes of structured content while preserving document shape, links and non-translatable fields. Never claim that copied source-body text is translated. A provider outage must not create a misleading completed translation. Human review remains required.

## 7. Upgrade policy and rollout

1. **Inventory before mutation:** read `site.locale`, `publications.primary_locale`, `publication_locales`, existing translation rows, published URLs and theme/plugin assumptions per publication.
2. **Reconcile intentionally:** legacy `site.locale` and `primary_locale` may disagree. No blanket `en` reset; log/report conflicts and require a deterministic reconciliation strategy that preserves an explicitly configured locale.
3. **Preserve active locales and public URLs:** where `publication_locales` is populated, inspect active rows and their default marker. Where no explicit active set exists, do not infer that `ar-SA` is active because a hard-coded fallback existed, nor activate languages from draft/history rows alone. **If any historic translated variant is actually publicly served, inventory it and block strict-mode cutover until the owner/operator reconciles its active-locale status or a temporary compatibility path preserves the URL.** New installations activate only the chosen primary. Existing translations remain intact for deliberate recovery/reactivation.
4. **Additive migrations only:** never rewrite released migrations. Inspect generated SQL, existing rows and indexes, backfill/lock characteristics, and fresh-install versus upgrade behavior. Prefer staged reads, shadow checks and a guarded cutover to changing behavior and routing.
5. **Operational safety:** document backup and rollback procedure, configuration diff, cache invalidation and reversibility. Ensure PostgreSQL/Redis/Docker self-hosting works without new proprietary dependencies.
6. **Change management:** publish operator warnings for primary-locale changes and disabling a previously public language. Avoid implicit content rewrites, silent destructive actions and unexpected SEO redirects.

## 8. Acceptance gates

- Fresh `en`-only and `ar`-only setups: correct Admin/login/setup text, public content, `lang`/`dir`, and zero translation widgets/actions.
- Multi-locale `ar→en` and `en→fr`: correct source/target, matrix/queue, publication ownership, review flow and no implicit `ar` injection.
- API adversarial tests: invalid locale, duplicate locale, disabled target, source-equal target, unauthenticated/unauthorized user, cross-publication record, direct route/bulk/AI bypass, stale settings.
- Public tests: disabled URL and `Accept-Language`, missing/unpublished translation, slug collision, canonical redirect, `hreflang`, sitemap, RSS and cache isolation.
- Upgrade fixtures: legacy explicit Arabic settings, default English installs, pre-existing bilingual translations, mismatched primary/settings, historic slugs and disabled-language reactivation.
- Admin localization: full English/Arabic key coverage, mixed-direction content, keyboard and screen reader navigation, dialogs/errors, responsive layouts.
- Progressive gates: focused unit, domain, API/integration and E2E tests, typecheck, lint, relevant build, scoped diff review. No production-complete claim before these pass.

## 9. Implementation tracking

Execution order: **T1 canonical policy and migration safety → T2 setup/settings → T4 feature/API gating → T3 complete Admin localization → T5 public routing/SEO → T6 full translation/upgrade verification**. Detailed file map, acceptance cases and deployment gates: [Localization Policy Implementation Plan](../development/LOCALIZATION_POLICY_IMPLEMENTATION_PLAN.md).

**Policy acceptance is not code rollout.** Until the implementation and CI checks complete, behavior described here is the required future contract, not an assertion about the deployed application.
