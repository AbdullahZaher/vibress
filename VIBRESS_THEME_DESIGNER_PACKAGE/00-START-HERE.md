# 00 — Start Here: Vibress Theme Developer Guide

Welcome to the official **Vibress Theme Designer & Developer Package**. 

If you are a UI/UX designer, frontend engineer, or web developer tasked with creating a theme for **Vibress**, this guide gives you everything you need to build, test, and deliver a production-ready theme.

---

## 🧭 What is Vibress?

**Vibress** is a modern, high-performance publishing platform engineered for content creators, publishers, magazines, independent blogs, and media outlets.

```text
┌────────────────────────────────────────────────────────┐
│                      VIBRESS CORE                      │
│  Database · Authentication · Admin Dashboard · Posts   │
│  Pages · Authors · Tags · Newsletters · Media Storage  │
└───────────────────────────┬────────────────────────────┘
                            │ (Injects View Models)
                            ▼
┌────────────────────────────────────────────────────────┐
│                  THEME PRESENTATION LAYER              │
│    Liquid Templates · CSS Stylesheets · SVG / Images   │
└────────────────────────────────────────────────────────┘
```

### Strict Separation of Responsibilities

* **Vibress Core Owns**:
  * Database persistence & migrations
  * API endpoints, authentication, roles & permissions
  * Routing, SEO metadata headers, document shell (`<html>`, `<head>`, `<meta>`)
  * Member subscriptions, billing, and email newsletters
  * Content sanitization and Content-Security-Policy (CSP) headers

* **Your Theme Owns**:
  * HTML structure inside Liquid templates (`templates/*.liquid`)
  * Modular UI components (`partials/*.liquid`)
  * Visual styling and animations (`assets/css/*.css`)
  * Static presentation assets (`assets/fonts/*`, `assets/images/*`)
  * Configurable design settings exposed to the site owner (`settings.json`)

---

## 🚫 What is NOT Allowed in Themes

To guarantee security, instant zero-rebuild installation, and long-term upgradeability, Vibress enforces strict sandboxing rules:

1. **NO JavaScript in Theme Packages**: Theme API v1 strictly prohibits `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, `.tsx` files inside theme packages. All interactivity must be achieved using modern CSS (e.g. CSS Grid/Flexbox, animations, `:has()`, `:focus-within`, custom checkboxes/details toggles, SVG).
2. **NO Backend/Server-Side Code**: No Python, PHP, Ruby, Shell scripts, `.env` files, or binaries.
3. **NO Database Queries or Custom Schemas**: Themes receive typed ViewModels from the core; you cannot run SQL or fetch arbitrary external databases.
4. **NO Build Step Required by the End User**: The theme ZIP is installed directly via the Admin UI. It must never require running `npm install`, `pnpm install`, or compiling assets after upload.

---

## 📦 What Must Be Delivered

When you finish your theme, you will deliver a single `.zip` file (e.g. `vibress-editorial-theme-v1.0.0.zip`) containing:

```text
my-theme/
├── theme.json            <-- Mandatory manifest (ID, version, API version, capabilities)
├── settings.json         <-- Optional/Recommended runtime settings schema
├── preview.webp          <-- Mandatory screenshot preview (WebP / PNG / JPG)
├── assets/
│   ├── css/
│   │   └── theme.css     <-- Main stylesheet (automatically linked by Vibress)
│   └── images/           <-- Icons, logos, decorative illustrations
├── partials/             <-- Reusable snippets (header, footer, pagination, cards)
│   ├── header.liquid
│   ├── footer.liquid
│   └── pagination.liquid
└── templates/            <-- Page layout templates
    ├── home.liquid       <-- Homepage (or index.liquid) [REQUIRED]
    ├── post.liquid       <-- Article detail view [REQUIRED]
    ├── page.liquid       <-- Static page view [REQUIRED]
    ├── tag.liquid        <-- Tag taxonomy archive [REQUIRED]
    └── author.liquid     <-- Author archive view [REQUIRED]
```

---

## ⚡ The Theme Development Workflow

Follow this step-by-step workflow:

```text
1. Read the Docs (01-12)
         ↓
2. Choose Design Direction & Fill Brief (13-17)
         ↓
3. Copy the Official Starter Theme (`starter-theme/`)
         ↓
4. Update `theme.json` with your Theme ID & Name
         ↓
5. Build Liquid Templates (`templates/*.liquid`)
         ↓
6. Style with Modern CSS (`assets/css/theme.css`)
         ↓
7. Define Theme Settings (`settings.json`)
         ↓
8. Validate Package (`node scripts/validate-theme.mjs`)
         ↓
9. Package ZIP & Deliver!
```

---

## 📚 Reading Order

To get the most out of this package, read the documents in this sequence:

| Document | Purpose |
| :--- | :--- |
| **[`01-VIBRESS-THEME-OVERVIEW.md`](./01-VIBRESS-THEME-OVERVIEW.md)** | Architecture & how Vibress renders Liquid templates |
| **[`02-THEME-PACKAGE-SPECIFICATION.md`](./02-THEME-PACKAGE-SPECIFICATION.md)** | ZIP structure, file limits, and manifest requirements |
| **[`03-THEME-API-V1.md`](./03-THEME-API-V1.md)** | Supported features, capabilities, and boundaries |
| **[`04-LIQUID-TEMPLATING-GUIDE.md`](./04-LIQUID-TEMPLATING-GUIDE.md)** | Liquid tags, loops, conditionals, and rendering partials |
| **[`05-VIEW-MODELS-REFERENCE.md`](./05-VIEW-MODELS-REFERENCE.md)** | Complete reference of all data variables (`site`, `post`, etc.) |
| **[`06-ROUTES-AND-HELPERS.md`](./06-ROUTES-AND-HELPERS.md)** | URLs, asset resolution, and date formatting helpers |
| **[`07-THEME-SETTINGS-GUIDE.md`](./07-THEME-SETTINGS-GUIDE.md)** | Custom admin customization controls (colors, fonts, toggles) |
| **[`08-ASSETS-AND-STYLING.md`](./08-ASSETS-AND-STYLING.md)** | CSS design tokens, typography, dark mode, and fonts |
| **[`09-SECURITY-RULES.md`](./09-SECURITY-RULES.md)** | Security constraints and forbidden file types |
| **[`10-RESPONSIVE-RTL-ACCESSIBILITY.md`](./10-RESPONSIVE-RTL-ACCESSIBILITY.md)** | Mobile responsiveness, RTL (Arabic) support, and a11y |
| **[`11-THEME-TESTING-GUIDE.md`](./11-THEME-TESTING-GUIDE.md)** | Edge case testing (empty states, long titles, pagination) |
| **[`12-PACKAGING-AND-DELIVERY.md`](./12-PACKAGING-AND-DELIVERY.md)** | Packaging guidelines and delivery instructions |
| **[`13-DESIGN-BRIEF-TEMPLATE.md`](./13-DESIGN-BRIEF-TEMPLATE.md)** | Specification template to plan your custom theme |
| **[`14-DELIVERY-CHECKLIST.md`](./14-DELIVERY-CHECKLIST.md)** | Final validation checklist before sending files |

Let's begin by reading **[`01-VIBRESS-THEME-OVERVIEW.md`](./01-VIBRESS-THEME-OVERVIEW.md)**!
