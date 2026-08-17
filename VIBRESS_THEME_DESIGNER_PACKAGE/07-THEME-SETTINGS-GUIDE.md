# 07 — Theme Settings Guide (`settings.json`)

Vibress allows theme authors to expose customizable configuration options to the site administrator without modifying code.

---

## 🎨 What is `settings.json`?

`settings.json` defines a schema of editable controls displayed in the **Vibress Admin Panel** (`Settings -> Themes -> Customize`).

When an admin customizes these values:
1. The values are validated against your schema.
2. The values are saved persistently in the database (`theme_settings`).
3. The values are injected into the Liquid context under the `settings` object (e.g. `{{ settings.accentColor }}`).

---

## 📋 Schema Format

You can define your settings using the standard `{ "fields": [ ... ] }` format:

```json
{
  "fields": [
    {
      "key": "accentColor",
      "type": "color",
      "label": "Accent Color",
      "description": "Brand highlight color for buttons and links.",
      "default": "#6366f1"
    },
    {
      "key": "heroHeadline",
      "type": "string",
      "label": "Hero Headline",
      "description": "Headline text on the homepage banner.",
      "default": "Welcome to our Publication",
      "maxLength": 100
    },
    {
      "key": "showAuthorAvatars",
      "type": "boolean",
      "label": "Show Author Avatars",
      "description": "Toggle visibility of author profile portraits.",
      "default": true
    },
    {
      "key": "postsPerPage",
      "type": "number",
      "label": "Posts Per Page",
      "description": "Number of articles shown per page.",
      "default": 10,
      "min": 1,
      "max": 50
    },
    {
      "key": "layoutStyle",
      "type": "select",
      "label": "Grid Layout",
      "description": "Choose between 2-column or 3-column article cards.",
      "options": [
        { "label": "2 Columns (Editorial)", "value": "cols-2" },
        { "label": "3 Columns (Magazine)", "value": "cols-3" }
      ],
      "default": "cols-3"
    }
  ]
}
```

---

## 🏷️ Supported Setting Types

### 1. `string` (Text Input)
* **`default`** (string, **mandatory**): Default text value.
* **`label`** (string): Field title shown in admin.
* **`description`** (string): Helper text explaining what the setting does.
* **`maxLength`** (number): Maximum allowed character count.
* **`minLength`** (number): Minimum allowed character count.

```json
{
  "key": "newsletterHeading",
  "type": "string",
  "label": "Newsletter Callout Heading",
  "default": "Stay updated with our weekly dispatch",
  "maxLength": 80
}
```

---

### 2. `boolean` (Toggle Switch)
* **`default`** (boolean, **mandatory**): `true` or `false`.
* **`label`** (string): Field title.
* **`description`** (string): Helper text.

```json
{
  "key": "showReadingTime",
  "type": "boolean",
  "label": "Show Reading Time",
  "description": "Display estimated minutes to read on post cards.",
  "default": true
}
```

---

### 3. `number` (Numeric Input)
* **`default`** (number, **mandatory**): Valid number.
* **`min`** (number): Minimum allowable value.
* **`max`** (number): Maximum allowable value.
* **`label`** (string): Field title.

```json
{
  "key": "postsPerPage",
  "type": "number",
  "label": "Articles Per Page",
  "default": 12,
  "min": 3,
  "max": 48
}
```

---

### 4. `color` (Hex Color Picker)
* **`default`** (string, **mandatory**): Valid hex code (e.g. `"#6366f1"` or `"#000000"`).
* **`label`** (string): Field title.

```json
{
  "key": "primaryBrandColor",
  "type": "color",
  "label": "Brand Primary Color",
  "default": "#2563eb"
}
```

---

### 5. `select` (Dropdown Selection)
* **`default`** (string, **mandatory**): Must match one of the option values.
* **`options`** (array, **mandatory**): Non-empty array of strings or `{ label, value }` objects.
* **`label`** (string): Field title.

```json
{
  "key": "headerStyle",
  "type": "select",
  "label": "Header Style",
  "description": "Choose the visual style for the site navigation header.",
  "options": [
    { "label": "Minimal Clean", "value": "minimal" },
    { "label": "Centered Classic", "value": "centered" },
    { "label": "Sticky Navigation Bar", "value": "sticky" }
  ],
  "default": "minimal"
}
```

---

## ⚡ Using Settings in Liquid & CSS

### In Liquid Templates:
```liquid
{% if settings.showReadingTime %}
  <span class="read-time">{{ post.readingTimeMinutes }} min read</span>
{% endif %}

<div class="posts-grid layout-{{ settings.layoutStyle | default: 'cols-3' }}">
  <!-- Articles loop -->
</div>
```

### In Dynamic CSS Styling:
You can use Liquid to inject customized theme settings directly as CSS custom properties in your templates or partials:

```liquid
<style>
  :root {
    --theme-accent: {{ settings.accentColor | default: '#6366f1' }};
  }
</style>
```

---

## ⚠️ Important Rules

1. **Every setting MUST have a default value**: The theme validator will reject packages where any setting lacks a valid `default`.
2. **Select defaults must exist in options**: If `default` is `"dark"`, `"dark"` must be listed in the `options` array.
3. **No unknown keys allowed**: If a setting is removed from `settings.json`, it will be cleaned up safely upon the next activation.

---

Next: Read **[`08-ASSETS-AND-STYLING.md`](./08-ASSETS-AND-STYLING.md)** to master styling, typography, and dark mode.
