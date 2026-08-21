# 07 — Theme Settings Guide (`settings.json`)

Vibress allows theme authors to expose customizable configuration options to the site administrator without modifying template code.

---

## 🎨 What is `settings.json`?

`settings.json` defines a schema of editable controls displayed in the **Vibress Admin Panel** (`Settings -> Themes -> Customize`).

When an admin customizes these values:
1. The values are validated against your schema.
2. The values are saved persistently in the database (`theme_settings`).
3. The values are injected into the Liquid context under the `settings` object (e.g. `{{ settings.accentColor }}`).

> [!IMPORTANT]
> **Theme Settings Scope (Presentation Only)**:
> Theme settings strictly control **styling, visual options, and presentation flags** (colors, typography choices, layout columns, hero banners, feature toggles). Data querying logic, member access control, and pagination limits are managed exclusively by **Vibress Core**.

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
      "key": "layoutStyle",
      "type": "select",
      "label": "Grid Layout",
      "description": "Choose between 2-column editorial or 3-column magazine cards.",
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
  "key": "heroHeadline",
  "type": "string",
  "label": "Hero Headline",
  "default": "Ideas, Stories & Publications",
  "maxLength": 120
}
```

---

### 2. `boolean` (Toggle Switch)
* **`default`** (boolean, **mandatory**): `true` or `false`.
* **`label`** (string): Field title.
* **`description`** (string): Helper text.

```json
{
  "key": "showPublicationDate",
  "type": "boolean",
  "label": "Show Publication Dates",
  "default": true
}
```

---

### 3. `number` (Numeric Input)
* **`default`** (number, **mandatory**): Default numeric value.
* **`label`** (string): Field title.
* **`min`** (number): Minimum allowed value.
* **`max`** (number): Maximum allowed value.

```json
{
  "key": "cardBorderRadius",
  "type": "number",
  "label": "Card Border Radius (px)",
  "default": 12,
  "min": 0,
  "max": 32
}
```

---

### 4. `color` (Color Picker)
* **`default`** (string, **mandatory**): Valid Hex color code (`#RGB`, `#RRGGBB`, `#RRGGBBAA`).
* **`label`** (string): Field title.

```json
{
  "key": "accentColor",
  "type": "color",
  "label": "Brand Accent Color",
  "default": "#6366f1"
}
```

---

### 5. `select` (Dropdown Menu)
* **`default`** (string, **mandatory**): Default option value.
* **`options`** (array, **mandatory**): List of options (`{ label, value }` or plain strings).

```json
{
  "key": "typographyFamily",
  "type": "select",
  "label": "Typography Style",
  "options": [
    { "label": "Modern Sans (Inter)", "value": "sans" },
    { "label": "Editorial Serif (Georgia)", "value": "serif" },
    { "label": "Technical Mono (JetBrains Mono)", "value": "mono" }
  ],
  "default": "sans"
}
```

---

## 💻 Using Settings in Liquid

Access customized settings anywhere in Liquid templates:

```liquid
<div class="theme-container font-{{ settings.typographyFamily | default: 'sans' }}">
  <h1 class="hero-title">{{ settings.heroHeadline | default: site.title | escape }}</h1>

  {% if settings.showPublicationDate and post.publishedAt %}
    <time>{{ post.publishedAt | format_date }}</time>
  {% endif %}
</div>
```

---

Next: Read **[`08-ASSETS-AND-STYLING.md`](./08-ASSETS-AND-STYLING.md)** for styling best practices.
