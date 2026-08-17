# 11 — Theme Quality & Edge-Case Testing Guide

Before submitting or uploading a theme to Vibress, perform these essential quality and edge-case tests.

---

## 🧪 1. Local Package Validation Tool

This package includes a standalone CLI validator in `scripts/validate-theme.mjs`.

Run it directly from your terminal:

```bash
# Validate an uncompressed theme directory
node scripts/validate-theme.mjs path/to/my-theme

# Or validate a packaged ZIP archive
node scripts/validate-theme.mjs path/to/my-theme.zip
```

### What the validator checks:
* ✅ Proper `theme.json` with `themeApi: 1` and valid semver version.
* ✅ Presence of all required templates (`home.liquid`, `post.liquid`, `page.liquid`).
* ✅ Existence of preview image (`preview.webp`).
* ✅ Verification that **zero prohibited files** (`.js`, `.ts`, `.env`, `.sh`) exist in the package.
* ✅ Verification of `settings.json` schema types and mandatory default values.
* ✅ Archive size and quota limits.

---

## 🔍 2. Template-by-Template Testing Matrix

Verify every template against these scenarios:

### 🏠 Homepage (`home.liquid`)
- [ ] **Hero Section**: Does the custom headline render properly from `{{ settings.heroHeadline }}`?
- [ ] **Featured Articles**: Are featured articles visually distinct from regular articles?
- [ ] **Empty State**: If there are 0 posts published, does the template show a friendly empty message instead of a blank white screen?
- [ ] **Pagination**: If there are more than 10 posts, do pagination controls navigate properly?

### 📝 Single Post (`post.liquid`)
- [ ] **With Cover Image**: Feature image displays crisply with proper aspect ratio and caption.
- [ ] **WITHOUT Cover Image**: The layout stays clean and does not leave an awkward empty space or broken image tag.
- [ ] **Typography & Prose**: Check headings (`<h2>`, `<h3>`), blockquotes, code blocks (`<pre><code>`), lists, tables, and images embedded in the body.
- [ ] **Author Bio & Avatar**: Author name, bio, and avatar render cleanly.
- [ ] **Multiple Tags**: Tags display as clean pill links without wrapping awkwardly.

### 📄 Static Page (`page.liquid`)
- [ ] Renders long-form text (e.g. Privacy Policy or About Us) with comfortable reading line-length (max ~75ch).

### 🏷️ Tag Archive (`tag.liquid`)
- [ ] Tag title and description appear at the top.
- [ ] List of matching posts renders in the article grid.

### 👤 Author Archive (`author.liquid`)
- [ ] Author portrait, name, bio, and count of articles appear in the header banner.
- [ ] List of matching posts written by this author renders below.

---

## ⚡ 3. Critical Edge Cases to Stress-Test

| Edge Case | Potential Failure | Desired Safe Behavior |
| :--- | :--- | :--- |
| **Super Long Article Title** | Title spills outside container or breaks layout | Text wraps cleanly (`overflow-wrap: break-word; line-height: 1.2;`) |
| **Missing Feature Image** | Broken `<img>` icon or empty gray block | Template uses `{% if post.featureImage %}` and skips image container |
| **No Author Avatar** | Broken circle or displaced text | Falls back to initials or omits avatar gracefully |
| **Very Short Excerpt vs Long Excerpt** | Card heights misaligned | CSS Grid / Flexbox aligns card buttons and meta to bottom (`margin-top: auto;`) |
| **No Tags on Post** | Empty `<ul>` margin gap | Template checks `{% if post.tags.size > 0 %}` |
| **Arabic / RTL Content** | Text aligns left, arrows point backwards | `[dir="rtl"]` flips text alignment to start and arrows to `&larr;` / `&rarr;` |
| **Narrow Mobile (320px)** | Horizontal scrollbar / content clipping | All containers have `max-width: 100%` and no fixed widths |

---

## 🎨 4. Theme Settings Customization Test

If your theme defines custom options in `settings.json`:
1. Test switching color pickers (e.g. from `#6366f1` to `#dc2626` or `#059669`).
2. Test switching font typography dropdowns (sans vs serif).
3. Test toggles (e.g. turning off reading time or author avatars).
4. Verify that default values are used automatically if a setting has not been modified by the user.

---

Next: Read **[`12-PACKAGING-AND-DELIVERY.md`](./12-PACKAGING-AND-DELIVERY.md)** to prepare your theme for submission.
