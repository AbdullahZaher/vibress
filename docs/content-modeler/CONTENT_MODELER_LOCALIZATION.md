# Vibress Content Modeler — Localization & RTL Architecture

The Content Modeler provides deep integration with the Vibress localization system (`@vibress/i18n`), providing runtime language dictionaries, fallback resolution, and first-class Arabic/RTL presentation.

---

> **Policy update (accepted; implementation pending):** [Publication Language Policy](../14-decisions/publication-language-policy.md). Localized fields must respect a publication's **enabled locale set** and primary language. The fallback chain documented below reflects a **legacy implementation description**; uncontrolled first-available fallback in public content is not acceptable under the new policy.

## 1. Localizable Fields Architecture

Any field in a content model can have `localizable: true`. When marked as localizable:
1. **Target behavior:** For a single-language publication, the editor shows only the configured primary-locale field, without translation tabs. When multiple locales are explicitly enabled, tabs show only those locales (for example `العربية (ar)` and `English (en)` when those are the selected pair). The current editor must be verified/updated to conform.
2. The field stores a multi-locale dictionary in PostgreSQL:
   ```json
   {
     "headline": {
       "en": "Exclusive Launch",
       "ar": "إطلاق حصري"
     },
     "description": {
       "en": "Limited edition items available now.",
       "ar": "منتجات بإصدار محدود متوفرة الآن."
     }
   }
   ```

---

## 2. Existing Fallback Hierarchy (legacy; to be revised for public rendering)

When an API client or theme requests content in a specific locale (e.g. `ar-SA`):
1. **Exact Locale Match**: Looks for key `"ar-sa"`.
2. **Language Base Match**: Looks for language prefix `"ar"`.
3. **Publication Fallback Locale**: Looks for publication's primary locale (e.g. `"en"`).
4. **First Available Value (legacy only):** May select the first non-empty value regardless of language. **Must not be used for published localized output** when it would show an unintended or disabled language. The new resolver will validate requested/available locales first and use an explicit missing-translation policy instead of silently displaying unrelated language text.

---

## 3. Arabic & RTL Direction Handling

In the Admin UI, input controls and editors automatically set `dir="rtl"` when the active editing tab is Arabic or an RTL locale.

In public web rendering and theme view models:
- Arabic routes set `dir="rtl"` and `lang="ar"`; if Arabic is the **primary** locale, those routes are unprefixed (e.g. `/collections/[modelSlug]`). The `/ar/...` prefix is used only for an explicitly enabled non-primary Arabic locale.
- Theme engines support the `is_rtl` and `direction` Liquid filters:
  ```liquid
  <div class="card {% if 'ar' | is_rtl %}rtl-layout{% endif %}">
    <h2>{{ item.title }}</h2>
  </div>
  ```
