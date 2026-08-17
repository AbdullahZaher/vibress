# 08 — Assets, Styling & Pure-CSS Interactions

This document outlines how to structure CSS stylesheets, bundle fonts, handle images, and build modern interactive UI components using **Pure CSS** without JavaScript.

---

## 🎨 Asset Architecture

All theme assets must be placed inside the `assets/` directory:

```text
assets/
├── css/
│   ├── theme.css             <-- Main stylesheet (automatically linked by Vibress)
│   └── components.css        <-- (Optional) Imported via @import in theme.css
├── fonts/
│   ├── inter-var.woff2       <-- Self-hosted web fonts
│   └── newsreader-italic.woff2
└── images/
    ├── hero-pattern.svg      <-- Decorative SVG illustrations
    └── icon-search.svg
```

---

## 🚀 How Vibress Injects Styles

When an external theme is rendered, Vibress wraps the output in a container with your theme ID:

```html
<div class="vibress-liquid-theme-root" data-theme="my-theme">
  <link rel="stylesheet" href="/theme-assets/my-theme/1.0.0/assets/css/theme.css">
  
  <!-- Rendered Liquid Template Body -->
</div>
```

---

## 💎 CSS Design Token Best Practices

Define reusable design tokens at the top of your `assets/css/theme.css`:

```css
:root {
  /* Colors */
  --theme-bg: #ffffff;
  --theme-surface: #f8fafc;
  --theme-border: #e2e8f0;
  --theme-text: #0f172a;
  --theme-text-muted: #64748b;
  --theme-accent: #6366f1;
  --theme-accent-hover: #4f46e5;
  --theme-accent-contrast: #ffffff;

  /* Typography */
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-serif: 'Georgia', 'Cambria', 'Times New Roman', serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;

  /* Spacing & Radii */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --container-max: 1200px;
  --container-narrow: 760px;
}

/* 🌙 Automatic Dark Mode */
@media (prefers-color-scheme: dark) {
  :root {
    --theme-bg: #090d16;
    --theme-surface: #131b2e;
    --theme-border: #1e293b;
    --theme-text: #f8fafc;
    --theme-text-muted: #94a3b8;
  }
}
```

---

## 🔤 Self-Hosting Web Fonts

Bundle `.woff2` font files inside `assets/fonts/` and declare them with `@font-face` in `theme.css`:

```css
@font-face {
  font-family: 'EditorialSerif';
  src: url('/theme-assets/editorial-pro/1.0.0/assets/fonts/editorial-serif.woff2') format('woff2');
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
```
*(Or use relative paths inside `theme.css` such as `url('../fonts/editorial-serif.woff2')`).*

---

## ⚡ Building Interactions with Pure CSS (No-JS)

Because Theme API v1 strictly prohibits JavaScript, modern CSS handles all client-side UI interactions:

### 1. Mobile Navigation Toggle (Using `<details>`)

```liquid
<nav class="mobile-menu">
  <details class="menu-disclosure">
    <summary class="menu-toggle-btn" aria-label="Toggle navigation">
      <span class="icon-hamburger"></span>
    </summary>
    <div class="menu-dropdown">
      {% for item in site.navigation.primary %}
        <a href="{{ item.url }}" class="mobile-nav-link">{{ item.label }}</a>
      {% endfor %}
    </div>
  </details>
</nav>
```

```css
.menu-disclosure summary {
  list-style: none;
  cursor: pointer;
}
.menu-disclosure summary::-webkit-details-marker {
  display: none;
}
.menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--theme-surface);
  border: 1px solid var(--theme-border);
  border-radius: var(--radius-md);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
```

### 2. Pure CSS Accordion / FAQ Dropdown
```liquid
<div class="faq-item">
  <details>
    <summary class="faq-question">What is this publication about?</summary>
    <div class="faq-answer">
      <p>We publish daily insights on technology, design, and architecture.</p>
    </div>
  </details>
</div>
```

### 3. Responsive Grid with CSS Grid & Subgrid
```css
.posts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 2rem;
}

.post-card {
  display: flex;
  flex-direction: column;
  background: var(--theme-surface);
  border: 1px solid var(--theme-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.post-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.15);
}
```

### 4. Reading Progress Bar (Pure CSS Animation Timeline)
```css
@keyframes readingProgress {
  from { width: 0%; }
  to { width: 100%; }
}

.reading-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 4px;
  background: var(--theme-accent);
  width: 100%;
  transform-origin: left;
  animation: readingProgress auto linear;
  animation-timeline: scroll(root);
}
```

---

Next: Read **[`09-SECURITY-RULES.md`](./09-SECURITY-RULES.md)** to understand platform sandboxing and security invariants.
