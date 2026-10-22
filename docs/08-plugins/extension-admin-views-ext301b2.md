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

## B2A security constraints (addressed incrementally by B2B)

The current Admin CSP is strict (`script-src 'self'`, `script-src-attr 'none'`, `frame-ancestors 'none'`). A naive same-origin `iframe src` request lacks the active publication header, while rendering HTML using `srcDoc` can inherit the parent CSP and block the plugin's inline scripts. Simply weakening CSP or enabling `allow-same-origin allow-scripts` is unacceptable.

An interactive iframe requires an independently reviewed **opaque-origin document delivery** model with server-set CSP; a request/session token that is short-lived, bound to the authenticated Staff user and selected publication, audience-restricted and resistant to replay/leakage; and a capability-limited bridge. It must not forward ambient cookies, arbitrary fetch privileges or API credentials into plugin execution. B2A did **not** implement these safeguards. The EXT-301B2B section below documents the implemented one-use ticket, opaque-origin renderer and restricted read-only bridge; write operations remain out of scope.

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
navigate-to 'none'; frame-ancestors 'self'; sandbox allow-scripts
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

## PR #74 security hardening: verified bootstrap, revocation and token handling

The iframe **does not receive a MessagePort merely because it loaded**. Each ticket now binds a cryptographically random `bridgeNonce` to the Staff session, publication, view and exact artifact SHA-256 in Redis. The issuance API returns the proof only to the authenticated Admin shell. After the frame redeems the single-use ticket and the Host rechecks authorization and its pinned HTML bytes, the server injects a short bootstrap script containing the same proof **into the verified response**. The shell only transfers its read-only port after a strictly parsed `vibress:extension:ready` message with matching `event.source`, opaque `event.origin = "null"` and proof. A redirect to unrelated HTML cannot obtain that proof; it must not get any port. The verified bootstrap sends a `vibress:extension:gone` signal on `pagehide` to close the connection.

The Admin also rechecks `GET /api/admin/v1/extensions/:pluginId/views/:viewId/frame-status` every **30 seconds**, without issuing additional frame tickets. This endpoint performs fresh Staff/session, publication-local permission, plugin enablement, view admission and operator asset verification. The frame is removed on any failed refresh or changed asset SHA-256; revocation is not instantaneous and stale data may remain visible between checks. The existing GET data route independently checks authorization on each bridge read.

Frame URLs are **short-lived bearer credentials** even though they work without the iframe's SameSite cookie. The production Nginx gateway suppresses access logs for the precise frame URL, and API error/response logs omit all query strings. Operators must also disable or sanitize request-URI/query logging for this endpoint at **upstream TLS terminators, CDNs, ingress controllers, WAFs and any external observability agents**. Do not put these URLs into analytics or errors. Redis remains required for atomic GETDEL and all replicas must share the same instance/cluster.

**Residual execution trust:** Since browser support for `navigate-to` is incomplete, CSP cannot unconditionally forbid self-navigation to attacker endpoints. The sandbox prevents top-level navigation/popups, direct credential access, arbitrary API calls and unapproved MessagePort assignment, but it **cannot make arbitrary malicious JavaScript incapable of leaking data it is intentionally given**. Operators must manually review and pin every HTML artifact, as they already do server-side plugin bundles. The read bridge must only expose an explicitly reviewed Staff-scope scalar projection; do not send secrets, authentication tokens or unrestricted content to it. Before enabling untrusted package marketplaces, replace this operator-trust contract with a separately designed execution and data-capability architecture.

**Verification:** API integration assertions cover 256-bit single-use tickets, live session revocation, permission changes, injected proof and no cookie serialization; a real Redis integration test checks atomic consumption between independent service instances. Playwright includes a redirected/forged-document case that must not acquire a MessagePort, plus idle iframe revocation on a failed status refresh. Real deployed replica/proxy tests, including effective CSP response headers, still gate release. No check is weakened or skipped to admit the change.


## EXT-301C — confirmed, linked-route Admin writes (incremental)

The existing opaque-origin Staff iframe remains sandboxed with `allow-scripts`
only. Its established private MessagePort read contract is unchanged.
Trusted, operator-pinned HTML may now send:

```json
{
  "type": "vibress:extension:write",
  "version": 1,
  "requestId": "unique-per-frame-request",
  "body": { "title": "Course title", "published": false }
}
```

Only up to 24 bounded scalar fields are accepted. The frame cannot supply
a URL, route ID, method, credential, publication ID, Member ID or tenant
selector. The Host will POST to exactly the view's **existing linked route ID**.
Each attempted write requires a fresh user confirmation in the trusted
Admin parent, is limited to five per minute and one concurrent request,
and is denied after iframe revocation or publication switch. A confirmed
UI action is **not** authorization: API middleware independently enforces
the Staff session, Origin, selected publication, plugin activation, schema
validation, plugin permissions and the write-specific `plugins.manage` or
`posts.edit` permission. Legacy read-only extensions are unchanged.

The API's direct POST variant receives the same authorization checks;
it cannot be used to bypass the bridge's read-vs-write permission split.
The Host never exposes raw cookies, headers, SQL or a general fetch proxy
to the frame. UI confirmation can be denied by browsers, in which case
the Host fails closed.

**Remaining gates:** a pilot using actual LMS storage/Member entitlements,
independent external-package conformance, keyboard/Arabic RTL end-to-end
testing, and reviewed operator rollout/rollback. This bridge alone is
not evidence of secure learner enrollment or production readiness.
