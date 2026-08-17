# 01 — Vibress Theme System Overview & Architecture

This document explains the architecture of the **Vibress Theme System**, how requests flow through the engine, and how Liquid templates are transformed into high-performance HTML.

---

## 🏗️ The Rendering Pipeline

Vibress uses a dual-engine architecture:

```text
                                  ┌──────────────────────────────┐
                                  │       Visitor Request        │
                                  │      (GET /posts/my-slug)    │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │      Next.js Middleware      │
                                  │  • Content-Security-Policy   │
                                  │  • Cryptographic Nonce       │
                                  │  • Signed Preview Token Auth │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │      Next.js Server Page     │
                                  │  (Fetches Post & Site Data)  │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │    Theme View Model Mapper   │
                                  │  (Maps DB to Safe ViewModels)│
                                  └──────────────┬───────────────┘
                                                 │
                   ┌─────────────────────────────┴─────────────────────────────┐
                   ▼                                                           ▼
    ┌──────────────────────────────┐                            ┌──────────────────────────────┐
    │     Built-in React Theme     │                            │     External Liquid Theme    │
    │  (TypeScript React Component)│                            │    (LiquidJS Engine Render)  │
    └──────────────┬───────────────┘                            └──────────────┬───────────────┘
                   │                                                           │
                   └─────────────────────────────┬─────────────────────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │      Theme Asset Injector    │
                                  │  • Links /theme-assets/...   │
                                  │  • Injects theme settings    │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │    Complete Rendered HTML    │
                                  └──────────────────────────────┘
```

---

## 🎭 Built-in Themes vs. External Themes

| Feature | Built-in React Themes | External Liquid Themes (This Package) |
| :--- | :--- | :--- |
| **Technology** | React / TypeScript TSX | LiquidJS (`.liquid`) + Vanilla CSS |
| **Distribution** | Bundled inside Vibress codebase | Portable ZIP archive uploaded via Admin UI |
| **Modification** | Requires modifying source code & rebuild | Zero-rebuild, uploaded and activated at runtime |
| **Target Audience** | Core platform maintainers | Community designers, agencies, creators |
| **Execution Sandbox** | Server-side React components | In-memory sandbox without OS or DB access |
| **Assets Delivery** | Next.js asset pipeline | `/theme-assets/{themeId}/{version}/...` route |

---

## ⚙️ How External Liquid Themes Work

### 1. In-Memory Virtual Template File System
When an external theme is installed, its templates and assets are unpacked into durable storage. During web requests, Vibress mounts the theme's templates (`templates/*.liquid` and `partials/*.liquid`) into a high-performance in-memory virtual filesystem cache (`MemoryFileSystem`).

### 2. Context Injection
The server passes a sanitized context object into the template:
* `site`: Global publication settings (title, description, logo, navigation, locale, direction)
* `post` / `page` / `tag` / `author`: The active resource being viewed
* `posts`: Array of posts for home, tag, and author archive views
* `pagination`: Page navigation information (page, total, pages, previous, next)
* `settings`: Key-value pairs configured in the admin dashboard matching your `settings.json`
* `theme`: Information about the active theme (`id`, `version`)

### 3. Automatic Stylesheet Linking
If your theme includes `assets/css/theme.css` (or `assets/theme.css`), Vibress automatically injects a `<link rel="stylesheet" href="/theme-assets/{themeId}/{version}/assets/css/theme.css">` tag before the rendered template content.

---

## 🔄 The Theme Lifecycle

```text
1. Upload:
   Admin uploads `theme.zip` via Settings -> Themes.

2. Validation:
   The ZIP security validator checks:
   • File size and quota limits (max 20MB, max 500 files)
   • Strictly NO JavaScript or executable files (.js, .ts, .sh, .py prohibited)
   • Presence of valid `theme.json` manifest with `themeApi: 1`
   • Presence of required templates: `home.liquid`, `post.liquid`, `page.liquid`
   • Existence of declared `previewImage` (e.g. `preview.webp`)
   • Validity of `settings.json` definitions and mandatory default values

3. Installation:
   The theme is unpacked and stored under its version (e.g. `1.0.0`).
   Multiple versions of the same theme can exist side-by-side without collision.

4. Preview:
   Admins can click "Preview" to inspect the theme via a cryptographically signed HMAC token URL:
   `/preview/{token}`
   Public visitors continue to see the current active theme without disruption.

5. Activation:
   When the admin clicks "Activate", Vibress atomically updates the active theme pointer and restores any customized settings. The public site switches instantly with zero downtime and zero server rebuilds.
```

---

Next: Read **[`02-THEME-PACKAGE-SPECIFICATION.md`](./02-THEME-PACKAGE-SPECIFICATION.md)** to understand the exact structure and file rules required for your theme ZIP.
