# Localization Policy — Engineering Implementation Plan

**Status:** T1–T6 implementation in progress on `feat/publication-locale-policy-ticket-1`. Some features are coded but not production-certified; full Admin localization, upgrade cutover decisions, and validation remain open. Tests, lint, typecheck, builds, and CI have not yet been run.  
**Decision date:** 2026-10-16  
**Canonical policy:** [Publication-Scoped Language Policy](../14-decisions/publication-language-policy.md)  
**Repository baseline reviewed:** `main`, tree `94751ae25a85e4f11e23cfd9be5beccaf1a7282e`  
**Change constraint:** small additive, publication-scoped, upgrade-safe steps; no unrelated refactors or released-migration rewrites.

## Current branch implementation inventory (unverified)

The following features have been added to the implementation branch; **this is not a
claim of passing tests or production readiness**:

- **T1:** Publication-scoped locale service and compatibility bridge for
  `site.locale` and canonical publication tables, with conflict and published
  URL guards. Database migrations were not rewritten.
- **T2:** Optional additional languages in the onboarding payload and UI;
  language controls under existing `/admin/settings`; primary UI selection
  currently limited to the certified-language targets English and Arabic.
- **T4:** Translation matrix/navigation/sidebar routing gated by multilingual
  state and permissions; typed mutation validation, source/target checks and
  workflow status authorization on create/edit/publish/bulk/AI paths.
- **T3 (partial):** Shared Admin language context and English/Arabic UI
  translations for setup, login, sidebar, settings, core editorial lists,
  post/page editor labels, member lists, tags and media search. **Other
  administrative screens, portal surfaces and several error/interaction paths
  still contain English strings. Arabic UI parity is NOT certified.**
- **T5 (partial):** Dynamic locale routing, public API enabled-locale checks,
  theme locale context, published-only alternates, sitemap generation and safe
  redirects for unique historical published slugs. Pagination, SEO, plugin/theme
  coverage and upgrade redirect matrices remain to be certified.
- **T6 (partial):** Structured text extraction supports Studio documents
  and top-level legacy plain-text bodies, preserving media/IDs. AI failures
  cannot create fake drafts, and existing records cannot be silently overwritten.
  Editorial review and approval are required before publication. Additional
  content formats, provider integration and safe draft revisioning still
  require certification and explicit decisions.

**Remaining release blockers:** entire Admin UI dictionary parity and RTL/a11y
review; prior-public-URL inventory and primary-locale reconciliation for
populated upgrades; source-language persistence policy for existing content;
public SEO/sitemap limits and plugin/theme compatibility review; full unit,
integration, E2E, typecheck, lint, build and populated-DB upgrade checks. Tests
have been added but not executed, per the requested coding-first sequence.

## 1. Current-code evidence and gaps

| Current source | Verified behavior / gap | Target |
| --- | --- | --- |
| `apps/admin/src/features/setup/SetupWizard.tsx` | Primary language selector defaults to `en`; no additional-languages selector; screen labels are English strings | Persist exactly one selected primary unless owner adds more; localize setup |
| `packages/domains/setup/src/application/setup-service.ts` | Persists `site.locale`; does not establish a canonical active locale set | Initialize canonical publication locale state consistently |
| `packages/database/src/schema/publications.ts` | `primaryLocale` defaults to `en`; `publicationLocales` table exists | Reuse schema, enforce effective-state invariants |
| `packages/domains/settings/src/application/settings-service.ts` | Exposes `site.locale`; `enabledLocales` is not a registered setting definition | A single publication-scoped resolver/write path, compatibility projection |
| `apps/admin/src/components/settings/general/LocalizationCard.tsx` | Single editable string locale; no enabled-locale lifecycle | Owner-friendly primary/add/disable controls with impact checks |
| `apps/admin/src/components/AdminShell.tsx` | Independent `en`/`ar` toggle changes document direction/language, not all text | Admin UI follows configured locale with complete dictionaries |
| `apps/admin/src/components/layout/sidebar/NavContent.tsx` | Translations navigation always renders | Show only if >1 enabled locale and permitted |
| `apps/admin/src/components/translations/TranslationMatrix.tsx` and `TranslationSidebarSection.tsx` | Fallback `[en, ar-SA]` | Read effective enabled set; hide in single-language mode |
| `apps/admin/src/components/translations/TranslationEditor.tsx` | Defaults target to `ar-SA` | Require valid enabled target; never implicit Arabic |
| `apps/api/src/routes/translations.ts` | Defaults to `[en, ar-SA]`, explicitly appends Arabic; `getRawSettings("site")` is called without authoritative publication ID; AI prompt translates title/excerpt while copying body | Scoped configuration, target validation, honest structured AI drafts |
| `apps/api/src/routes/content.ts` | Uses requested locale and `Accept-Language` without enabled-locale validation, explicit `ar-SA` slug fallback, several `"en"` response fallbacks | Publication-aware strict locale negotiation and safe public rendering |
| `apps/web/src/middleware.ts` | Unconditionally treats English prefix as default and allows hard-coded locale prefixes | Configurable primary and enabled prefixes; correct canonicalization |
| `apps/web/src/app/sitemap.xml/route.ts` | No locale alternate enumeration | Published enabled variants and `hreflang` |
| `packages/database/src/schema/posts.ts` / `pages.ts` | No explicit language column for existing source records | Safe primary-language change and source-language preservation |

This is a **static code review**, not runtime proof. Verify all consumers and live DB state before modifications.

## 2. Minimal delivery sequence

### T1 — Publication locale resolver and compatibility (P0)

**Owners:** Architect, Database/Migration Engineer, API Designer, Security Reviewer.

- Inspect existing `site.locale`, `publications.primary_locale`, `publication_locales` and translation usage across domains, APIs, workers, themes and plugins; document the precedence and conflict treatment before writes.
- Implement a publication-scoped domain service backed by existing Drizzle schema, exposing `primaryLocale`, `enabledLocales`, `isMultilingual` and locale-resolution helpers through public domain exports.
- Introduce Zod contracts in `@vibress/api-contracts` for configuration read/update; one transactional update atomically enforces primary/default membership, unique tags and synchronized legacy `site.locale`. For legacy sites serving localized content without explicit active-locale rows, reconcile published URLs before enforcing single-language mode; never silently retire live URLs.
- Scope all reads/writes to authoritative staff/request publication context. Do not use a raw client tenant ID or an implicit `pub_default` when an authoritative context exists.
- Add a *new* migration only for constraints or data work genuinely required after schema inspection. Leave released migrations intact; prefer zero-downtime-compatible backfills.

**Done when:** freshly created English/Arabic publications resolve to exactly one locale; existing explicit configurations are preserved; conflict fixtures are covered; no unscoped locale reads remain in translation endpoints.

### T2 — First-run onboarding and /admin/settings (P0)

**Owners:** Implementer, API Designer, Security Reviewer, i18n/RTL.

- Preserve existing setup-token, origin, installed-state and owner-creation gates.
- Expose a primary selector limited to fully certified Admin UI languages (English/Arabic initially) plus optional unchecked additional content languages in setup; store canonical state and site compatibility value as one consistent bootstrap operation. Additional content languages may have translation support before their full Admin UI is certified.
- Add owner language management to the existing Settings hub, not a second disconnected settings surface. Include native language labels, default marker, add/disable confirmation, populated-site primary-change guard and accessible error messages.
- Handle partial failures and invalid/unsupported tags without leaving inconsistent setup or locale rows.

**Done when:** single-language installs have only the selected active locale; owner settings round-trip consistently; restricted users cannot mutate languages; Arabic setup renders RTL.

### T4 — Translation feature gates and API validation (P0)

**Owners:** Security Reviewer, API Designer, Implementer, QA.

- Drive `NavContent`, route boundaries, editor translation sidebars, matrix, queue and AI actions from the effective locale set **and** RBAC. Do not fetch or expose feature controls in single-language mode.
- Protect direct navigation and every mutating admin translation endpoint; reject disabled/source-equal targets, including bulk and AI. Preserve historical rows and read/export/recovery access under explicit permissions.
- Remove hard-coded English/Arabic target fallbacks; make target locale explicit in Translation Editor and admin API.
- Retain current error formats, audit logging, origin/session guards and publication-owned record checks.

**Done when:** translations cannot be generated/published to an inactive locale by direct HTTP calls or UI workarounds; bilingual publication workflows remain permission-scoped.

### T3 — Complete Admin interface translation (P0)

**Owners:** i18n/RTL, Implementer, QA.

- Introduce centralized locale context for Setup, Login, AdminShell, settings, command palette, editors, translation tools, membership and errors.
- Replace hard-coded UI text with dictionary keys; require English/Arabic parity and readable locale-specific error strings; do not claim a language is UI-complete before certification.
- Keep field editing direction independent of Admin chrome; support Arabic and mixed-script URLs/numbers, keyboard access, focus order, screen readers and responsive layout.
- Remove or re-specify the independent `en`/`ar` interface toggle so it cannot override publication policy.

**Done when:** English-primary sites are fully English UI; Arabic-primary sites are fully Arabic UI including setup/login/errors; no inadvertent mixed-language fallback in covered surfaces.

### T5 — Public locale routing, theme contracts and SEO (P1)

**Owners:** Architect, API Designer, Plugin/Theme Reviewer, i18n/RTL, QA.

- Resolve request locale against publication policy in public APIs and Next.js middleware; make **any** enabled primary locale unprefixed, including Arabic. Accept-Language must not force a disabled locale.
- Remove hard-coded `ar-SA` slug guessing; return stable not-found for missing/unpublished or disabled translations without exposing source content across language boundaries.
- Update `getLocalePrefix` consumers to provide actual primary locale. Use `lang` and `dir` from request context, including RSS, canonical links, sitemap and published-only `hreflang`.
- Expose enabled languages to themes/plugins via supported context only; hide theme language switchers when there is no alternative language, while maintaining backwards-compatible templates.
- Add publication+locale-aware cache invalidation, slug collision tests and canonical-link QA.

**Done when:** `ar`-only default URLs are unprefixed, `en`-only defaults are unprefixed, and mixed published locales are indexed consistently without serving disabled content.

### T6 — Structured AI translation, upgrade rehearsals and final verification (P1)

**Owners:** Implementer, QA, DB/Migration Engineer, Security Reviewer, Plugin/Theme Reviewer.

- Translate intended structured text fields while preserving Studio document shape, revisions, immutable identifiers, media, links and non-translatable data. AI provider failure must return an explicit failure or a clearly incomplete draft, never a fake translated success.
- Keep AI work review-gated and idempotent/retry-safe where queued; verify source-language detection and glossary pair selection are not fixed to English.
- Validate fresh-install and upgrade fixtures, translation preservation on language disable/reactivation, primary-language change guards, themes/plugins/webhooks and Docker-backed PostgreSQL/Redis operation.
- Run focused tests, API/security suites, browser RTL/accessibility, typecheck, lint, build, migration checks and scoped diff review before release.

**Done when:** no source-body copy masquerades as a translated document and all policy acceptance gates are satisfied.

### T1 API contract introduced on the implementation branch

- `GET /api/admin/v1/locales` returns the publication-scoped `primaryLocale`, `enabledLocales`, `isMultilingual` and `needsReconciliation` fields (requires `settings.read`).
- `PUT /api/admin/v1/locales` accepts `{ "primaryLocale": "...", "enabledLocales": ["..."] }` for the **authenticated publication only** (requires `settings.manage`, origin verification and runtime Zod validation).
- The legacy `PUT /api/admin/v1/settings/site/locale` path is retained via the canonical service. Changing a populated publication's primary locale returns a conflict until a deliberate content migration is available.
- The existing `publication_locales` and `publications.primary_locale` schema is reused; no released migration is rewritten.
- **Limitations:** public locale routing, full UI localization and all translation write/visibility gates are tracked separately in T3–T5. New unit/integration tests have been committed but **not executed or certified** in this environment.

### Additional implementation hardening (unverified)

- Translation creation and AI generation are **create-only** with source-row
  transaction serialization. Requests for an already existing target locale
  return a conflict instead of silently overwriting a published/draft record.
- Translation publication now requires an explicitly **approved** status, and
  approval requires a review-stage item. Generic edits cannot modify a live
  approved/published translation without reopening its workflow.
- Public translation reads are **published only**; approved/translated states
  are never returned publicly, even while legacy locales need reconciliation.
  Localized public title/excerpt/SEO never silently inherit untranslated source
  text, and source visibility/deletion checks are mandatory.
- Content-model relation locale resolution preserves non-localized metadata
  objects, while public localizable fields fail closed when the requested
  value does not exist. Site RSS language and item links use the active locale.
- Locale routing failures keep CSP and `nosniff` headers. Sitemap processing
  traverses source pagination and emits reciprocal alternates, but returns
  503 rather than silently truncating above the existing 50,000-URL
  single-file limit; a partitioned sitemap architecture is still required.
- Tests for creation conflicts, review-before-publish, Arabic-only onboarding,
  source isolation and structured AI documents have been authored but **not
  executed** pending the requested deferred validation window.

**Remaining launch blockers:** full certified Arabic Admin strings and
accessibility review; operator-guided reconciliation and safe primary-locale
changes for populated legacy sites; reliable partitioned sitemaps and
multi-publication canonical hosts; source language revision integrity and
new/upgrade rollback rehearsals; successful typecheck/lint/unit/integration/
browser/build/security gates. Do not deploy this branch as production-ready.

## 3. Migration and compatibility checklist

1. Collect per-publication values of `site.locale`, `primary_locale`, `publication_locales`, existing translation target locales and public URL inventory.
2. Reconcile and record conflicts without assuming `en` or automatically enabling `ar-SA`. Never infer enabled state solely from stored translation rows; **published** historical localized URLs require an inventory and a preservation/explicit retirement decision before strict-mode cutover.
3. Preserve `content_translations` and original posts/pages; keep legacy contracts functional through an explicit compatibility projection during the transition.
4. Changing a populated publication's primary locale requires an explicit content migration/reclassification decision, **not** merely rewriting the site setting.
5. Deactivating a locale hides it publicly but preserves translations for reactivation; include SEO retirement and cache invalidation.
6. Test backward compatibility with existing self-hosted installations, plugins, themes, webhooks, member portals and backup/restore.
7. Prepare a reversible rollout and rollback plan before modifying production data.

## 4. Regression test matrix

| Scenario | Configuration | Critical assertions |
| --- | --- | --- |
| New English-only | primary `en`, enabled `[en]` | English UI+web, no translation UI/API writes, unprefixed default URL |
| New Arabic-only | primary `ar`, enabled `[ar]` | Arabic UI+web including onboarding/login, RTL, no secondary language |
| Arabic + English | primary `ar`, enabled `[ar,en]` | Arabic source, English translation, matrix + queue, English prefixed URL |
| English + French | primary `en`, enabled `[en,fr]` | French target only, no injected Arabic |
| Disabled/nonexistent target | `ar` inactive or unknown | Reject translation writes and do not serve as a public locale |
| Role restrictions | staff without locale-management permission | No settings mutation, no privilege bypass |
| Cross-publication | two publications with disjoint locales | No config/data leakage, cross-publication IDs not authorization |
| Upgrade with translations | old rows + site/primary disagreement | No deletion, explicit reconciliation, stable legacy content |
| Primary change with authored posts | populated installation | Impact check; no silent re-labeling of stored source language |
| Public translation missing | requested target enabled, not published | Correct not-found/no fallback and no wrong-language SEO |
| Admin dictionary | en/ar certified | Full keys, correct direction, focus, Bidi and assistive technology |
| AI outage or malformed response | multilingual publication | No falsely completed translation, safe recoverable failure |

## 5. Release gates and evidence

- Record a role review (Architect, Security, DB/Migration, API, i18n/RTL, Plugin/Theme, QA as relevant) before each non-trivial ticket.
- For every ticket: scoped git status and consumer search → minimal compatible diff → focused tests → dependent tests → relevant typecheck/lint/build → reviewed diff.
- Before rollout: DB migration dry run against populated fixtures, upgrade/rollback rehearsal, publication-isolation adversarial cases, browser English+Arabic coverage, cache/SEO checks and operator notes.
- Do not mark the policy **implemented** or a locale **fully UI-supported** on the strength of existing historic certification reports; generate new evidence against this plan.

## 6. Related documentation

- [Decision / source of truth](../14-decisions/publication-language-policy.md)
- [Owner language setup guide](../administration/LANGUAGE_CONFIGURATION_GUIDE.md)
- [Staff translation workflow](../administration/TRANSLATION_WORKFLOW_GUIDE.md)
- [Translation engineering guide](TRANSLATION_MANAGEMENT_GUIDE.md)
- [Theme localization](THEME_LOCALIZATION_GUIDE.md)
- [Plugin localization](PLUGIN_LOCALIZATION_GUIDE.md)
- [Localized content models](../content-modeler/CONTENT_MODELER_LOCALIZATION.md)
