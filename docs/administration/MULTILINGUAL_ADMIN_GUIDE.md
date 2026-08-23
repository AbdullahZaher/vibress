# Vibress Multilingual Administration & Content Workflow Guide

This guide explains how publication administrators manage multi-language publications, translations, and editorial workflows in Vibress.

---

## 1. Enabling Locales for a Publication

1. Navigate to **Settings ➔ General ➔ Localization** in the Admin panel.
2. Under **Publication Locales**, select your publication's default locale (e.g. `en-US` or `ar-SA`).
3. Add secondary target locales (e.g. `ar-SA`, `fr-FR`, `fa-IR`, `de-DE`).
4. Save changes.

---

## 2. Localized URL Routing & Prefixes

- **Default Locale:** Served at the root path without prefix (e.g. `/` and `/posts/my-post`).
- **Non-Default Locales:** Automatically prefixed with their ISO-639 language code:
  - Arabic: `/ar/posts/my-post` (or localized slug `/ar/posts/slug-ar`)
  - French: `/fr/posts/my-post`
  - Persian: `/fa/posts/my-post`
- **Canonicalization:** Uppercase URLs (e.g. `/AR`) and explicit default prefixes (e.g. `/en/posts/...`) are automatically 301-redirected to their canonical forms.

---

## 3. Editorial Translation Workflow

Vibress maintains translations using a linked **Translation Group** model (`translationGroupId`).

### Translation Lifecycle States:
1. **`draft`:** Initial translation draft created by an editor or translator.
2. **`in_progress`:** Translation currently being edited.
3. **`needs_review`:** AI-generated or external agency draft submitted for human review.
4. **`approved`:** Translation reviewed and verified by an authorized editor.
5. **`published`:** Live and publicly accessible to site readers.
6. **`stale`:** Flagged automatically when the source English content is modified after the translation date.

---

## 4. AI Translation Safety & Human Approval

When generating translations via AI providers (e.g. OpenAI GPT-4o, Claude 3.7 Sonnet):
- Translations are **never** automatically published.
- The AI draft is saved with status **`needs_review`** and tagged with the model and provider metadata.
- An editor must review the translation and click **Approve & Publish**.

---

## 5. Strict 404 / Missing Translation Handling

Vibress enforces strict locale boundaries:
- If a post or page does not have a published translation in Arabic, visiting `/ar/posts/untranslated-slug` strictly returns a **404 Not Found** in Arabic.
- English content is **never silently leaked** into non-English reader views.

---

## 6. Language Switcher & Resource Preservation

The theme's language switcher (`{% locale_switcher %}`) dynamically preserves the active article or page across language transitions. When reading `/posts/welcome`, clicking **العربية** navigates directly to `/ar/posts/welcome` (or the localized Arabic slug).
