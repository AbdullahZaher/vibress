# Vibress Theme SDK & Starter Guide

## Overview
Vibress themes provide modular layouts, styles, and typography. Themes are defined with a `theme.json` contract and follow a deterministic fallback template hierarchy.

---

## 1. Theme Manifest (`theme.json`)

```json
{
  "name": "Editorial Minimal",
  "version": "1.0.0",
  "vibressApiVersion": "1.0.0",
  "author": "Vibress Design Team",
  "description": "Clean typography-first theme for modern publications",
  "templates": [
    "default",
    "post",
    "page",
    "tag",
    "author",
    "error-404"
  ],
  "settings": {
    "accentColor": { "type": "color", "default": "#111827", "title": "Accent Color" },
    "fontFamily": { "type": "select", "default": "sans", "options": ["sans", "serif", "mono"], "title": "Typography" },
    "showAuthorBio": { "type": "boolean", "default": true, "title": "Show Author Bio" },
    "headerStyle": { "type": "select", "default": "clean", "options": ["clean", "centered", "minimal"], "title": "Header Style" }
  },
  "locales": ["en", "ar"]
}
```

---

## 2. Template Hierarchy & Fallbacks

When rendering a route, the theme engine checks templates in the following order:

```text
Post Detail (/posts/:slug)
  ├── post-[slug].hbs / .tsx (Custom slug template)
  ├── post-[tag].hbs / .tsx (Tag-specific template)
  ├── post.hbs / .tsx (Generic post template)
  └── index.hbs / .tsx (Root fallback)
```

---

## 3. Starter Theme Structure

```text
my-theme/
├── theme.json
├── index.html / default.hbs
├── post.hbs
├── page.hbs
├── tag.hbs
├── author.hbs
├── assets/
│   ├── css/main.css
│   └── js/main.js
└── locales/
    ├── en.json
    └── ar.json
```

---

## 4. Theme Verification & Preview Contract

Themes can be previewed in real-time before activation using preview tokens:
```http
GET /?preview_theme=my-theme&preview_token=<SIGNED_PREVIEW_JWT>
```
Preview sessions are stateless, time-limited, and isolated from public site traffic.
