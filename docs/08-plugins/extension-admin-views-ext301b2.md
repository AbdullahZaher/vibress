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

## EXT-301B2B — Opaque-origin interactive iframe (October 2026)

The Host now supports an **optional, separately pinned, self-contained HTML document** for a previously admitted EXT-301A view. No untrusted JavaScript is mounted into the parent Admin document.

The Admin first sends an authenticated, Origin-validated `POST /api/admin/v1/extensions/:pluginId/views/:viewId/frame-ticket` with the existing Host-validated active publication header. Before issuing a ticket, the server checks Staff session, both global and publication-local Staff permissions, plugin admission/status/enablement, linked view ID and separately verified operator-pinned asset bytes.

The response is a **Host-generated relative frame URL**. The ticket is a cryptographically random, single-use 256-bit value stored in shared Redis for **45 seconds**. Its server-only record binds the issuing Staff ID, hash of the current Staff session token, authoritative publication ID, plugin/view ID and document SHA-256.

The iframe navigates to `GET /api/admin/v1/extensions/:pluginId/views/:viewId/frame?ticket=...`. This GET **atomically consumes** the ticket via Redis GETDEL, re-resolves the actual Staff session **by the SHA-256 hash stored on the server** (without requiring the iframe's SameSite cookie), membership, publication-local role and permissions, checks plugin enablement and view registration again and reads the pinned bytes again. A changed artifact hash, revoked or logged-out Staff session, revoked permission, invalid/expired/used ticket, unavailable Redis, or disabled plugin fails closed. Different API replicas share ticket state through Redis. The browser never sends an unverified publication query parameter.

Only the frame response has `Content-Type: text/html` and the special CSP:

```
default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'none';
style-src 'unsafe-inline'; img-src data:; connect-src 'none';
font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'self'; sandbox allow-scripts
```

The Admin additionally uses `iframe sandbox="allow-scripts"` **without `allow-same-origin`**, `referrerPolicy="no-referrer"`, accessible localized title and a responsive bounding frame. The response applies `Cache-Control: private, no-store`, no-referrer, nosniff, same-origin frame ancestor restriction, and a denied Permissions-Policy for sensitive browser APIs. Scripts are inline only inside the **opaque-origin** document, not the parent Admin.

An absent optional asset returns 404 to the ticket request and the Admin falls back to the existing EXT-301A Host-rendered, read-only view. Other failures do not fall back to plugin HTML or grant broader permissions. On publication changes, the embedded frame is removed and a new authorization is requested.

## Read-only, typed MessagePort bridge

When an approved document has finished loading, the Admin shell transfers an ephemeral `MessagePort` using `window.postMessage`. The **only** available capability is `linked-view.read`, which requests the exact **GET** route linked to the current, admitted EXT-301A view. The plugin cannot choose an HTTP method, URL, route ID, publication, request body or headers.

```js
window.addEventListener("message", (event) => {
  if (event.source !== window.parent ||
      event.data?.type !== "vibress:extension:connect" ||
      event.data?.version !== 1 || event.ports.length !== 1) return;
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data?.type !== "vibress:extension:response") return;
    // Render response scalar fields using textContent, never innerHTML.
    if (data.ok) document.querySelector("output").textContent = JSON.stringify(data.data);
  };
  port.postMessage({
    type: "vibress:extension:read", version: 1, requestId: "summary-1",
  });
});
```

The Host rejects messages with unknown fields (including caller-chosen tenant IDs and URLs), limits outstanding requests (4) and read attempts (30/minute), rejects duplicate request IDs, and closes the port on route changes or frame teardown. The Admin's existing API client sends the current Host-selected publication; the API performs independent Staff and publication-local permission checks and validates scalar responses. Exceptions are reduced to generic error codes and never leak tokens or private URLs through the port. A navigated iframe is removed instead of receiving a fresh port.

A complete, standalone, Arabic/English keyboard-accessible HTML example is provided in [examples/isolated-courses.html](examples/isolated-courses.html). Operators must build and hash the final **single HTML file**, pin it separately in `adminUiAssets`, and deploy identical approved bytes on all API replicas.

**Current limitations:** The bridge is **read-only**. No arbitrary API proxy, POST/CRUD bridge, member access, secrets, cookies or credentials are available to plugin HTML. A future, explicitly reviewed write capability must be a separate SDK/permission contract with test coverage and auditability. CSP blocks normal fetch/XHR and external subresources; opaque-origin sandboxing blocks parent DOM access and top-level navigation. However, browser support for restricting *self-navigation* is not uniform, so **operator review of executable HTML remains mandatory**; do not treat this iframe as a hardened sandbox for arbitrary hostile code. No runtime npm/ZIP installation or untrusted Node plugin sandboxing is claimed.

**Before production rollout**: pass CI and complete a real browser E2E/staging drill using an independently built approved HTML fixture, verify CSP and header precedence through supported reverse proxies, keyboard focus/RTL, session switch/logout, multi-replica tickets, and plugin disable/artifact rotation. CSP is intentionally locked down; do not loosen it to make arbitrary imported assets work.
