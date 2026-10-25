# RFC — Host-rendered Native Plugin Admin UI

**Status:** Draft for architecture/security review, not an implemented or frozen API.
**Date:** 2026-10-25.
**Track:** [Native Admin UI implementation plan](native-admin-ui-plan.md).
**Existing authoritative contracts:** [EXT-301A](extension-admin-views-ext301a.md), [EXT-301B2](extension-admin-views-ext301b2.md), [Plugin SDK](plugin-sdk.md), and [External SDK release gates](external-sdk-release-gates.md).

## Context

The present Host supports read-only scalar Admin views and isolated, pinned HTML assets in an opaque-origin iframe. This preserves a meaningful browser trust boundary, but interactive plugins such as LMS have an independently styled surface and limited integration with the Admin design system. Rendering arbitrary external React/HTML/JS inside Admin would trade away that boundary. Native UI must be **Host-owned rendering of validated data**, not an escape hatch into Admin internals.

## Goals

- Give extensions consistent headers, tables, forms, action feedback, navigation, theme, locale/RTL, and accessibility.
- Allow independent, externally versioned plugins to declare UI using public SDK contracts without core plugin-specific edits.
- Support legitimate resource read/write workflows with Host-enforced permissions and publication isolation.
- Keep existing iframe and scalar routes compatible, with explicit opt-in and auditable rollout.

## Non-goals

- Running external JS, JSX, HTML, CSS, templates, or downloaded React modules inside Admin.
- Building a visual page builder, open-ended form language, custom DOM renderer, or arbitrary server-side code interpreter.
- Providing an untrusted plugin runtime: Tier 1 API/Worker execution is privileged, and Tier 2 isolation remains unimplemented.
- Replacing current settings storage, LMS content models, public/member routes, or theme rendering.

## Draft contract: additive, declarative, versioned

`adminPages` is a **working name**, proposed as an optional SDK contribution. Its presence must not change `adminViews`/`adminNavigation` ABI or the behavior of v1 plugins. Example schema below is **illustrative pseudocode, not executable code against the current SDK**.

```ts
// Proposal only; not a shipped PluginModule type.
const proposedPage = {
  schemaVersion: 1,
  id: "courses",
  renderMode: "native",
  title: { en: "Courses", ar: "Courses" },
  description: { en: "Manage courses", ar: "Manage courses" },
  permission: "plugins.manage",
  layout: [{
    type: "data-table",
    id: "course-list",
    resourceId: "courses.list",
    columns: [
      { key: "title", label: { en: "Title", ar: "Title" } },
      { key: "status", label: { en: "Status", ar: "Status" } },
    ],
    actionIds: ["courses.open"],
  }],
};
```

The example uses English placeholder strings for both locale keys and illustrates only the contract shape. Real localized entries must be translated and reviewed. No `actionIds` may execute until separately approved route binding and permission admission exist.

### Schema and admission rules

- Define concrete runtime Zod schemas under `@vibress/api-contracts`; TypeScript interfaces alone are insufficient.
- Bound schema versions, descriptor bytes, section/component depth, component count, label lengths, column count, and action count; choose numeric ceilings in NUI-00 after representative LMS profiling, then test boundary values.
- Admit only a fixed set of Host-implemented component types and icon identifiers. Unknown component kinds, properties, schema versions, or bindings fail closed.
- Descriptors are inert serializable data: no functions, JSX, HTML, unsafe URLs, freeform CSS/classes, Markdown interpretation, expressions, query fragments, or browser-side plugin module imports.
- The Host owns URLs, parameter encoding, routing, display order enforcement, request transport, focus policy, and accessible markup.
- Locale strings are plain text; current `en`/`ar` compatibility remains valid. Specify an additive locale negotiation policy instead of baking a two-language limit into the future ABI.
- Descriptors are static contributions from operator-approved, immutable releases. Cache only by verified release identity and descriptor schema version; never cache authorization, secrets, or publication-specific data globally.
- A submitted descriptor is not permission evidence: every resource and action still uses a current Host Staff session, publication context, and server-side permission check.

### Compatibility negotiation and rendering precedence

1. Resolve the active publication from authenticated Host state, and re-check plugin admission/version/site enablement.
2. If the plugin has a native descriptor and the Host supports the declared version **and** the operator enabled that release for native rendering, validate it and render via Host components.
3. If the plugin **does not declare** native UI (or native is not enabled), use its existing admitted iframe or read-only data view.
4. If an explicit native descriptor is malformed, unauthorized, revoked, or unsupported while selected for native operation, show a Host-owned error/denial and emit sanitized diagnostics. Never execute HTML as a silent fallback or bypass permission checks.
5. A user changing publication, role, session, plugin status, or release must invalidate view/resource/action state and re-resolve admission. Out-of-order responses from the former context are ignored.
6. Keep `/admin/extensions/:pluginId/:viewId` links stable where possible, including bookmarks.

## Proposed data/resource contract (independent from scalar v1)

Current `PluginApiRoute` response declarations accept bounded scalar records. They are not a safe general table envelope. Do **not** encode arbitrary JSON in strings or silently widen `validateExtensionApiObject`.

A future, separately versioned resource contract should define:
- Immutable `resourceId`, pre-registered to exactly one approved Host Admin read handler.
- A typed response envelope for rows/records, stable `nextCursor` (opaque, bounded), optional total count, data version, and declared field projection.
- Bounded result sizes, filter/sort keys and selectors; no arbitrary SQL, URLs, or query language.
- Server-issued cursor scope binding to publication, identity, filters and release as applicable; reject tampering and scope switching.
- Runtime input/output validation, pagination defaults, deterministic order and explicit empty/error states.
- Host-owned API transport, cache invalidation and error representation.

Prefer extending an already established typed data contract if an equivalently safe one exists at implementation time; do not duplicate generic storage features without a demonstrated need.

## Proposed action contract (distinct from rendering)

A page can **reference** a named action, but cannot define an executable callback or grant it a permission. The API binds a declared action ID to a reviewed Admin endpoint/handler, operation class, input/output schemas, and permission.

- No caller-selected URL, HTTP method, arbitrary tenant/user ID, SQL statement, or Host token.
- Enforce `requireStaffSession`, `validateOrigin` where relevant, both global and publication-local authorization, live plugin enablement/capability admission, resource ownership, and request validation.
- Read versus mutation is explicit; `posts.read` or `plugins.read` never grants a write.
- Mutations need controlled concurrency, conflict responses, rate limits, idempotency where required, and audit records for sensitive changes.
- Confirmation/consent in Admin is UX and must not replace server authorization. Selective re-confirmation may be needed for destructive actions.
- Never embed decrypted plugin settings, cookies, bearer tokens, session IDs, or secrets in descriptors or client-facing discovery data.
- Reuse existing normalized error envelope and request IDs. Do not expose internal paths, stacks, or plugin exceptions.

## Admin design-system integration

The Host renderer should use existing Admin components and visual contracts, not a forked theme:
- `AdminPageHeader` with title, optional description and trailing actions, matching Posts (no leading header icon).
- Shared table/list, input, button, tabs, card, status, and dialog primitives.
- RTL-aware logical CSS and `dir=auto` for multilingual data; translations resolved by the Host with safe fallback behavior.
- Keyboard operation, visible focus, semantic labels, live status/error announcements, screen-reader affordances, responsive/mobile and dark-mode behavior.
- Loading/empty/error/permission-denied states owned by Host, with cancellation and stale-response protection on publication changes.

A table and form required by the first LMS pilot are preferable to a speculative catalog of dozens of UI components. New primitives require separate ADR/review as the ecosystem demonstrates need.

## Sidebar and route contributions

The current sidebar uses a special case for plugin IDs containing `lms`. Replace that with an optional validated navigation group descriptor that may specify group ID, localized label, allowlisted icon ID, stable order, and page IDs. The Host owns route generation and re-checks admission on every navigation. Existing `adminNavigation` links must continue working. Avoid arbitrary extension route registration into the Admin router.

## Proposed implementation ownership

| Layer | Proposed responsibility |
| --- | --- |
| `packages/plugin-sdk` | Optional public descriptor types, resource/action declarations, compatibility metadata |
| `packages/api-contracts` | Versioned runtime schemas, request/response limits, validation |
| `apps/api/src/plugins` | Static descriptor admission and relation to approved plugin/release/view |
| `apps/api/src/routes` | Host-authenticated resource/action transport and error mapping |
| `packages/domains` | Business logic and scoped operations where applicable; routes stay thin |
| `apps/admin` | Host-only renderer, design-system components, navigation and UX state |
| `apps/worker` | Only independently approved retryable jobs; UI state must not add new worker coupling |
| `vibress-lms` | Independent descriptors/resource/action handlers using public SDK only |

Ownership is a proposed responsibility map, not an instruction to modify every directory in one PR.

## Rejected alternatives

- **Remove iframe sandbox attributes:** unacceptable; exposes Staff browser context.
- **Dynamically import plugin React bundles into Admin:** unacceptable default trust boundary and upgrade coupling.
- **Embed plugin HTML/JS as strings in native components:** equivalent executable injection risk.
- **Create a separate comprehensive admin UI SDK immediately:** premature duplication of existing public SDK and Admin design primitives.
- **Rewrite plugin storage or LMS content formats for presentation:** unnecessary backward-compatibility and data-integrity risk.

## Outstanding RFC decisions (NUI-00 sign-off)

1. Precise schema-version negotiation and which incompatible declarations fail the whole extension vs one page.
2. Static descriptor delivery/attestation placement in the existing operator lockfile and capability declarations.
3. Numeric ceilings and performance budgets, backed by production-like profiling.
4. Versioned resource/action transport shape, including cursor binding and conflict/idempotency semantics.
5. Locale fallback and future multi-locale descriptor evolution beyond present en/ar behavior.
6. Rollout controls, migration path, rollback timing, and independent external SDK conformance fixture.

**No release approval or implementation claim is made by this RFC.**
