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

The active theme is resolved from the request host's authoritative publication context. The response carries an internal `x-vibress-publication-id` header for the Web theme renderer; callers cannot select a publication by providing a raw publication ID. The JSON response shape is unchanged.

## Publication isolation

Admin routes require a staff session and the corresponding publication permission. Activations, saved settings, external theme installation, and deletion affect only that publication. Built-in themes remain shared, while newly installed external theme packages are stored in publication-scoped namespaces. Migration 0031 clones the old global active configuration and theme settings for existing publications; it does not physically duplicate legacy external theme packages.
Migration 0032 restores an inherited publication's active external-theme version where that legacy package still exists; it does not grant inactive or newly installed default-publication themes to other tenants. Legacy files remain shared and read-only until each publication installs a scoped copy. Replacing or deleting a default-publication theme version still referenced by another publication returns `THEME_SHARED_LEGACY_STORAGE` using the standard error envelope.

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

Updates saved settings for a theme in the authorized publication. If the theme is currently active, the active configuration is updated too. Body must be a JSON object matching the theme's settings schema. Server-side validation rejects unknown keys, wrong types, invalid enums, invalid hex colors, out-of-bounds numbers, and oversized strings.

- 200 `{ theme: { ... } }`
- 404 `THEME_NOT_FOUND` (theme not installed or unknown)
- 400 `THEME_SETTINGS_INVALID` / `VALIDATION_ERROR`

### `POST /themes/:id/preview`

Creates a 15-minute preview token bound to the theme ID and the authenticated publication.

```json
{ "previewToken": "...", "expiresAt": "ISO", "themeId": "vibress-minimal" }
```

### `GET /themes/preview/:token`

Public-safe token resolution. Returns `{ themeId }` only when the request host resolves to the same publication as the token, or 404 when expired, invalid, or resolved for a different publication. Used by the Web preview middleware; the response shape is unchanged.

## Error Semantics

Stable codes: `THEME_NOT_FOUND`, `THEME_INVALID`, `THEME_INCOMPATIBLE`, `THEME_SETTINGS_INVALID`, `THEME_ACTIVATION_FAILED`, `VALIDATION_ERROR`. All errors include `requestId`.
