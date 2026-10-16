# Publication Languages — Owner & Administrator Guide

> **Status: approved target workflow; implementation pending.** This document describes the intended behavior after the localization policy rollout, not controls already guaranteed in the current Admin UI. Authoritative policy: [Publication-Scoped Language Policy](../14-decisions/publication-language-policy.md). العربية: [دليل إعداد اللغات](LANGUAGE_CONFIGURATION_GUIDE.ar.md).

## Choose a primary language during onboarding

The new publication starts with **one active language**. On the first-run setup wizard:

1. Select your **Primary language** (for example, English or العربية). This controls the default content language, public routes and the publication's administrative interface.
2. Leave **Additional languages** empty for a single-language publication. Select other languages only when you intend to publish translations.
3. Review the configuration before completing setup. Selecting Arabic must make the public site and certified Admin surfaces Arabic/RTL on completion; selecting English must make them English/LTR.
4. Completing setup saves the primary locale and active locale set together. It does **not** launch AI translation.

**Important:** A content language is not automatically a certified Admin-interface language. The initial rollout must fully certify English and Arabic administration before claiming either is complete; future languages need equally comprehensive UI translation and QA.

## Maintain languages in /admin/settings

Owners or administrators with the appropriate publication-scoped permission can:

- View the current primary language and all enabled content languages.
- Explicitly enable additional languages and thereby make Translation management available to authorized editorial staff.
- Disable an additional language after reviewing the effect on published routes, traffic and existing translations.
- Request a primary-language change. On a publication with existing authored content, the system must require a deliberate content-language migration/reclassification flow or block the change with an actionable explanation.

**Disabling a language does not delete its translations.** Those entries remain stored for authorized maintenance and possible reactivation. Previously published localized URLs require deliberate redirects/retirement and cache updates.

## What people see

| Your publication | Admin and public default | Translation area | Language switcher |
| --- | --- | --- | --- |
| English only (`en`) | English, LTR | Hidden | Hidden |
| Arabic only (`ar`) | Arabic, RTL | Hidden | Hidden |
| Arabic + English (`ar`, `en`) | Arabic default and English localized pages | Shown only to staff with permission | Shown for available published variants |
| English + French (`en`, `fr`) | English default and French localized pages | Shown only to staff with permission | Shown for available published variants |

The primary language has the **unprefixed** public URL, regardless of which language it is. An English publication does not implicitly enable Arabic, and an Arabic publication does not need to prefix its Arabic homepage with `/ar`.

## Translation and review behavior

Translation tools appear only when the publication has at least two active content languages. The source is the **original item's language**, not English by default. The editor chooses a currently enabled target language different from the source. Existing permission checks, review/approval stages and publication isolation remain mandatory.

Creating an additional language does not automatically translate existing posts or pages. AI-assisted translation is an explicit, review-gated operation and may require configured provider access. A generated draft must not claim a translated body where the provider has only translated the title or excerpt.

If a requested translation is not available or not published, the localized public page must not silently display text in some other language.

## Before changing languages on an existing site

- Back up your data and note the current primary locale, published localized URLs and existing translations.
- Review impact on posts, pages, content-model fields, RSS, navigation, sitemap, SEO, plugins/themes, canonical links and cached pages.
- Do **not** assume editing a locale code translates content or changes the language in which older articles were authored.
- Avoid turning off a language without checking existing public links and translations; stored translations must be preserved.

## Implementation and support

This page is the approved target behavior. The existing implementation still includes hard-coded English/Arabic defaults in parts of Translation and routing; do not use this guide as evidence that those bugs have been fixed. Track rollout work in the [implementation plan](../development/LOCALIZATION_POLICY_IMPLEMENTATION_PLAN.md) and technical behavior in the [developer guide](../development/TRANSLATION_MANAGEMENT_GUIDE.md).
