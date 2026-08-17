# 02 — Theme Package Specification

This document defines the exact filesystem structure, manifest format, size quotas, and file type rules for a Vibress Theme Package (`.zip`).

---

## 📦 Directory Structure

A valid Vibress Theme ZIP must have the following structure (either at the root of the ZIP or inside a single top-level folder):

```text
my-theme/
├── theme.json               <-- [REQUIRED] Theme manifest
├── settings.json            <-- [OPTIONAL] Admin customization schema
├── preview.webp             <-- [REQUIRED] Preview image (or declared in theme.json)
│
├── templates/               <-- [REQUIRED] Page templates
│   ├── home.liquid          <-- [REQUIRED] Homepage (or index.liquid)
│   ├── post.liquid          <-- [REQUIRED] Single article template
│   ├── page.liquid          <-- [REQUIRED] Static page template
│   ├── tag.liquid           <-- [RECOMMENDED] Tag archive template
│   └── author.liquid        <-- [RECOMMENDED] Author profile & archive template
│
├── partials/                <-- [OPTIONAL] Reusable template partials
│   ├── header.liquid        <-- Header & site navigation
│   ├── footer.liquid        <-- Footer navigation & copyright
│   ├── pagination.liquid    <-- Pagination controls
│   └── card.liquid          <-- Article card component
│
└── assets/                  <-- [RECOMMENDED] Presentation assets
    ├── css/
    │   └── theme.css        <-- Primary stylesheet (auto-linked by Vibress)
    ├── fonts/               <-- Web fonts (woff2, woff, ttf)
    └── images/              <-- SVG icons, logos, illustrations
```

---

## 📑 Required vs Optional Files

| File / Folder | Status | Purpose | Fallback Behavior if Missing |
| :--- | :---: | :--- | :--- |
| `theme.json` | **REQUIRED** | Theme metadata & manifest | **Upload rejected** (`THEME_MANIFEST_MISSING`) |
| `templates/home.liquid` | **REQUIRED** | Homepage listing | Can use `index.liquid` instead |
| `templates/post.liquid` | **REQUIRED** | Single post view | **Upload rejected** (`THEME_TEMPLATES_MISSING`) |
| `templates/page.liquid` | **REQUIRED** | Single page view | **Upload rejected** (`THEME_TEMPLATES_MISSING`) |
| `preview.webp` | **REQUIRED** | Admin panel preview thumbnail | Can use `preview.png` or `preview.jpg` or path declared in `theme.json` |
| `settings.json` | Optional | Custom admin UI settings | Theme uses hardcoded values or defaults |
| `templates/tag.liquid` | Recommended | Tag taxonomy archive | Falls back to built-in tag view |
| `templates/author.liquid` | Recommended | Author profile & post list | Falls back to built-in author view |
| `partials/` | Optional | Modular template components | N/A |
| `assets/css/theme.css` | Recommended | Main stylesheet | Theme will have no styles unless embedded inline |

---

## 🏷️ Theme Manifest (`theme.json`) Specification

The `theme.json` file is a standard JSON object containing the theme's identity:

```json
{
  "id": "editorial-pro",
  "name": "Editorial Pro",
  "version": "1.0.0",
  "description": "Sophisticated typography-focused theme for publications and magazines.",
  "author": {
    "name": "Design Studio",
    "email": "hello@designstudio.com",
    "url": "https://designstudio.com"
  },
  "homepage": "https://designstudio.com/themes/editorial-pro",
  "license": "MIT",
  "previewImage": "preview.webp",
  "themeApi": 1,
  "capabilities": ["post", "page", "tag", "author", "archive"],
  "settingsSchemaVersion": 1
}
```

### Manifest Fields Description

| Field | Type | Required? | Validation Rules | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `string` | **Yes** | Lowercase alphanumeric + hyphens: `/^[a-z0-9][a-z0-9-]*$/`<br>Min 1, Max 100 chars | Unique machine identifier (e.g. `minimal-blog`) |
| `name` | `string` | **Yes** | Min 1, Max 100 chars | Human-readable title displayed in admin |
| `version` | `string` | **Yes** | Strict semver: `/^\d+\.\d+\.\d+$/` | Version string (e.g. `1.0.0`, `1.2.1`) |
| `themeApi` | `number` | **Yes** | Must be `1` | API compatibility version |
| `description` | `string` | No | Max 500 chars | Short summary of the theme |
| `author` | `string` or `object` | No | If object: `{ name, email, url }` | Author name or details |
| `homepage` | `string` | No | Valid URL | Theme demo or documentation website |
| `license` | `string` | No | Max 50 chars | Open-source or commercial license name |
| `previewImage` | `string` | No | Must match an existing file in the package | Relative path to preview image (default `preview.webp`) |
| `capabilities` | `string[]` | No | Array of strings | Declared capabilities (e.g. `["post", "page", "tag"]`) |
| `settingsSchemaVersion` | `number` | No | Default `1` | Schema version for settings definitions |

---

## 🛡️ Package Limits & Quotas

The Vibress validator enforces the following limits:

| Limit | Maximum Allowed | Error Code if Exceeded |
| :--- | :--- | :--- |
| **Max ZIP Archive Size** | **20 MB** (`20 * 1024 * 1024` bytes) | `THEME_ZIP_TOO_LARGE` |
| **Max Uncompressed Size** | **100 MB** (`100 * 1024 * 1024` bytes) | `THEME_ZIP_BOMB_DETECTED` |
| **Max Single File Size** | **10 MB** (`10 * 1024 * 1024` bytes) | `THEME_FILE_TOO_LARGE` |
| **Max File Count** | **500 files** | `THEME_ZIP_TOO_MANY_FILES` |
| **Max Compression Ratio** | **20 : 1** | `THEME_ZIP_BOMB_DETECTED` |
| **Max Path Length** | **255 characters** | `THEME_ZIP_SLIP_DETECTED` |

---

## 📂 Allowed vs Prohibited File Types

### ✅ Allowed File Extensions
Only presentation-related file extensions are permitted:
* **Templates**: `.liquid`, `.html`
* **Styles**: `.css`
* **Configuration**: `.json`, `.txt`, `.md`
* **Images**: `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.ico`
* **Fonts**: `.woff2`, `.woff`, `.ttf`, `.eot`

### 🚫 Strictly Prohibited File Extensions
Any executable or script file causes **instant rejection**:
* **JavaScript / TypeScript**: `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`
* **Server Code & Scripts**: `.py`, `.php`, `.rb`, `.sh`, `.bat`, `.cmd`, `.exe`, `.bin`
* **System & Environment**: `.env`, `.yml`, `.yaml`, `.node`, `.wasm`, `.dll`, `.so`
* **Symlinks**: Symlinked files inside the ZIP are strictly rejected (`THEME_ZIP_SYMLINK_FORBIDDEN`).

---

Next: Read **[`03-THEME-API-V1.md`](./03-THEME-API-V1.md)** to see the full capabilities of Theme API v1.
