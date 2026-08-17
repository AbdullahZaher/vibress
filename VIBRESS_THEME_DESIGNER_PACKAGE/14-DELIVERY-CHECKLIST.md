# 14 — Theme Delivery Checklist

Use this checklist as the final quality gate before submitting your theme package.

---

## 📋 1. Package Structure & Files

- [ ] **`theme.json`** exists at the root with:
  - [ ] Valid lowercase alphanumeric `id` (e.g. `"my-theme"`)
  - [ ] Human-readable `name`
  - [ ] Strict semver `version` (e.g. `"1.0.0"`)
  - [ ] `themeApi: 1`
- [ ] **`preview.webp`** (or declared `previewImage`) exists and is a valid image.
- [ ] **`templates/home.liquid`** (or `index.liquid`) exists and renders the post list.
- [ ] **`templates/post.liquid`** exists and renders `{{ post.html }}`.
- [ ] **`templates/page.liquid`** exists and renders `{{ page.html }}`.
- [ ] **`templates/tag.liquid`** exists and renders tag metadata & articles.
- [ ] **`templates/author.liquid`** exists and renders author metadata & articles.
- [ ] **`partials/`** contains reusable components (`header.liquid`, `footer.liquid`, `pagination.liquid`).

---

## 🚫 2. Security & File Invariants

- [ ] **ZERO JavaScript files** (`.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`) exist in the package.
- [ ] **ZERO server scripts or binaries** (`.py`, `.php`, `.rb`, `.sh`, `.exe`, `.env`).
- [ ] **ZERO symlinks** inside the archive.
- [ ] Total uncompressed size is well below **100MB** (typically 1-5MB).
- [ ] Total compressed ZIP size is below **20MB**.
- [ ] Archive contains fewer than **500 files**.

---

## 🎨 3. Theme Settings (`settings.json`)

- [ ] Every setting definition includes a valid **`default`** value.
- [ ] For `select` types, the `default` value is present in the `options` array.
- [ ] For `number` types, the default is within `min` and `max` bounds.
- [ ] For `color` types, the default is a valid `#hex` string.
- [ ] All settings referenced in Liquid (e.g. `{{ settings.accentColor }}`) exist in `settings.json`.

---

## 📱 4. Visual & Responsive Polish

- [ ] **Mobile (320px - 480px)**: Navigation menu toggles cleanly, no horizontal scrolling.
- [ ] **Tablet (768px - 1024px)**: Grid cards scale cleanly.
- [ ] **Desktop (1200px - 1600px)**: Reading container is comfortably centered (~740px line length).
- [ ] **Dark Mode**: High contrast and readability when system is set to Dark Theme.
- [ ] **RTL / Arabic**: Text aligns to start, badges, margins, and arrows flip properly with CSS logical properties.
- [ ] **Empty States**: If there are 0 posts, a friendly empty message renders gracefully.
- [ ] **Missing Images**: Posts without `featureImage` render without broken layout.

---

## 🤖 5. Automated Verification

- [ ] Ran `node scripts/validate-theme.mjs my-theme.zip` and all checks returned **PASS**.
- [ ] Successfully uploaded, previewed, and activated on a local or test Vibress instance.

---

**Sign-off:** All checks passed. The theme is ready for production delivery!
