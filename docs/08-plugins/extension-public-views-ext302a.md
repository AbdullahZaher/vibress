# EXT-302A — Reserved public extension SSR dispatcher

**Status:** First additive public Web route. This enables only an explicit,
read-only, scalar Host-rendered view. Full EXT-302 SEO/language policies and
EXT-303 theme slots are separate release gates. Not a generic filesystem
router, arbitrary plugin React/HTML renderer or Member lesson page.

## Operator-installed plugin contract (SDK v1 additive)

```ts
import type { PluginModule } from "@vibress/plugin-sdk";

export const plugin: PluginModule = {
  activate() {},
  routes: [{
    id: "catalog",
    audience: "public",
    method: "GET",
    response: { fields: { title: "string", total: "number" } },
    handle: (_input, scope) => ({
      title: "Published courses", total: 3,
    }),
  }],
  publicViews: [{
    id: "courses",
    routeId: "catalog",
    title: { en: "Courses", ar: "الدورات" },
  }],
};
```

The plugin manifest **must** be admitted by the operator, declare
`extension.routes.public`, be active and explicitly enabled for the Host
publication. No public view is inferred for old modules or from API routes
alone; historical SDK contributions continue unchanged.

Only up to eight opt-in views are admitted, each with a unique one-segment
view ID and a unique linked public GET route descriptor. The route must
accept **no dynamic query or request body**. The Host validates the entire
contribution and its route declarations; a broken contribution is rejected
rather than partially exposed. Admin/member routes are not eligible.

## URLs and execution

- Reserved public SSR path: `/extensions/:pluginId/:viewId`, with the
  site's existing locale prefix, such as `/ar/extensions/vibress-lms/courses`
- Host descriptor lookup:
  `GET /api/content/v1/extensions/:pluginId/views/:viewId`
- Separate Host-authorized scalar execution:
  `GET /api/content/v1/extensions/:pluginId/v1/:routeId`

The reserved `/extensions` namespace (including locale-prefixed paths)
bypasses publication-defined redirect rules, so generic redirects cannot
shadow an admitted extension page.

Both API requests re-resolve the publication from the authoritative public
hostname. The API's existing `/api/content/v1` privacy middleware protects
both, and the handler rechecks activation/enablement before execution. The
Next.js middleware also enforces the publication's private-site policy before
serving an HTML route. A disabled plugin, unknown view or missing route
returns a non-indexable 404. Backend failure fails closed; SSR does not use
an old cached response to render a different publication.

Next.js uses `cache: "no-store"` for its single Host-bound API call;
metadata/page memoization is request-local. It forwards only the public-site
password cookie (`vb_site_auth`), never an Admin Staff or Member cookie.
Before returning HTML or indexable metadata, the resolved API `publicationId`
**must match** the publication ID from the public site-settings API; mismatches
fail closed. Descriptor IDs and
returned scalar data are runtime-validated against shared
`@vibress/api-contracts` Zod schemas. The scalar values render exclusively
as escaped text in semantic `<dl>` elements; plugin HTML, remote images,
custom JS and arbitrary navigation links are **not supported**.

## Localization, SEO, themes and accessibility

The URL prefix and primary locale follow existing Host publication policy.
English/Arabic titles select `ar` for Arabic and `en` otherwise; extended
localization is deferred until plugins can declare published locale-specific
content. Canonical URLs use the current publication locale prefix; this
increment deliberately advertises **no hreflang alternates** without
evidence that those translations exist. Private sites use `noindex`.

A minimal host-owned page inherits the active theme's global CSS and has
semantic headings, lists, mixed-direction text support and keyboard-safe
server-only output. **Theme-specific extension slots** and an accessible
theme fallback are EXT-303; do not imply automatic theme integration here.

## Acceptance and further work

Required test coverage includes admitted and unadmitted pages, duplicate
IDs, dynamic query denial, Member route denial, wrong-host/disabled-publication
API isolation, private-site gate, forged ID, body/data sanitization, no SSR
cross-publication caching, locale canonical and RTL, SEO noindex,
preview/redirect interactions and real reverse-proxy behavior.

EXT-302B is needed for published-only locale variants, hreflang, preview
policy, explicit private Member lesson rendering and advanced cache policy.
No new DB schema/migration, private SDK import or plugin-specific core theme
change is introduced in EXT-302A.

## Security closure — Host and rate-limit boundaries

The production Nginx gateway **overwrites** `X-Forwarded-Host` with its own
validated `$host` for every upstream, and already overwrites `X-Real-IP`
and `X-Forwarded-For` from the immediate client peer. Next SSR prefers the
Gateway-assigned `Host` and never treats incoming `X-Forwarded-Host` as
authoritative. Any replacement CDN/load balancer or custom reverse proxy
**must** preserve the true Host and overwrite these forwarded identity headers
before exposing the API or Web processes; do not expose their internal ports to
untrusted clients. No raw tenant ID or query parameter ever authorizes access.

The SSR internal call may forward **only** the gateway-sanitized `X-Real-IP`
when it is a valid IPv4/IPv6 address. The API's existing trusted-proxy setting
(`TRUST_PROXY=1` in the reference Docker deployment) then rate-limits by the
real originating viewer instead of the shared Next.js server address. It still
rate-limits direct public API callers. No global rate limit has been disabled
or raised to conceal traffic spikes. Installations missing a trustworthy
`X-Real-IP` fall back to their existing shared limit and must fix their proxy
configuration rather than forwarding arbitrary visitor headers.

The public page's canonical URL and Open Graph URL use the **verified current
publication host**, not the single instance-wide `SITE_URL`; the metadata
is noindex when the API and site-settings publication identities disagree.
If the configured site URL does not match the verified request hostname, it
cannot redirect canonical links off-site. A page from publication A cannot
inherit publication B's cached SEO settings.

Production's private-site gate now calls an independently tested authorization
decision. Real signed site-password cookies remain publication-bound. Invalid
cookies and wrong-publication cookies are denied, settings-service outages
fail closed; old installations without an explicit `isPrivate` flag remain
public. The integration test environment retains its existing generic
privacy-gate bypass, but tests exercise the *same production decision function*
with valid and forged signed cookies.

## Remaining deployment verification

Perform an integration drill against the actual Nginx, API, Web and two
domain-mapped publications: inject a forged browser `X-Forwarded-Host`,
verify each publication keeps its own page identity/Canonical and site
password, check per-client rate limits under concurrent SSR traffic, inspect
external CDN/LB headers and ensure cache keys do not cross hosts. CI unit/API
tests supplement, but do not replace, this reverse-proxy drill.
