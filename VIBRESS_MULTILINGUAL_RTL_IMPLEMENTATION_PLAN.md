# Vibress Localization & RTL — Production Implementation Plan

## Objective

Implement production-grade multilingual support in Vibress, starting with **Arabic (`ar-SA`) and full RTL support**, while establishing a localization architecture that scales cleanly to additional locales without requiring theme rewrites.

The implementation must be treated as a **platform capability**, not a one-off Arabic translation.

The final outcome must support:

- Arabic-first UI and content
- Correct LTR/RTL rendering
- Locale-aware routing
- Localized content and slugs
- Localized navigation and taxonomies
- Locale-aware SEO
- Theme-level localization contracts
- RTL-safe themes using CSS logical properties
- Localized admin/portal/web interfaces
- Locale-aware formatting
- Translation status and stale-translation handling
- Automated RTL/theme validation
- AI-assisted translation foundations
- Backward compatibility for existing English installations
- A complete implementation report with evidence and tests

---

# 1. Non-Negotiable Architectural Principles

## 1.1 Locale is a first-class domain concept

Do not implement Arabic with scattered conditionals such as:

```ts
if (locale === "ar") { ... }
```

The system must resolve:

```text
request
→ publication
→ locale
→ direction
→ localized content
→ SEO metadata
→ theme runtime
```

from a centralized localization architecture.

## 1.2 One source of truth

Create a canonical Locale Registry used by:

- API
- Web
- Admin/Studio
- Portal
- Themes
- Plugins
- SEO
- Formatting
- Routing
- Translation services

No application-specific RTL locale lists.

## 1.3 Themes must not own localization resolution

Themes receive an already-resolved localization context.

Themes must not query translation storage directly.

## 1.4 RTL must be semantic

Prefer CSS logical properties:

```css
margin-inline-start
margin-inline-end
padding-inline-start
padding-inline-end
inset-inline-start
inset-inline-end
border-inline-start
border-inline-end
text-align: start
```

Do not solve RTL primarily through CSS flipping tools.

## 1.5 UI translations and content translations are different systems

Separate:

1. Platform/theme/plugin UI messages
2. Author-owned localized content
3. Locale-aware formatting

Do not mix these concerns.

## 1.6 No silent content fallback by default

Missing translated content must not silently render a different language.

Default behavior:

```text
missing localized content → 404 / unavailable translation
```

Optional source-language fallback may exist as an explicit configuration, but it must not be the default.

---

# 2. Phase 0 — Repository Audit

Before changing code, inspect the entire repository.

Audit:

- Existing `@vibress/i18n`
- Locale dictionaries
- Translation services
- `content_translations`
- Posts/pages/content models
- Publication/site locale fields
- Theme contracts
- Theme SDK
- Theme validator
- Web routing
- Admin/Studio locale handling
- Portal locale handling
- API locale handling
- SEO generation
- Sitemap generation
- Navigation
- Taxonomies
- Search
- Emails/newsletters
- Authentication flows
- Billing/membership UI
- AI translation capabilities
- CSS/Tailwind usage
- Hardcoded English strings
- Hardcoded LTR assumptions
- `margin-left`, `margin-right`, `padding-left`, `padding-right`, `left`, `right`, etc.
- Environment-driven locale logic
- Existing tests and fixtures

Create an inventory of current localization capabilities and technical debt.

Do not delete working functionality before establishing equivalent replacement behavior.

---

# 3. Phase 1 — Locale Registry

Build a centralized locale registry in the shared i18n/localization package.

## Required model

```ts
interface LocaleDefinition {
  code: string;
  language: string;
  region?: string;
  nativeName: string;
  englishName: string;
  direction: "ltr" | "rtl";
  script: string;
  fallback: string[];
  dateLocale: string;
  numberLocale: string;
  calendar?: string;
}
```

At minimum support:

```text
en
en-US
ar
ar-SA
```

Do not hardcode the architecture around only English and Arabic.

The registry must support future locales such as:

```text
fr-FR
de-DE
tr-TR
ur-PK
fa-IR
```

without code changes to routing or rendering logic.

## Required capabilities

- Locale normalization
- Canonicalization
- Language extraction
- Region extraction
- Direction resolution
- Script resolution
- Fallback chain
- Native/English locale names
- Locale validation

Examples:

```ts
canonicalizeLocale("AR_sa") === "ar-SA"
getLanguage("ar-SA") === "ar"
getDirection("ar-SA") === "rtl"
```

Add comprehensive tests.

---

# 4. Phase 2 — Publication Locale Model

Do not rely on a JSON array such as:

```json
["en", "ar"]
```

as the long-term model.

Introduce a publication-level locale model/table.

Recommended concept:

```text
publication_locales
```

Fields should cover at minimum:

- id
- publication_id
- locale
- enabled
- is_primary
- is_default
- url_prefix
- is_public
- created_at
- updated_at

Do not persist redundant `direction` values if they can be derived from locale.

Enforce database invariants:

- only one primary locale
- no duplicate locale per publication
- enabled/public state consistency
- valid locale codes

Provide migrations and rollback-safe schema changes.

---

# 5. Phase 3 — Locale Resolution

Create a central `PublicationLocaleResolver`.

Responsibilities:

```text
hostname
→ publication
→ explicit URL locale
→ user preference
→ publication default
```

Browser `Accept-Language` may be used for first-visit detection, but must never override an explicit locale in the URL.

Required behavior:

### Example

```text
GET /ar/posts/hello-world
```

must resolve:

```text
publication = X
locale = ar-SA
direction = rtl
```

The resolved context must be available to:

- SSR
- API
- themes
- SEO
- navigation
- content rendering

No environment variable should be the source of truth for the active frontend locale in a multilingual publication.

---

# 6. Phase 4 — Locale Routing

Implement configurable locale routing.

At minimum support:

```text
path
```

with future extensibility for:

```text
subdomain
domain
```

Recommended default:

```text
default locale:
example.com/post

secondary locale:
example.com/ar/post
```

Support a future option:

```ts
alwaysPrefixLocale: boolean
```

Requirements:

- Canonical locale URLs
- Redirect non-canonical variants
- Locale-aware 404 handling
- Locale-safe slug handling
- No query-string-only language routing
- Proper encoded Unicode slugs
- Stable localized URLs

Existing English URLs must remain compatible.

---

# 7. Phase 5 — Content Translation Architecture

Refactor content localization into a clear translation-set model.

Introduce a concept equivalent to:

```text
translationGroupId
```

Each localized representation belongs to one translation group.

Example:

```text
Translation Group TG-123
├── en-US
└── ar-SA
```

Localized fields should include where applicable:

- title
- slug
- excerpt
- body
- SEO title
- SEO description

Avoid duplicating shared content metadata unnecessarily.

The model must support future:

- translation status
- machine vs human translation
- stale translation detection
- translation history
- translation memory

---

# 8. Phase 6 — Translation State

Define explicit translation state.

At minimum:

```text
missing
draft
translated
needs_review
approved
published
stale
```

The system must be able to detect when source content changes after a translation was produced.

Do not silently mark translations as current.

Expose enough information for Studio/UI to show:

- translated
- missing
- stale
- needs review

---

# 9. Phase 7 — Localized Navigation

Navigation must support localized labels and targets.

A navigation item must be able to preserve its identity while having locale-specific:

- label
- URL
- visibility
- ordering where required

Language switching must retain the current translated resource whenever one exists.

Example:

```text
English:
example.com/about

Arabic:
example.com/ar/about
```

The switcher should never unnecessarily send the user to the homepage.

---

# 10. Phase 8 — Localized Taxonomies

Support localization for:

- categories
- tags
- custom taxonomy terms
- future collection taxonomies

Localized term model:

```text
canonical term identity
├── en-US label + slug
└── ar-SA label + slug
```

Do not translate taxonomy strings only at render time.

Taxonomy localization must be first-class content metadata.

---

# 11. Phase 9 — Locale-Aware Formatting

Use platform-standard Intl APIs or an equivalent robust abstraction.

Implement:

- date formatting
- relative time
- numbers
- currencies
- lists
- pluralization
- locale-aware time formatting

Do not use ad-hoc string interpolation for complex plural rules.

Prepare the API for ICU-style message formatting.

Arabic must correctly support plural categories.

Do not store formatted dates or numbers in content.

---

# 12. Phase 10 — Arabic Foundation

Add production-quality Arabic support for:

```text
ar
ar-SA
```

Requirements:

- Arabic UI dictionary
- Arabic admin UI
- Arabic portal UI
- Arabic frontend UI
- RTL rendering
- Arabic dates
- Arabic number formatting
- Hijri support where appropriate
- Arabic relative time
- Arabic pluralization
- Arabic search normalization
- Arabic SEO metadata
- Arabic validation messages
- Arabic auth/billing/member emails

Avoid hardcoding Saudi-specific behavior into generic Arabic logic.

Use `ar-SA` for Saudi-specific formatting.

---

# 13. Phase 11 — Admin / Studio / Portal RTL

Use the existing shadcn/Radix direction support.

Do not rebuild shadcn components unless necessary.

Create centralized providers/context equivalent to:

```tsx
<LocaleProvider locale={locale}>
  <DirectionProvider direction={direction}>
    <App />
  </DirectionProvider>
</LocaleProvider>
```

Replace directional utility usage with logical equivalents where appropriate:

```text
ms-*
me-*
ps-*
pe-*
start-*
end-*
```

Audit:

- dialogs
- popovers
- dropdowns
- sidebars
- sheets
- command menus
- tables
- form layouts
- date pickers
- calendars
- pagination
- breadcrumbs
- tabs
- drag/drop UI
- charts
- toasts
- tooltips

Ensure icons/arrows are semantically correct in RTL rather than blindly mirrored.

---

# 14. Phase 12 — Theme Localization Contract

Extend the theme runtime contract.

Theme context should provide:

```ts
interface ThemeLocaleContext {
  locale: string;
  language: string;
  region?: string;
  direction: "ltr" | "rtl";
  isRTL: boolean;
  availableLocales: Locale[];
  currentUrl: string;
}
```

Provide helpers for:

- translation
- date formatting
- number formatting
- relative time
- localized URLs
- alternate locales
- direction
- language switcher data

Themes must never access translation tables or databases directly.

---

# 15. Phase 13 — Theme Localization Files

Allow themes to ship their own translation namespaces.

Recommended structure:

```text
themes/
  my-theme/
    locales/
      en.json
      ar.json
```

Use namespaced keys:

```text
common.save
nav.home
theme.hero.read_more
```

Do not allow themes to pollute the core platform dictionary.

Provide fallback behavior for theme UI strings.

---

# 16. Phase 14 — Theme RTL Compliance

Make RTL support a theme contract.

Theme manifest should expose capabilities similar to:

```json
{
  "localization": {
    "supportsLocales": ["*"],
    "rtl": true,
    "dynamicLocale": true,
    "localizedNavigation": true,
    "localizedDates": true
  }
}
```

Support explicit capability negotiation.

A theme should be able to report:

```text
RTL Ready
Multilingual Ready
Arabic Ready
```

---

# 17. Phase 15 — RTL CSS Validation

Extend the theme validator.

Detect suspicious directional declarations such as:

```css
margin-left
margin-right
padding-left
padding-right
left:
right:
border-left
border-right
text-align: left
text-align: right
```

Prefer logical properties.

Provide warnings/errors with useful source locations.

Allow explicit suppressions for legitimate cases.

Do not rely on `rtlcss` as the primary RTL implementation.

---

# 18. Phase 16 — Web Rendering

Frontend rendering must resolve locale per request.

Do not use:

```ts
process.env.SITE_LOCALE
```

as the active locale source in a multilingual publication.

Required request flow:

```text
request
→ publication
→ locale
→ localized content
→ SEO
→ theme runtime
→ HTML
```

Render:

```html
<html lang="ar-SA" dir="rtl">
```

or the resolved LTR equivalent.

Ensure SSR and hydration produce identical locale/direction values.

---

# 19. Phase 17 — SEO Localization

Localization must be platform-level, not theme-specific.

Automatically generate:

- canonical URL
- hreflang links
- x-default where appropriate
- localized Open Graph metadata
- `inLanguage`
- localized JSON-LD
- localized sitemap URLs

Example:

```html
<link rel="alternate"
      hreflang="en"
      href="https://example.com/post" />

<link rel="alternate"
      hreflang="ar"
      href="https://example.com/ar/post" />
```

Do not emit alternate links for nonexistent translations.

---

# 20. Phase 18 — Language Switcher Primitive

Implement a platform primitive usable from all themes.

Example concept:

```text
LocaleSwitcher
```

or Liquid equivalent.

It must provide:

- native language name
- current locale
- available locales
- direction
- localized URL

For a post/page, switching locale should navigate directly to the translated resource.

Use real `<a href>` links, not JavaScript-only navigation.

---

# 21. Phase 19 — Search Localization

Make search locale-aware.

At minimum Arabic should include sensible normalization for:

- alef variants
- ya / alif maqsura
- ta marbuta
- diacritics
- Arabic whitespace/tokenization issues

Architecture must allow locale-specific analyzers in the future.

Do not assume the Arabic analyzer applies to every language.

---

# 22. Phase 20 — Email and Notification Localization

All user-facing email templates must receive a locale.

Support:

- authentication emails
- membership emails
- billing emails
- newsletter system messages
- notifications
- password/account emails

HTML email must correctly support RTL:

```html
<html lang="ar-SA" dir="rtl">
```

Ensure CTAs, icons, and layout are RTL-safe.

---

# 23. Phase 21 — API Localization

API consumers must be able to request locale explicitly.

Support a clean mechanism such as:

```http
Accept-Language: ar-SA
```

and/or an explicit locale query/route parameter.

Return locale metadata where appropriate:

```json
{
  "locale": "ar-SA",
  "availableLocales": ["en-US", "ar-SA"]
}
```

Do not create ambiguous fallback behavior.

Document locale behavior in OpenAPI/API docs.

---

# 24. Phase 22 — AI Translation Foundation

Reuse the existing Vibress AI Gateway.

Implement an AI translation abstraction that can eventually provide:

```text
source content
→ AI translation draft
→ needs_review
→ human approval
→ published translation
```

Record:

- source locale
- target locale
- model/provider
- timestamp
- status
- reviewer if applicable

Do not automatically publish AI-generated translations unless explicitly configured.

---

# 25. Phase 23 — Testing Strategy

Build tests across all layers.

## Unit

Test:

- locale normalization
- registry
- direction
- fallback chains
- pluralization
- formatting
- URL localization
- translation state

## Integration

Test:

- publication locale configuration
- locale resolver
- localized content loading
- navigation
- taxonomy
- API locale negotiation
- SEO generation

## E2E

For every reference theme, test:

```text
English LTR
Arabic RTL
```

At minimum pages:

- homepage
- post
- page
- archive
- tag
- author
- search
- 404
- membership
- newsletter/account pages where applicable

## Visual regression

Generate RTL screenshots and compare against approved baselines.

## Accessibility

Validate:

- direction
- lang attributes
- keyboard navigation
- focus order
- screen reader semantics
- landmarks
- forms

---

# 26. Theme Compatibility Matrix

Create an automated matrix similar to:

| Theme | en-US | ar-SA | RTL | Localized Nav | SEO | E2E |
|---|---:|---:|---:|---:|---:|---:|
| Starter | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Theme A | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

No theme may be marked Arabic/RTL-ready based only on manifest declarations.

Manifest claims must be validated in CI.

---

# 27. Migration & Backward Compatibility

Existing publications must continue working without manual migration.

Migration requirements:

- Existing single-locale sites remain valid
- Existing English URLs remain stable
- Existing themes continue to render
- Existing API clients continue to work
- Existing plugins do not break unexpectedly
- Existing content remains readable
- New locale features are opt-in until configured

Provide data migration scripts.

Never perform destructive data migration without an explicit backup-safe path.

---

# 28. Documentation

Update documentation for:

- Locale Registry
- publication locale setup
- locale routing
- content translations
- translation state
- theme localization
- RTL rules
- CSS logical properties
- language switchers
- SEO/hreflang
- API locale negotiation
- plugin localization
- email localization
- AI translation
- troubleshooting

Include concrete examples for `ar-SA`.

---

# 29. Developer Guardrails

Add repository rules/linting/checks where practical.

Examples:

- no hardcoded locale lists outside Locale Registry
- no direct DB access to translations from themes
- no `process.env.SITE_LOCALE` for request locale
- discourage directional CSS
- require locale-aware date/number formatting
- require `lang` and `dir` at document root
- require theme localization namespace

---

# 30. Definition of Done

The implementation is complete only when all of the following are true:

## Platform

- Locale Registry implemented
- Locale Resolver implemented
- Publication locale model implemented
- Locale routing implemented
- Arabic `ar-SA` supported

## Content

- Translation groups implemented
- Localized slugs implemented
- Translation states implemented
- Localized navigation implemented
- Localized taxonomies implemented

## UI

- Admin fully localized for Arabic
- Portal localized for Arabic
- Web UI localized for Arabic
- RTL behavior validated
- Locale-aware formatting works

## Themes

- Theme runtime localization contract implemented
- Starter/reference theme is RTL-ready
- Theme locale files supported
- RTL validator implemented
- Automated RTL tests implemented

## SEO

- canonical URLs correct
- hreflang correct
- localized sitemap support implemented
- JSON-LD locale metadata correct

## Search

- Arabic normalization implemented
- locale-aware search architecture implemented

## Emails

- Arabic email templates implemented
- RTL-safe email rendering implemented

## AI

- AI translation foundation implemented
- review workflow supported
- no silent auto-publishing

## Quality

- unit tests pass
- integration tests pass
- E2E passes
- RTL visual tests pass
- typecheck passes
- lint passes
- production build passes
- migration checks pass

---

# 31. Mandatory Final Verification

Before declaring completion, run the full relevant verification suite.

At minimum:

```text
typecheck
lint
unit
integration
E2E
theme validation
RTL validation
build
migration verification
security checks
```

Do not report success based on partial test execution.

Record exact commands and results.

---

# 32. Required Final Report

After implementation, create a detailed report:

```text
docs/reports/MULTILINGUAL_RTL_IMPLEMENTATION_REPORT.md
```

The report must include:

## Executive Summary

What was implemented and why.

## Architecture

Explain the final localization architecture.

## Database Changes

List every migration and model change.

## Routing

Explain locale resolution and URL behavior.

## Content

Explain translation groups, localized fields, and translation states.

## Themes

Explain the theme contract and RTL validation.

## Arabic

List Arabic-specific work.

## SEO

Explain canonical/hreflang/sitemap behavior.

## Search

Explain Arabic normalization.

## Email

Explain localized notifications/templates.

## AI

Explain the translation workflow.

## Testing

Include exact commands and pass/fail results.

## Files Changed

List important files/packages/modules changed.

## Backward Compatibility

Explain how existing installations remain functional.

## Known Limitations

List anything intentionally deferred.

## Recommended Next Steps

Provide a prioritized roadmap for additional locales.

Do not claim features were implemented unless verified in code/tests.

---

# 33. Agent Execution Rules

You are authorized to modify the codebase as necessary to complete this plan.

Do not stop after writing a design.

Implement the full feature end-to-end.

Do not ask for confirmation for ordinary implementation decisions.

When several valid technical approaches exist, select the one that best preserves:

1. existing architecture
2. backward compatibility
3. extensibility
4. security
5. testability
6. developer experience

Avoid speculative rewrites.

Prefer incremental migrations and compatibility layers.

Do not add unnecessary dependencies when platform-native APIs are sufficient.

Do not introduce localization-specific technical debt that will make future locales expensive.

After implementation:

1. Run verification.
2. Fix all regressions you find.
3. Re-run verification.
4. Produce the final implementation report.
5. Do not declare completion until the report and verification are up to date.

The final response from the agent must summarize:

- implementation status
- major architectural changes
- tests run
- test results
- migration status
- known limitations
- report path
