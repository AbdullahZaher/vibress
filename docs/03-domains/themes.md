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

Built-in React themes are trusted, build-time registered code. External themes may be installed from validated ZIP packages as data/templates; uploaded packages do not grant access to server-side JavaScript execution, database internals, or private APIs.

- Theme selection is restricted to the built-in registry and packages installed for the authorized publication.
- Theme IDs and archive paths are validated; public external asset serving allows presentation assets rather than template/config/source files.
- External theme storage is namespaced by publication for new installations. A legacy unscoped read fallback supports pre-isolation packages only when scoped package storage is absent.
- Public asset resolution uses an authoritative host-derived publication; staff theme operations use permission-checked publication context.

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

- Table `theme_configurations` stores one active row **per publication**, including publication_id, theme_id, theme_version, settings_json, settings_schema_version, activated_by, activated_at, updated_at.
- Table `theme_settings` stores independent settings keyed by `(publication_id, theme_id)`.
- `setActive` upserts on the unique publication key; theme settings, installation and removal operations are publication-scoped.
- Migration `0031_theme_publication_isolation` clones legacy global activation and saved settings to every existing publication, preserving JSON and original default-publication row IDs. Ambiguous legacy activation fails the upgrade instead of silently choosing a row.
- Schema migration 0031 does not duplicate external theme binaries. Operators must keep legacy theme storage accessible for upgraded installations and review external theme ownership when migrating multi-publication sites.
- Additive migration 0032 restores inherited installed-theme metadata only for publications identifiable from 0031's inherited configuration IDs. Fresh publications receive no legacy external themes; existing publication-specific installations take precedence.
- Legacy shared theme files remain at their original path until a publication installs its own scoped copy. Attempts to replace or uninstall a default-publication package still referenced by another publication fail with `THEME_SHARED_LEGACY_STORAGE`. Back up legacy storage and migrate each publication to its own installation before retiring shared files.
- `ThemeService.activateTheme` validates the registered theme (manifest, compatibility, settings defaults) **before** persisting — a failed activation leaves the current theme intact.
- `ThemeService.updateThemeSettings` validates server-side (types, enum options, hex color format, bounds, string length, unknown keys) before persisting.
- Invalid persisted settings fall back to schema defaults with logging; they never crash the site.

## Public Endpoints

- `GET /api/content/v1/site` — host-resolved publication metadata + active theme id + safe presentation settings (used by Web Theme Host); the internal `x-vibress-publication-id` response header conveys the resolved scope to the renderer.

## Admin Endpoints (`/api/admin/v1/themes`)

- `GET /themes` — list registered themes + active state (permission `themes.read`).
- `GET /themes/:id` — single theme (permission `themes.read`).
- `GET /themes/active` — active theme + settings (permission `themes.read`).
- `POST /themes/:id/activate` — activate (permission `themes.manage`). Atomic; invalid/incompatible themes rejected with stable codes.
- `PATCH /themes/:id/settings` — update settings (permission `themes.manage`). Validated server-side.
- `POST /themes/:id/preview` — create short-lived preview token (permission `themes.manage`).
- `GET /themes/preview/:token` — resolve a 15-minute preview token to a theme id only for the token's publication host (response shape remains `{ themeId }`).

Stable error codes: `THEME_NOT_FOUND`, `THEME_INVALID`, `THEME_INCOMPATIBLE`, `THEME_SETTINGS_INVALID`, `THEME_ACTIVATION_FAILED`.

## Permissions

- `themes.read` — list/read themes (Owner, Administrator, Editor).
- `themes.manage` — activate, update settings, preview (Owner, Administrator, Editor).

## Web Theme Host (`apps/web`)

- `src/themes/registry.ts` — trusted static registry of React theme modules.
- `src/themes/{default,minimal}/` — theme definitions + components.
- `src/lib/theme-host.ts` — resolves active theme + settings from `/api/content/v1/site`, merges defaults over persisted values.
- Routes fetch public content then delegate to `theme.components.X`; routing remains owned by `apps/web`.
- Theme presentation assets served at `/theme-assets/<theme-id>/<version>/<file>` from a host-publication-scoped Web handler. External theme source/config files are not public assets.
- Preview: `/preview/:token/...` — middleware resolves the token server-side, sets an internal header, and rewrites to the canonical public path. Visitors cannot select arbitrary themes via query params.

## Admin UI

`/admin/settings/themes` — theme cards (name, version, description, active badge), Preview, Activate, and a settings editor (color, number, boolean, string, select) with server-side validation.

## Cache Freshness

- Web fetches active theme + settings per request with `no-store`; theme activation and saved settings do not require a rebuild.
- External renderer file maps have a 60-second production cache; asset responses can be cached longer by clients. Plan asset versioning for changes to installed theme files.
