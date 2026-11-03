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
- Additive migration 0032 restores an inherited publication's **active external theme version** only when its 0031 configuration ID proves inheritance. Fresh publications receive no legacy external themes; inactive historical packages require explicit installation, and existing publication-specific installations take precedence.
- Legacy shared theme files remain at their original path until a publication installs its own scoped copy. Attempts to replace or uninstall a default-publication package still referenced by another publication fail with `THEME_SHARED_LEGACY_STORAGE`. Back up legacy storage and migrate each publication to its own installation before retiring shared files.
- `ThemeService.activateTheme` validates the registered theme (manifest, compatibility, settings defaults) **before** persisting — a failed activation leaves the current theme intact.
- `ThemeService.updateThemeSettings` validates server-side (types, enum options, hex color format, bounds, string length, unknown keys) before persisting.
- Migration `0051_default_theme_legacy_accent` is data-only: for publications publishing `vibress-default`, it copies the *previously effective* `site.accentColor` (or its historical fallback `#6366f1`) into active theme configuration and the Default theme's editable settings. It preserves all unrelated keys, inactive-theme settings, and publication isolation. Existing publications with no activation row are pinned to their previously displayed Default accent; fresh publications created after migration use schema defaults. The legacy site setting is retained for API compatibility but is no longer an appearance source for built-in themes.
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

`/admin/settings/site` → **Site Identity** manages publication logo and favicon without a duplicate color editor; the stable `site-branding` anchor remains available. **Theme Studio** is the sole user-facing appearance editor: always-visible published theme summary, spacious image-led catalog, official/custom filtering, Preview/Publish/Customize actions, ZIP upload, and schema-based editor. The existing Settings navigation remains the only navigation. `ThemeGallery.tsx` renders the theme's actual `previewImage` when supplied and a clearly labelled missing-screenshot state otherwise. Publishing requires explicit confirmation and reports server-confirmed success/errors. The same publication-bound 15-minute preview token is used for non-publishing previews; it does **not** preview unsaved form changes. The editor persists settings per theme and does not activate inactive themes. The design QA/release plan lives in `docs/design/VIBRESS_THEME_STUDIO_ROADMAP_2026-11-02.md`.

## Cache Freshness

- Web fetches active theme + settings per request with `no-store`; theme activation and saved settings do not require a rebuild.
- External renderer file maps have a 60-second production cache; asset responses can be cached longer by clients. Plan asset versioning for changes to installed theme files.


## Theme Studio release verification & test-data safety

- **Editorial fixtures are destructive test data**, never a production migration. Provision a dedicated, disposable localhost PostgreSQL instance with a restricted database role. Run `pnpm staging:provision` only with explicit `DATABASE_URL`, `VIBRESS_PROVISION_STAGING_MARKER=true` and an independently generated 64-character hexadecimal `VIBRESS_STAGING_MARKER_TOKEN`. Existing marker identities must not be overwritten.
- Pass the same token to `pnpm staging:seed` with `VIBRESS_SEED_EDITORIAL_STAGING=true`; the seeder verifies the identity and publication against its mutation connection before beginning a transaction. Never expose the marker in logs or commit it to the repository. Restrict the test fixtures to their explicit post IDs and never mutate shared user profiles.
- `pnpm qa:theme-studio` captures and validates screenshots but leaves `visual_review_pending=true`; capture success **is not** independent design certification.
- A separate authorized reviewer may run `pnpm qa:approve-review -- --manifest <path> --commit-sha <40-hex-sha> --reviewer <identity> --role <role> --score <number> --observations <json>`. Set `THEME_STUDIO_REVIEW_SIGNING_KEY` from a protected secret store to a random **32+ byte hex key** before signing or verifying approval. The HMAC binds reviewer metadata, observations, score, commit and screenshot hashes; it establishes integrity only when the signing key and reviewer identity are controlled by an independent trusted process.
- The final production merge gate requires all required CI jobs to complete successfully **on the exact reviewed SHA**, actual manual inspection of QA artifacts (including RTL/mobile states), and separately documented approval. Never use earlier successful workflow runs as proof of the current head.

## Appearance ownership and announcements

- Site Settings owns publication name, metadata, logo, favicon, and existing cover assets; no theme color is written from Site Settings.
- The currently active theme's validated schema settings control theme-specific visual appearance. Default, Minimal and Molten all prioritize `theme.settings.accentColor`; external themes retain their existing Liquid setting contracts. The schema defines which editor fields exist.
- The public announcement bar uses the active theme's `accentColor` when supported, or an accessible neutral fallback for other theme schemas. Its foreground is chosen for WCAG AA contrast, and alpha is rendered opaque to avoid unpredictable overlaid background contrast.
- Saved theme edits and preview tokens are separate from publishing. A preview shows the stored theme settings associated with its authorized token, **not unsaved input**.

## PR #118 final persistence hardening (2026-11-03)

- A fresh publication can have an *implicit* active `vibress-default` without a `theme_configurations` row. Saving Default appearance writes `theme_settings` under that publication; `getActiveTheme` now resolves those validated saved values when no explicit active row exists. It does **not** auto-activate a different theme or insert a duplicate active configuration.
- An explicitly active theme is updated using a publication-scoped, version-and-settings compare-and-swap. Configuration and editor settings writes share a database transaction so conflicting activation and partial persistence fail with the existing `THEME_SETTINGS_CONFLICT` API error; the last activation is never silently overwritten by stale settings.
- `logoUrl` is the publication logo, `iconUrl` is the favicon. The Default theme keeps its historical icon-as-header-fallback, but logo takes priority; Minimal and Molten show a logo when configured and otherwise retain their own text-based branding. Network failures or malformed logo URLs fall back to the publication title. External Liquid `site.logo`, `site.icon`, `site.coverImage` and `site.accentColor` remain unchanged.
- Minimal and Molten expose both `--vb-accent-color` and the legacy-compatible `--accent-color` CSS alias, scoped to each theme's validated color setting.
- PostgreSQL regression tests cover concurrent implicit saves, compare-and-swap, rollback on second-write failure, switching/rehydration and publication isolation. Migration 0051 is preserved verbatim and exercised against cloned production table definitions, with its migration journal entry checked.
