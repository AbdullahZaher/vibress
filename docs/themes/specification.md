# Vibress Theme Package Specification (Theme API v1)

The Vibress Theme System allows publishers and developers to install, preview, customize, and activate themes directly through the Admin Panel from a `.zip` archive without requiring source code modifications, registry alterations, server rebuilds, or downtime.

---

## 1. Directory Structure

A valid Vibress external theme package is a standard `.zip` archive structured as follows:

```text
my-theme.zip/
├── theme.json               # Required manifest file
├── settings.json            # Optional theme variables and schema definition
├── preview.webp             # Theme preview banner (or .png / .jpg)
├── templates/               # Liquid template definitions (semantic body markup)
│   ├── home.liquid          # Required: Homepage & article feed
│   ├── post.liquid          # Required: Single article view
│   ├── page.liquid          # Required: Static page view
│   ├── tag.liquid           # Optional: Tag topic archive
│   ├── author.liquid        # Optional: Author profile archive
│   └── archive.liquid       # Optional: Generic chronological archive
├── partials/                # Reusable template components
│   ├── header.liquid
│   ├── footer.liquid
│   └── pagination.liquid
└── assets/                  # Public web styling and static media
    ├── css/
    │   └── theme.css
    ├── images/
    └── fonts/
```

> [!IMPORTANT]
> **Theme API v1 Strict No-JS Policy**: External theme packages are prohibited from including arbitrary client-side JavaScript (`.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`) or server scripts. Next.js owns the document shell, hydration, analytics tracking, portal functionality, and strict Content-Security-Policy (CSP) headers.

---

## 2. Theme Manifest (`theme.json`)

The `theme.json` file is required in every theme package and must adhere to the `themeApi: 1` contract.

```json
{
  "id": "my-custom-theme",
  "name": "My Custom Theme",
  "version": "1.0.0",
  "description": "An elegant editorial publishing theme for Vibress.",
  "author": {
    "name": "Jane Developer",
    "email": "jane@example.com",
    "url": "https://example.com"
  },
  "homepage": "https://example.com/theme",
  "license": "MIT",
  "previewImage": "preview.webp",
  "themeApi": 1,
  "capabilities": ["post", "page", "tag", "author", "archive"],
  "settingsSchemaVersion": 1
}
```

### Manifest Fields

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Lowercase alphanumeric kebab-case identifier (e.g., `minimal-pro`). |
| `name` | `string` | **Yes** | Human-readable name displayed in Admin UI. |
| `version` | `string` | **Yes** | Semantic versioning format `MAJOR.MINOR.PATCH` (e.g. `1.2.0`). |
| `themeApi` | `number` | **Yes** | Target theme API compatibility version. Currently must be `1`. |
| `description` | `string` | No | Short overview of the theme design and intended use case. |
| `author` | `string` \| `object` | No | Author name or object with `name`, `email`, and `url`. |
| `previewImage` | `string` | No | Relative path to thumbnail image (e.g., `preview.webp`). Must exist in ZIP if declared. |
| `capabilities` | `string[]` | No | List of supported view types: `["post", "page", "tag", "author"]`. |
| `settingsSchemaVersion` | `number` | No | Settings specification version (defaults to `1`). |

---

## 3. Settings Schema (`settings.json`)

Themes can expose user-customizable visual options and variables in the Admin Panel by providing a `settings.json` file. All fields require a valid `default` value validated at install time.

```json
{
  "fields": [
    {
      "key": "accentColor",
      "type": "color",
      "label": "Accent Color",
      "description": "Primary accent brand color for buttons and links.",
      "default": "#6366f1"
    },
    {
      "key": "typographyFamily",
      "type": "select",
      "label": "Typography Style",
      "options": [
        { "label": "Modern Sans", "value": "sans" },
        { "label": "Editorial Serif", "value": "serif" }
      ],
      "default": "sans"
    },
    {
      "key": "postsPerPage",
      "type": "number",
      "label": "Posts Per Page",
      "min": 1,
      "max": 50,
      "default": 10
    },
    {
      "key": "showAuthorBio",
      "type": "boolean",
      "label": "Show Author Bio",
      "default": true
    }
  ]
}
```

---

## 4. Multi-Version Lifecycle & Settings Persistence

1. **Parallel Version Storage**: Multiple versions of the same theme identity (e.g. `editorial-pro@1.0.0` and `editorial-pro@2.0.0`) can be installed side-by-side in storage and database.
2. **Atomic Version Switch**: Uploading or installing a new version does not alter the active pointer until the admin explicitly clicks **Activate**.
3. **Settings Persistence**: Custom theme settings configured in Admin survive theme deactivation and reactivation, preventing accidental data loss when switching themes.
