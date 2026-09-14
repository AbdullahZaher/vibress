# VIBRESS — THEME ARCHITECTURE & MARKETPLACE ECOSYSTEM PLAN
## Liquid Template Engine Hardening, Developer SDK & Theme Distribution Ecosystem

---

## 1. Audit of Current Theme Engine & Capabilities

### Current Strengths
1. **Isolated Liquid Template Execution**:
   - `packages/theme-core/src/theme-engine.ts` implements `MemoryFileSystem` for LiquidJS.
   - All template files (`templates/*.liquid`, `partials/*.liquid`) are stored in an in-memory dictionary. Liquid's `render()` can never traverse into the host server's local filesystem.
2. **Defensive Archive Ingestion**:
   - `packages/theme-core/src/zip-validator.ts` executes multi-layer validation before unpacking:
     - Magic bytes verification (`PK\x03\x04`).
     - Size limits: 25MB archive limit, 100MB uncompressed limit (zip bomb defense).
     - File count limits (max 500 files).
     - CRC32 checksums verified on every entry.
     - Strict path normalization: rejects paths containing `..`, absolute paths, or invalid characters (zip slip defense).
     - Dangerous extension blocklist (`.exe`, `.sh`, `.php`, `.js`, `.py`, `.env`).
3. **Full Multilingual & RTL Support**:
   - Custom Liquid filters for localization: `t`, `translate`, `is_rtl`, `direction`, `asset_url`, `post_url`, `tag_url`, `author_url`.
   - Native bidirectional styling support in Starter and Magazine themes.

### Limitations Preventing an Open Ecosystem Today
1. **No Remote Theme Marketplace**: Themes can only be installed via manual ZIP upload or compiled into `themes-registry`.
2. **No Developer Verification CLI**: Theme authors lack an official CLI command (e.g. `vibress theme check`) to validate schemas and render templates offline.
3. **Missing Automated Update Lifecycle**: When a new version of an external theme is uploaded, settings schemas are not automatically migrated with fallback defaults.

---

## 2. Target Design: The Vibress Theme Ecosystem

```
┌────────────────────────────────────────────────────────────────────────┐
│                        VIBRESS THEME MARKETPLACE                       │
│  • Public Catalog (Free & Commercial Themes)                           │
│  • Cryptographic Package Signing & Automated Certification Pipeline    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ADMIN THEME MANAGEMENT                          │
│  • 1-Click Install from Marketplace                                   │
│  • Live Interactive Theme Customizer & Real-Time Preview               │
│  • Schema Migration Engine for Version Upgrades                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        THEME ENGINE RUNTIME                            │
│  • In-Memory LiquidJS Template Renderer                                │
│  • Multi-Version Theme Storage (S3 / Local Volume)                     │
│  • Fast CDN Asset Distribution (/theme-assets/:id/:ver/*)              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Theme Specification & Manifest Format (v1.0)

Every theme must include a canonical `theme.json` manifest:

```json
{
  "name": "Marrowe Magazine",
  "id": "marrowe-magazine",
  "version": "1.2.0",
  "themeApi": "1.0",
  "author": {
    "name": "Vibress Studio",
    "url": "https://vibress.io",
    "email": "themes@vibress.io"
  },
  "description": "Premium editorial magazine theme with deep RTL typography and dark mode support.",
  "license": "MIT",
  "previewImage": "assets/images/preview.webp",
  "features": [
    "rtl",
    "dark_mode",
    "custom_fonts",
    "membership_tiers",
    "newsletters"
  ],
  "templates": {
    "home": "templates/home.liquid",
    "post": "templates/post.liquid",
    "page": "templates/page.liquid",
    "tag": "templates/tag.liquid",
    "author": "templates/author.liquid",
    "members": {
      "signup": "templates/members/signup.liquid",
      "signin": "templates/members/signin.liquid",
      "account": "templates/members/account.liquid"
    }
  },
  "settingsSchema": {
    "version": 1,
    "sections": [
      {
        "id": "branding",
        "title": "Branding & Typography",
        "fields": [
          {
            "id": "accent_color",
            "type": "color",
            "label": "Accent Color",
            "default": "#3eb083"
          },
          {
            "id": "headline_font",
            "type": "select",
            "label": "Headline Font",
            "options": ["Outfit", "Inter", "Playfair", "Amiri"],
            "default": "Outfit"
          }
        ]
      }
    ]
  }
}
```

---

## 4. Theme Certification & Automated Test Suite

Before any theme is accepted into the marketplace or allowed for production deployment, it must pass the **Vibress Theme Certifier** (`packages/theme-core/src/theme-certifier.ts`):

1. **Manifest Integrity**:
   - `id` matches regex `^[a-z0-9-]+$`.
   - `themeApi` satisfies current runtime version constraint.
2. **Template Completeness**:
   - Mandatory templates exist: `templates/home.liquid`, `templates/post.liquid`, `templates/page.liquid`.
   - Partials referenced via `{% render 'name' %}` resolve cleanly in `partials/`.
3. **Security Constraints**:
   - Zero raw script injection in template variables without `| escape` or approved sanitized filters.
   - Assets referenced in templates exist within `assets/`.
4. **RTL & Accessibility Certification**:
   - CSS supports logical properties (`margin-inline-start`, `inset-inline`, etc.).
   - Includes Arabic/RTL preview test rendering.

---

## 5. Live Interactive Customizer Architecture

To deliver an exceptional theme customization experience in Admin:
1. **Isolated Preview Iframe**:
   - Admin renders `<iframe src="/?preview_theme=:id&preview_nonce=:token" />`.
   - Fastify sets `X-Frame-Options: SAMEORIGIN` and scoped CSP allowing embedding exclusively within the Admin dashboard.
2. **PostMessage Communication**:
   - As the editor tweaks colors, fonts, or toggles in `ThemeCustomizerPanel`, the admin sends:
     ```js
     iframe.contentWindow.postMessage({ type: 'VIBRESS_THEME_PREVIEW_UPDATE', settings }, '*');
     ```
   - A lightweight client script in the preview frame updates CSS custom properties in real time without full page reload.
3. **Atomic Save**:
   - On clicking "Save & Publish", settings are persisted to the database and cached in Redis.
