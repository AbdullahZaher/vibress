# 16 — Example Design Brief: Tech & Developer Blog Theme

This is a real-world example of a design specification for building a fast, minimalist **Tech & Engineering Blog Theme** for Vibress.

---

## 💻 Theme Summary: *Syntax Mono*

* **Theme Name**: `Syntax Mono`
* **Theme ID**: `syntax-mono`
* **Version**: `1.0.0`
* **Theme API**: `1`
* **Style**: Dark mode by default, code-first aesthetics, high contrast, clean typography, monospace metadata stamps.
* **Target Audience**: Software engineers, open-source maintainers, technical writers, security researchers.

---

## 🎨 Color Palette & Typography

```css
:root {
  --theme-bg: #0d1117;
  --theme-surface: #161b22;
  --theme-border: #30363d;
  --theme-text: #e6edf3;
  --theme-text-muted: #8b949e;
  --theme-accent: #2ea043; /* Terminal green */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
}
```

---

## 📐 Layout Architecture

### 1. Header (`partials/header.liquid`)
* Minimalist terminal-style prompt: `visitor@vibress:~$ cat {{ site.title }}`.
* Clean text links to primary navigation items.
* System theme status indicator (Green dot for online).

### 2. Homepage List (`templates/home.liquid`)
* Clean chronological feed (timeline view).
* Each post card has:
  * Monospace date prefix: `[2026-08-17]`
  * Bold post title linking to article
  * Estimated read time badge: `3 min read`
  * Tag pills in terminal bracket format: `[#rust] [#distributed-systems]`
* Zero visual fluff or heavy background images.

### 3. Post View (`templates/post.liquid`)
* Centered 720px wide reading canvas for maximum readability.
* Code blocks (`<pre><code>`) with dark background, rounded corners, and custom scrollbars.
* Copyable code snippet indicator.
* Author bio styled as a terminal user profile at the bottom.

---

## 🎛️ `settings.json` Schema for Syntax Mono

```json
{
  "fields": [
    {
      "key": "accentColor",
      "type": "color",
      "label": "Terminal Accent Color",
      "description": "Accent color for links, tags, and terminal cursor.",
      "default": "#2ea043"
    },
    {
      "key": "showLineNumbers",
      "type": "boolean",
      "label": "Show Reading Timeline Dates",
      "default": true
    },
    {
      "key": "terminalPrompt",
      "type": "string",
      "label": "Terminal Prompt String",
      "default": "dev@vibress:~#",
      "maxLength": 30
    },
    {
      "key": "codeTheme",
      "type": "select",
      "label": "Code Highlighting Style",
      "options": [
        { "label": "GitHub Dark", "value": "github-dark" },
        { "label": "Monokai Pro", "value": "monokai" },
        { "label": "Nord Clean", "value": "nord" }
      ],
      "default": "github-dark"
    }
  ]
}
```
