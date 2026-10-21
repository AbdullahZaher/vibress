# EXT-301A — Host-rendered read-only Admin extension views

**Status:** Scoped implementation proposed in Draft PR. This is a deliberately
limited first increment of EXT-301, not completion of arbitrary plugin UI asset
loading. The post-merge CI, operator artifact provenance and staging drills remain
independent release gates.

## Supported contract

An operator-installed trusted plugin may declare optional `PluginModule.adminViews`
and `PluginModule.adminNavigation`. The manifest must already declare **both**
`admin.navigation` and `extension.routes.admin`. The Host publishes one
GET `/api/admin/v1/extensions/navigation` list, calculated using the authenticated
Staff publication, plugin enablement/status and Staff permissions.

Navigation IDs and view IDs are **single validated URL segments**. Each navigation
item must reference exactly one registered view; each view must point to one
**Admin GET API route with no query/body and exactly the same Staff permission**.
The Host rejects duplicate/orphan/invalid contributions. English and Arabic
labels are required for this first iteration. No plugin-controlled URL, iframe,
HTML, JavaScript, React component, asset path or DOM mutation is accepted.

Example plugin module (only public SDK type imported):

```ts
import type { PluginModule } from "@vibress/plugin-sdk";

const plugin = {
  activate() {},
  routes: [{
    id: "course-count",
    audience: "admin",
    method: "GET",
    permission: "plugins.read",
    response: { fields: { total: "number" } },
    handle: async (_input, _scope) => ({ total: 5 }),
  }],
  adminViews: [{
    id: "courses",
    routeId: "course-count",
    title: { en: "Courses", ar: "الدورات" },
  }],
  adminNavigation: [{
    viewId: "courses",
    label: { en: "Courses", ar: "الدورات" },
    permission: "plugins.read",
  }],
} satisfies PluginModule;

export default plugin;
```

The Host constructs the Studio URL:
`/admin/extensions/:pluginId/:viewId`. It renders only escaped scalar
keys/values obtained from the existing Host-authenticated Admin extension API:
`GET /api/admin/v1/extensions/:pluginId/v1/:routeId`.

## Security and lifecycle

- The Staff session and authoritative publication context are required for
  discovery; the request never supplies a trusted publication selector.
- Discovery returns no routes from legacy bundled modules or disabled external
  plugins. The plugin runtime must be operator-approved and publication enabled.
- Every actual view GET independently checks Staff auth, CSRF/origin policy,
  route permission, publication-local Staff role, plugin capability, enablement and
  response schema. Navigation visibility is **never** an authorization grant.
  Local publication `owner/admin` may use `plugins.manage`; local `editor`
  may use `plugins.read` and generic `posts.edit`; local `author/contributor`
  can only use the read-only `posts.read` route. Both global permission and
  local role are required. Generic writes cannot infer post ownership.
- `Cache-Control: no-store` is set on discovery and API responses. Admin clears
  navigation on publication changes and ignores stale discovery responses.
- Discovery caches **only static Host-validated descriptors** by the
  operator-pinned SHA-256 and installed module version, coalescing concurrent
  requests and bounding cache size to 64 modules. It reads the small trusted
  lockfile on each request but does not re-read/hash/import unchanged plugin
  modules. Full module bytes are still reverified by the Host for every
  actual extension API invocation. Cache entries do not store Staff access
  rights, publication enablement or tenant-specific data; these are rechecked.
  Invalid modules are negatively cached for 30 seconds and skipped with
  bounded warning metadata; other valid modules remain visible.
- Up to 64 operator-approved modules may contribute 8 views each, yielding
  at most 512 validated navigation records. The first discovery after a new
  artifact is admitted still incurs a bounded cold-load cost.
- A disabled plugin may remain in an already-open sidebar until the next
  refresh/site switch; its API content is immediately denied by the Host. Never
  treat the menu as authoritative.
- Plugin display values are escaped React text, never `dangerouslySetInnerHTML`.
  UI labels support Arabic/RTL, keyboard buttons, `aria-current` and `dir=auto`.
- No database migration, existing manifest serialization change or SDK-major
  bump is required. Existing v1 plugins without views continue unchanged.

## Explicitly deferred to EXT-301B

Interactive independently built Studio bundles, version/hash-addressed assets,
CSP and source integrity, multi-node asset admission, full invalidation across
replicas, SDK independent consumer conformance, and dedicated E2E tests are
**not implemented by this first increment**. The next [EXT-301B1](extension-admin-views-ext301b1.md)
increment covers only the operator-pinned asset validation foundation.
Do not deploy external executable
Admin assets under this read-only contract. These remain required before declaring
EXT-301 or the full external extension platform complete.
