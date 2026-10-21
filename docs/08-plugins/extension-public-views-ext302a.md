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

Next.js uses `cache: "no-store"` for both calls; metadata/page memoization
is request-local. It forwards only the public-site password cookie
(`vb_site_auth`), never an Admin Staff or member cookie. Descriptor IDs and
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
