# 17 — Example Design Brief: Modern Landing & Newsletter Theme

This is a real-world example of a design specification for building a high-converting **Product & Newsletter Landing Theme** for Vibress.

---

## 🚀 Theme Summary: *Launchpad Creator*

* **Theme Name**: `Launchpad Creator`
* **Theme ID**: `launchpad-creator`
* **Version**: `1.0.0`
* **Theme API**: `1`
* **Style**: High-converting hero section, gradient glows, social proof badges, newsletter callout blocks, modern card grids.
* **Target Audience**: Newsletter creators, course creators, indie hackers, product companies.

---

## 🎨 Color Palette & Typography

```css
:root {
  --theme-bg: #090d16;
  --theme-surface: rgba(255, 255, 255, 0.04);
  --theme-surface-hover: rgba(255, 255, 255, 0.08);
  --theme-border: rgba(255, 255, 255, 0.1);
  --theme-text: #ffffff;
  --theme-text-muted: #94a3b8;
  --theme-accent: #6366f1; /* Electric indigo */
  --theme-accent-gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
  --font-sans: 'Outfit', 'Inter', system-ui, sans-serif;
}
```

---

## 📐 Layout Architecture

### 1. Hero Section (`templates/home.liquid`)
* **Dynamic Headline**: `{{ settings.heroTitle | default: site.title | escape }}` styled with a gradient text clip:
  ```css
  background: var(--theme-accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  ```
* **Tagline & CTA**: Direct CTA button linking to membership portal (`/portal/signup`).
* **Member Count Badge**: `Join 10,000+ founders and engineers` *(static marketing copy unless Core exposes a dynamic metric)*.

### 2. Feature Highlights (Bento Grid)
* Modern glassmorphic cards (`backdrop-filter: blur(12px)`).
* Latest issues showcase with prominent reading time and cover art.

### 3. Dedicated Static Pages (`templates/page.liquid`)
* Custom landing page style with centered value propositions and FAQ accordion.

---

## 🎛️ `settings.json` Schema for Launchpad

```json
{
  "fields": [
    {
      "key": "accentColor",
      "type": "color",
      "label": "Primary Accent",
      "default": "#6366f1"
    },
    {
      "key": "heroTitle",
      "type": "string",
      "label": "Hero Headline",
      "default": "Ideas that move industries forward",
      "maxLength": 100
    },
    {
      "key": "heroSubtitle",
      "type": "string",
      "label": "Hero Subtitle",
      "default": "A weekly curated publication on technology, design, and sustainable growth.",
      "maxLength": 160
    },
    {
      "key": "ctaButtonText",
      "type": "string",
      "label": "CTA Button Label",
      "default": "Subscribe for Free",
      "maxLength": 30
    },
    {
      "key": "enableGlassmorphism",
      "type": "boolean",
      "label": "Enable Glassmorphism Blur",
      "default": true
    }
  ]
}
```
