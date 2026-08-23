# Vibress Theme Localization & RTL Development Guide

This guide describes how to develop, localize, and certify themes for Vibress with full multilingual and bidirectional (LTR & RTL) support.

---

## 1. Overview of Multilingual Architecture

Vibress uses an **ambient locale context** model:
- The active locale (`locale`) and writing direction (`direction`: `"ltr"` | `"rtl"`) are supplied to every Liquid template and filter.
- Locale-prefixed routing is automatic: English (`/`), Arabic (`/ar`), French (`/fr`), Persian (`/fa`), etc.
- No layout shifts: The root HTML attributes (`<html lang="..." dir="...">`) are emitted synchronously by server middleware.

---

## 2. Theme Manifest Configuration (`theme.json`)

Declare localization capabilities and supported locales in your theme's `theme.json`:

```json
{
  "id": "my-custom-theme",
  "name": "My Custom Theme",
  "version": "1.0.0",
  "author": {
    "name": "Studio Author",
    "email": "author@example.com"
  },
  "capabilities": ["post", "page", "tag", "author", "archive"],
  "localization": {
    "supportsLocales": ["*"],
    "rtl": true,
    "dynamicLocale": true,
    "localizedNavigation": true,
    "localizedDates": true,
    "dictionaryDir": "locales"
  },
  "settingsSchemaVersion": 1
}
```

---

## 3. CSS Logical Properties (Mandatory for RTL)

Never use physical directional CSS rules (`left`, `right`, `margin-left`, `padding-right`, `text-align: left`). Use standard **CSS Logical Properties**:

| Physical Property (Forbidden) | Logical Property (Required) | Behavior in LTR | Behavior in RTL |
| :--- | :--- | :--- | :--- |
| `margin-left: 16px` | `margin-inline-start: 16px` | Left margin | Right margin |
| `margin-right: 16px` | `margin-inline-end: 16px` | Right margin | Left margin |
| `padding-left: 24px` | `padding-inline-start: 24px` | Left padding | Right padding |
| `padding-right: 24px` | `padding-inline-end: 24px` | Right padding | Left padding |
| `left: 0` | `inset-inline-start: 0` | Pin to left | Pin to right |
| `right: 0` | `inset-inline-end: 0` | Pin to right | Pin to left |
| `text-align: left` | `text-align: start` | Left aligned | Right aligned |
| `text-align: right` | `text-align: end` | Right aligned | Left aligned |
| `border-left: 2px solid` | `border-inline-start: 2px solid` | Left border | Right border |

### Directional Icons & Chevrons
When rendering directional icons (such as next/previous navigation chevrons or back arrows), wrap them in an element and mirror in RTL:
```css
[dir="rtl"] .pagination-arrow {
  transform: scaleX(-1);
}
```

---

## 4. Theme Translation Dictionaries

Create a `locales/` directory in your theme containing translation JSON files:

### `locales/en.json` (Base / Default)
```json
{
  "theme.readMore": "Read more",
  "theme.minRead": "min read",
  "theme.featured": "Featured",
  "theme.latestArticles": "Latest Articles",
  "theme.noPosts": "No articles published yet."
}
```

### `locales/ar.json` (Arabic)
```json
{
  "theme.readMore": "اقرأ المزيد",
  "theme.minRead": "دقيقة قراءة",
  "theme.featured": "مميز",
  "theme.latestArticles": "أحدث المقالات",
  "theme.noPosts": "لا توجد مقالات منشورة بعد."
}
```

> **Key Parity Rule:** Every key defined in `en.json` must be present in `ar.json` and any other supported locale file.

---

## 5. Liquid Localization Tags & Filters

### 1. Translation Filter (`t`)
Translates a key from the active theme or core dictionary:
```liquid
<a href="{{ post.url }}" class="read-more-btn">
  {{ 'theme.readMore' | t }} &rarr;
</a>
```

### 2. Localized Date Formatting (`format_date` / `format_hijri`)
```liquid
<time datetime="{{ post.publishedAt }}">
  {{ post.publishedAt | format_date: 'long' }}
</time>

{% if localeContext.isRTL %}
  <span class="hijri-date">{{ post.publishedAt | format_hijri }}</span>
{% endif %}
```

### 3. Localized Number Formatting (`format_number`)
```liquid
<span>{{ post.readingTime | format_number }} {{ 'theme.minRead' | t }}</span>
```

### 4. Language Switcher Tag (`locale_switcher`)
Emits an accessible dropdown or link list preserving current resource URLs:
```liquid
<div class="header-lang">
  {% locale_switcher %}
</div>
```

---

## 6. Theme Certification

Before publishing or distributing your theme, verify it passes the automated Theme Certification:

```bash
pnpm certify:theme path/to/theme
```

Expected result:
```json
{
  "certified": true,
  "score": 100,
  "rtl": true,
  "localized": true,
  "arabic": true
}
```
