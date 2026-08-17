# 10 — Responsive Design, RTL (Arabic) & Accessibility Guide

A world-class Vibress theme must look stunning on every screen, respect Right-to-Left (RTL) languages like Arabic, and comply with modern accessibility standards (WCAG 2.2 AA).

---

## 📱 1. Mobile-First Responsive Breakpoints

Design your theme mobile-first, progressively enhancing the layout for larger displays:

```css
/* 📱 Mobile Baseline (320px - 639px) */
.container {
  width: 100%;
  padding-inline: 1rem;
}
.posts-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

/* 📲 Tablet Breakpoint (640px - 1023px) */
@media (min-width: 640px) {
  .container {
    padding-inline: 1.5rem;
  }
  .posts-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 💻 Desktop Breakpoint (1024px - 1279px) */
@media (min-width: 1024px) {
  .container {
    max-width: 1140px;
    margin-inline: auto;
    padding-inline: 2rem;
  }
  .posts-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 2rem;
  }
}

/* 🖥️ Wide Desktop (1280px+) */
@media (min-width: 1280px) {
  .container {
    max-width: 1280px;
  }
}
```

### Fluid Typography with `clamp()`
```css
:root {
  --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --text-title: clamp(1.75rem, 1.5rem + 1.25vw, 2.75rem);
  --text-hero: clamp(2.25rem, 1.75rem + 2.5vw, 4rem);
}

body {
  font-size: var(--text-base);
  line-height: 1.7;
}

h1.hero-title {
  font-size: var(--text-hero);
  line-height: 1.15;
  letter-spacing: -0.02em;
}
```

---

## 🌍 2. Right-to-Left (RTL / Arabic) Support

Vibress natively detects RTL languages (e.g. `ar`, `fa`, `he`, `ur`) and exposes `site.direction` (`"rtl"` or `"ltr"`).

### Best Practice: Use CSS Logical Properties
Always use **logical properties** instead of directional properties (`left`/`right`). Logical properties automatically flip without writing duplicate CSS rules!

| Directional Property (Avoid) | CSS Logical Property (Recommended) |
| :--- | :--- |
| `margin-left: 1rem;` | `margin-inline-start: 1rem;` |
| `margin-right: 2rem;` | `margin-inline-end: 2rem;` |
| `padding-left: 1rem;` | `padding-inline-start: 1rem;` |
| `padding-right: 1.5rem;` | `padding-inline-end: 1.5rem;` |
| `left: 0;` | `inset-inline-start: 0;` |
| `right: 0;` | `inset-inline-end: 0;` |
| `text-align: left;` | `text-align: start;` |
| `border-left: 4px solid;` | `border-inline-start: 4px solid;` |

### Explicit RTL Selectors
If you need specific font or styling adjustments when Arabic is active:

```css
[dir="rtl"] {
  --font-sans: 'IBM Plex Sans Arabic', 'Cairo', system-ui, sans-serif;
  letter-spacing: normal; /* Arabic text should not have wide letter-spacing */
}

[dir="rtl"] .post-meta .bullet-separator {
  margin-inline: 0.5rem;
}
```

### In Liquid Templates:
```liquid
<div class="site-wrapper" dir="{{ site.direction | default: 'ltr' }}" lang="{{ site.locale | default: 'en' }}">
  <!-- Theme content -->
</div>
```

---

## ♿ 3. Web Accessibility (WCAG 2.2 AA)

1. **Semantic HTML Elements**:
   * Use `<header>`, `<nav>`, `<main>`, `<article>`, `<aside>`, `<footer>`.
   * Never use plain `<div>` for clickable buttons; always use `<button>` or `<a href="...">`.

2. **Heading Hierarchy**:
   * Ensure exactly one `<h1>` per page (the site title on homepage, the post title on post pages).
   * Do not skip heading levels (e.g. jumping from `<h1>` to `<h4>`).

3. **Color Contrast & Readability**:
   * Ensure a minimum contrast ratio of **4.5:1** for regular text and **3:1** for large titles against backgrounds.
   * Test both light and dark mode color tokens.

4. **Visible Focus Rings (`:focus-visible`)**:
   ```css
   a:focus-visible,
   button:focus-visible,
   summary:focus-visible {
     outline: 2px solid var(--theme-accent);
     outline-offset: 3px;
     border-radius: var(--radius-sm);
   }
   ```

5. **Image `alt` Attributes**:
   Always provide meaningful fallback `alt` text:
   ```liquid
   <img src="{{ post.featureImage.url }}" alt="{{ post.featureImage.alt | default: post.title }}" />
   ```

6. **Reduced Motion**:
   Respect user preferences for reduced motion:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
       scroll-behavior: auto !important;
     }
   }
   ```

---

Next: Read **[`11-THEME-TESTING-GUIDE.md`](./11-THEME-TESTING-GUIDE.md)** to learn how to test your theme locally before submission.
