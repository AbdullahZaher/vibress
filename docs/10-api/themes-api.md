# Themes API

## Public

### `GET /api/content/v1/site`

Returns site metadata and the active theme identity + safe presentation settings (used by the Web Theme Host).

```json
{
  "site": {
    "title": "Vibress",
    "description": "Publishing Platform",
    "url": "https://example.com",
    "locale": "en"
  },
  "theme": {
    "themeId": "vibress-default",
    "settings": {
      "accentColor": "#2563eb",
      "contentWidth": 800,
      "showAuthor": true,
      "showPublicationDate": true,
      "showTags": true,
      "footerText": "All rights reserved.",
      "headerLayout": "standard"
    }
  }
}
```

No authentication required. Contains only presentation-safe settings — never secrets.

## Admin (`/api/admin/v1/themes`)

All admin theme endpoints require a staff session. `themes.read` for reads; `themes.manage` for activate/settings/preview. Unauthenticated → 401; lacking permission → 403.

### `GET /themes`

Lists registered themes with manifest, settings schema, and active state.

### `GET /themes/:id`

Single theme detail. 404 `THEME_NOT_FOUND` if unknown.

### `GET /themes/active`

Active theme identity + current settings.

### `POST /themes/:id/activate`

Activates a registered theme atomically. Validates manifest + API compatibility + settings defaults before persisting. On failure, the previously active theme remains unchanged.

Responses:
- 200 `{ theme: { themeId, themeVersion, settings, settingsSchemaVersion } }`
- 404 `THEME_NOT_FOUND` (unknown/invalid theme id)
- 400 `THEME_INVALID`, `THEME_INCOMPATIBLE`, `THEME_SETTINGS_INVALID`, `THEME_ACTIVATION_FAILED`

### `PATCH /themes/:id/settings`

Updates settings for the **active** theme. Body must be a JSON object matching the theme's settings schema. Server-side validation rejects unknown keys, wrong types, invalid enums, invalid hex colors, out-of-bounds numbers, and oversized strings.

- 200 `{ theme: { ... } }`
- 404 `THEME_NOT_FOUND` (theme not active/unknown)
- 400 `THEME_SETTINGS_INVALID` / `VALIDATION_ERROR`

### `POST /themes/:id/preview`

Creates a short-lived preview token (10 minutes) bound to the theme ID.

```json
{ "previewToken": "...", "expiresAt": "ISO", "themeId": "vibress-minimal" }
```

### `GET /themes/preview/:token`

Public-safe token resolution. Returns `{ themeId }` or 404 when expired/invalid. Used by the Web preview middleware.

## Error Semantics

Stable codes: `THEME_NOT_FOUND`, `THEME_INVALID`, `THEME_INCOMPATIBLE`, `THEME_SETTINGS_INVALID`, `THEME_ACTIVATION_FAILED`, `VALIDATION_ERROR`. All errors include `requestId`.
