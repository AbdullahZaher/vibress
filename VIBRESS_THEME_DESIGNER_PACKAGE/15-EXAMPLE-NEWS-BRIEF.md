# 15 — Example Design Brief: News & Editorial Magazine Theme

This is a real-world example of a design specification for building a high-density, multi-category **News & Editorial Theme** for Vibress.

---

## 📰 Theme Summary: *The Metropolis Chronicle*

* **Theme Name**: `Metropolis Chronicle`
* **Theme ID**: `metropolis-chronicle`
* **Version**: `1.0.0`
* **Theme API**: `1`
* **Style**: High-density newspaper typography, bold headlines, multi-column editorial grid, breaking news ticker.
* **Target Audience**: Daily news readers, financial analysts, investigative journalism subscribers.

---

## 🎨 Color Palette & Typography

```css
:root {
  --theme-bg: #fbfbfb;
  --theme-surface: #ffffff;
  --theme-border: #111111;
  --theme-text: #1a1a1a;
  --theme-text-muted: #666666;
  --theme-accent: #c026d3; /* Magenta editorial accent */
  --font-serif: 'Playfair Display', 'Georgia', serif;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

---

## 📐 Layout Architecture

### 1. Header & Breaking Banner (`partials/header.liquid`)
* Centered vintage publication masthead (`<h1 class="masthead">{{ site.title | escape }}</h1>`).
* Date and edition stamp: `{{ 'now' | format_date }}` — `{{ settings.newspaperEdition | default: 'Global Digital Edition' | escape }}`.
* Primary navigation bar with full-width black borders top and bottom (`{% for item in site.navigation.primary %}`).

### 2. Homepage Editorial Grid (`templates/home.liquid`)
* **Hero Lead Story (1 large column)**:
  * Giant serif headline (`font-size: 3rem; font-family: var(--font-serif)`).
  * Full-width cover image with photo credits.
  * Long excerpt with a drop-cap initial letter (`p:first-of-type::first-letter`).
* **Sub-Lead Columns (2 side columns)**:
  * 4 compact headline cards with thumbnail images and 50-character excerpts.
* **Trending Section**:
  * Numbered ranking list (1 to 5) for quick reading.

### 3. Article View (`templates/post.liquid`)
* Bold kicker tag at the top: `{% if post.tags.size > 0 %}{{ post.tags[0].name | upcase | escape }}{% endif %}`.
* Multi-author byline with portraits: `{% for author in post.authors %}{{ author.name | escape }}{% endfor %}`.
* Two-column editorial article layout with pull-quotes and image captions.

---

## 🎛️ `settings.json` Schema for Metropolis

```json
{
  "fields": [
    {
      "key": "accentColor",
      "type": "color",
      "label": "Editorial Accent Color",
      "default": "#c026d3"
    },
    {
      "key": "enableDropCaps",
      "type": "boolean",
      "label": "Enable First-Paragraph Drop Caps",
      "description": "Applies a vintage editorial drop cap to the first letter of articles.",
      "default": true
    },
    {
      "key": "breakingTickerText",
      "type": "string",
      "label": "Breaking News Banner Text",
      "description": "Optional text to display on the top ticker bar.",
      "default": "Special Edition: Global tech and financial market analysis.",
      "maxLength": 100
    },
    {
      "key": "newspaperEdition",
      "type": "string",
      "label": "Edition Label",
      "default": "Global Digital Edition",
      "maxLength": 40
    }
  ]
}
```
