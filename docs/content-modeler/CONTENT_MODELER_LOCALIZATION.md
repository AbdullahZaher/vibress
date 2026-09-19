# Vibress Content Modeler — Localization & RTL Architecture

The Content Modeler provides deep integration with the Vibress localization system (`@vibress/i18n`), providing runtime language dictionaries, fallback resolution, and first-class Arabic/RTL presentation.

---

## 1. Localizable Fields Architecture

Any field in a content model can have `localizable: true`. When marked as localizable:
1. The admin entry editor renders language tabs (e.g. `English (en)` and `العربية (ar)`).
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

## 2. Fallback Resolution Hierarchy

When an API client or theme requests content in a specific locale (e.g. `ar-SA`):
1. **Exact Locale Match**: Looks for key `"ar-sa"`.
2. **Language Base Match**: Looks for language prefix `"ar"`.
3. **Publication Fallback Locale**: Looks for publication's primary locale (e.g. `"en"`).
4. **First Available Value**: Falls back to the first available non-empty string in the dictionary.

---

## 3. Arabic & RTL Direction Handling

In the Admin UI, input controls and editors automatically set `dir="rtl"` when the active editing tab is Arabic or an RTL locale.

In public web rendering and theme view models:
- Arabic routes (e.g. `/ar/collections/[modelSlug]`) set `dir="rtl"` and `lang="ar"` on the document container.
- Theme engines support the `is_rtl` and `direction` Liquid filters:
  ```liquid
  <div class="card {% if 'ar' | is_rtl %}rtl-layout{% endif %}">
    <h2>{{ item.title }}</h2>
  </div>
  ```
