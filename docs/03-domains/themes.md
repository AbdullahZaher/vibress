# Themes Domain

## Overview

The Vibress Theme Engine allows switching the public presentation of a Vibress site at runtime without rebuilding, redeploying, or modifying content.

**Architecture invariant**: A theme controls _presentation only_. It never owns content, publishing, routing security, storage, or database access.

```
Content Core
      ↓
Public Content API / Public DTOs
      ↓
Theme Host (apps/web)
      ↓
Active Theme
```

## Security Model

**Batch 7 themes are TRUSTED, BUILD-TIME REGISTERED CODE.**

- Theme packages are source-controlled and registered explicitly in `packages/themes-registry`.
- Theme selection from the database may choose only an existing registered Theme ID.
- Vibress does NOT execute arbitrary uploaded JavaScript/React code at runtime.
- Dynamic third-party theme installation (marketplace, ZIP upload, remote npm install) is **out of scope** for Batch 7.
- Theme IDs are validated with a strict lowercase-alphanumeric-hyphen regex; path injection (`../../`, `file:///`, `node:fs`) is rejected with `THEME_NOT_FOUND`.

## Theme Contract (`@vibress/theme-core`)

- `ThemeManifest` — id, name, version (semver), description, author, themeApi, capabilities, settingsSchemaVersion.
- `ThemeSettingsSchema` — declarative data-only setting definitions (string, boolean, number, color, select).
- `ThemeIdSchema` — strict safe ID validation.
- `validateThemeManifest`, `validateThemeCompatibility`, `validateThemeSettings`, `mergeThemeSettings`.
- `THEME_API_VERSION = 1`.

## Registered Themes

| ID                | Name            | Notes                                                  |
| ----------------- | --------------- | ------------------------------------------------------ |
| `vibress-default` | Vibress Default | Clean reading layout (refactored Batch 6 presentation) |
| `vibress-minimal` | Vibress Minimal | Stark typography-first layout                          |

Both provide: Layout, Home, Post, Page, TagArchive, AuthorArchive. Studio card CSS is namespaced under `.studio-html-content` and `kg-*` compatibility classes.

## Persistence (`packages/domains/themes`)

- Table `theme_configurations` stores: theme_id, theme_version, settings_json, settings_schema_version, activated_by, activated_at, updated_at.
- Singleton: exactly one active row; `setActive` upserts the single row atomically.
- `ThemeService.activateTheme` validates the registered theme (manifest, compatibility, settings defaults) **before** persisting — a failed activation leaves the current theme intact.
- `ThemeService.updateThemeSettings` validates server-side (types, enum options, hex color format, bounds, string length, unknown keys) before persisting.
- Invalid persisted settings fall back to schema defaults with logging; they never crash the site.

## Public Endpoints

- `GET /api/content/v1/site` — site metadata + active theme id + safe presentation settings (used by Web Theme Host).

## Admin Endpoints (`/api/admin/v1/themes`)

- `GET /themes` — list registered themes + active state (permission `themes.read`).
- `GET /themes/:id` — single theme (permission `themes.read`).
- `GET /themes/active` — active theme + settings (permission `themes.read`).
- `POST /themes/:id/activate` — activate (permission `themes.manage`). Atomic; invalid/incompatible themes rejected with stable codes.
- `PATCH /themes/:id/settings` — update settings (permission `themes.manage`). Validated server-side.
- `POST /themes/:id/preview` — create short-lived preview token (permission `themes.manage`).
- `GET /themes/preview/:token` — resolve preview token → theme id (public-safe, token-bound).

Stable error codes: `THEME_NOT_FOUND`, `THEME_INVALID`, `THEME_INCOMPATIBLE`, `THEME_SETTINGS_INVALID`, `THEME_ACTIVATION_FAILED`.

## Permissions

- `themes.read` — list/read themes (Owner, Administrator, Editor).
- `themes.manage` — activate, update settings, preview (Owner, Administrator, Editor).

## Web Theme Host (`apps/web`)

- `src/themes/registry.ts` — trusted static registry of React theme modules.
- `src/themes/{default,minimal}/` — theme definitions + components.
- `src/lib/theme-host.ts` — resolves active theme + settings from `/api/content/v1/site`, merges defaults over persisted values.
- Routes fetch public content then delegate to `theme.components.X`; routing remains owned by `apps/web`.
- Theme CSS served at `/theme-assets/<theme-id>/<version>/<file>.css` from a Web route handler with a strict allowlist (no arbitrary file serving).
- Preview: `/preview/:token/...` — middleware resolves the token server-side, sets an internal header, and rewrites to the canonical public path. Visitors cannot select arbitrary themes via query params.

## Admin UI

`/admin/settings/themes` — theme cards (name, version, description, active badge), Preview, Activate, and a settings editor (color, number, boolean, string, select) with server-side validation.

## Cache Freshness

- Web fetches active theme + settings per request with `no-store`; activation and settings changes appear immediately on the next public request.
- No rebuild, restart, or deployment is required for theme activation or settings changes.
