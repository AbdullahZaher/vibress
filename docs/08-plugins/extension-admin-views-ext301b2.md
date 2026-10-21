# EXT-301B2A — Publication-authorized Admin UI artifact delivery

**Status: security delivery increment only. No extension HTML is executed in the Studio.**

EXT-301B1 admitted optional, operator-reviewed, SHA-256-pinned single-file HTML UI artifacts. EXT-301B2A adds the smallest safe API/delivery boundary without bypassing Vibress's existing CSP or losing the authoritative active publication.

## New Admin endpoint

`GET /api/admin/v1/extensions/:pluginId/views/:viewId/ui`

- Requires an authenticated **Staff session** and existing origin policy; Member cookies cannot authorize it.
- Uses the Host-verified publication context selected through the normal `X-Publication-Id` Admin API header, **never a raw tenant ID as proof of authority**.
- Loads an active, publication-enabled, operator-approved extension module. Its declared view ID must belong to a valid EXT-301A contribution linked to an Admin GET route with matching Staff permission. Staff global permission **and publication-local role** must both pass.
- Delegates the approved document read to `PluginsService.readExtensionAdminUiAsset`, which rechecks active status, publication enablement and required capabilities before and after the separately SHA-256-verified filesystem read.
- Returns **inert, bounded JSON only**: `{ "html": "...", "sha256": "..." }`. The SHA-256 is computed from the verified UTF-8 document returned by the reader. `Content-Type: application/json`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. There is **no `text/html` endpoint** and no plugin HTML/JS evaluation in Admin.
- Returns 401 for unauthenticated, 403 for forbidden Staff/publication, 404 for absent/disabled view/artifact, and a sanitized 503 for a corrupt contribution or rejected/tampered artifact. It does not expose filesystem paths or exception content. Internal errors never trigger fallback to an unverified file.

The optional service/host method preserves legacy bundled-plugin and lockfile behavior. No migrations, new capabilities, SDK-major changes, or changes to the existing read-only Studio views are necessary.

## Why the iframe renderer is deferred

The current Admin CSP is strict (`script-src 'self'`, `script-src-attr 'none'`, `frame-ancestors 'none'`). A naive same-origin `iframe src` request lacks the active publication header, while rendering HTML using `srcDoc` can inherit the parent CSP and block the plugin's inline scripts. Simply weakening CSP or enabling `allow-same-origin allow-scripts` is unacceptable.

An interactive iframe requires an independently reviewed **opaque-origin document delivery** model with server-set CSP; a request/session token that is short-lived, bound to the authenticated Staff user and selected publication, audience-restricted and resistant to replay/leakage; and a capability-limited bridge. It must not forward ambient cookies, arbitrary fetch privileges or API credentials into plugin execution. This has **not** been implemented and is the follow-on EXT-301B2B task.

## Release gates

- Validate positive and adversarial API tests (authentication, forged publication, linked view admission, plugin disabled, malformed declarations, bad bytes, oversized response) and existing EXT-301A navigation tests.
- Confirm existing v1 modules and lockfiles work on fresh and upgraded installations; no DB changes are required.
- When introducing the browser renderer, add focused E2E tests for CSP, locale/RTL, keyboard navigation, fail-closed disable/rotation, same-origin/cookie isolation, and multi-replica release parity before production rollout.

See [EXT-301B1](extension-admin-views-ext301b1.md) and the [accepted implementation roadmap](external-extensions-roadmap.md).
