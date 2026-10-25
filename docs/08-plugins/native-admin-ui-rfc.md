# RFC — Host-rendered Native Plugin Admin UI

**Status:** Draft, unapproved. NUI-01 read-only Host admission and NUI-02 stat/field-list renderer are implemented on a default-off development branch but untested here; resource/action contracts and stable SDK are not implemented.
**Date:** 2026-10-25.
**Track:** [Native Admin UI implementation plan](native-admin-ui-plan.md).
**Existing authoritative contracts:** [EXT-301A](extension-admin-views-ext301a.md), [EXT-301B2](extension-admin-views-ext301b2.md), [Plugin SDK](plugin-sdk.md), and [External SDK release gates](external-sdk-release-gates.md). See also the [NUI-00 review](native-admin-ui-nui00-review.md) and [threat model](native-admin-ui-threat-model.md).

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

`adminPages` is now an **experimental optional SDK contribution**. Its presence does not change `adminViews`/`adminNavigation` ABI or v1 behavior; a new release-allowlisted Host read-only endpoint now parses it under independent authorization. The first implemented syntax schema covers **read-only scalar stat/field-list descriptors only**, linked in future to an existing admitted `adminViews` GET route. The example below matches that limited draft shape; it does not demonstrate a working runtime API.

```ts
// NUI-01 read-only metadata. Only the explicit operator-pinned Host path renders it.
const proposedPage = {
  schemaVersion: 1,
  viewId: "courses", // Must match an existing admitted adminViews GET view.
  title: { en: "Courses", ar: "Courses" },
  components: [
    {
      type: "stat",
      id: "course-total",
      label: { en: "Total", ar: "Total" },
      field: "total",
    },
    {
      type: "field-list",
      id: "overview",
      fields: [{ key: "status", label: { en: "Status", ar: "Status" } }],
    },
  ],
};
```

This example intentionally uses English placeholders for both locale keys; production Arabic translations are required before UI acceptance. The `field` and `key` values are admitted against the already-linked GET response schema by the new Host registry. Runtime syntax validation alone is never authorization; the protected route also verifies active release, Staff permission and publication membership. There are **no data tables, actions, mutation grants, iframe assets or plugin-owned routes** in descriptor v1.

### NUI-01 experimental admission status and review record

The initial syntax schema and SDK types now have a Host admission registry and a separately authorized, default-off discovery endpoint with an Admin read-only renderer. Every declared field must match an existing admitted GET response schema, and every request still checks Staff and publication-local rights. The added implementation has not been verified by CI. The [NUI-00 decision record](native-admin-ui-decisions.md) captures concrete first-slice ceilings, future operator opt-in, compatibility negotiation and open formal approvals. Later data-table/form/action components require new versions and security-reviewed resources/actions; do not silently expand descriptor v1.

### Schema and admission rules

- Define concrete runtime Zod schemas under `@vibress/api-contracts`; TypeScript interfaces alone are insufficient.
- NUI-01 prototype syntax ceilings are eight pages, twelve flat components/page, twelve fields/field-list, 100 UTF-16 code units per locale label and 64 KiB UTF-8/page. These are defensive draft limits, **not measured performance targets**; additional column/action limits and runtime budgets require review and profiling in later phases.
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
4. If Native is explicitly selected for a release but its descriptor is malformed, unauthorized, revoked, unbound or unsupported, show a Host-owned error/denial and emit sanitized diagnostics. Never execute HTML as a silent fallback or bypass permission checks.
5. A user changing publication, role, session, plugin status, or release must invalidate view/resource/action state and re-resolve admission. Out-of-order responses from the former context are ignored.
6. Keep `/admin/extensions/:pluginId/:viewId` links stable where possible, including bookmarks.

### Mode/compatibility decision table (proposed)

| Host assessment for this plugin/release | Result |
| --- | --- |
| No native declaration in a compatible legacy release | Existing admitted iframe, otherwise Host scalar view |
| Native declaration present; operator has **not** enabled Native for this pinned release | Existing admitted legacy renderer; the native descriptor is not used for privilege decisions |
| Native selected, descriptor version supported, admissible and bound to release/view/resources | Host native renderer; APIs still authorize each call |
| Native selected but descriptor invalid, unsupported, unapproved, revoked, or resource/action binding absent | Host-owned error/denial; no silent fallback to executable HTML |
| Operator rolls back Native after verification | A deliberately selected, still-authorized legacy mode; never a response to a security denial |
| Old Host receives a plugin that **requires** native-only functionality | Reject incompatible release or withhold unavailable feature; never assume legacy UI parity or silently skip critical business behavior |

Compatibility must be negotiated across Host, canonical SDK/extension ABI, UI schema version, and pinned release digest. Optional native metadata must not change old v1 module loading; an extension must declare its minimum supported Host capability before depending on native-only features. The alternate `plugin-core.VibressPlugin` ABI is **not** automatically equivalent to canonical `PluginModule`.

## Proposed data/resource contract (independent from scalar v1)

Current `PluginApiRoute` response declarations accept bounded scalar records. They are not a safe general table envelope. Do **not** encode arbitrary JSON in strings or silently widen `validateExtensionApiObject`.

A future, separately versioned resource contract should define:
- Immutable `resourceId`, pre-registered to exactly one approved Host Admin read handler.
- A typed response envelope for rows/records, stable `nextCursor` (opaque, bounded), optional total count, data version, and declared field projection.
- Bounded result sizes, filter/sort keys and selectors; no arbitrary SQL, URLs, or query language.
- Server-issued opaque/authenticated cursor scoped to publication, Staff principal, plugin/release, resource, filters and sort. Verify expiry/replay semantics where relevant; reject tampering, scope switching and incompatible versions.
- Runtime input/output validation, pagination defaults, deterministic order and explicit empty/error states.
- Host-owned API transport, cache invalidation and error representation.

Prefer extending an already established typed data contract if an equivalently safe one exists at implementation time; do not duplicate generic storage features without a demonstrated need.

## Proposed action contract (distinct from rendering)

A page can **reference** a namespaced action ID, but cannot define an executable callback or grant it a permission. The Host binds that ID to the same immutable approved plugin/release, a reviewed Admin endpoint/handler, operation class, input/output schemas, global/local permission and resource ownership policy. UI visibility is not an authorization decision. Current Admin POST admission is limited to `plugins.manage` or `posts.edit`, which must not be widened implicitly.

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
3. Adopt conservative prototype ceilings (eight pages, twelve components, twelve fields per list, 100-character v1 labels, 64 KiB descriptor), then approve measured runtime budgets before enabling native rendering.
4. Versioned resource/action transport shape, including cursor binding and conflict/idempotency semantics.
5. Locale fallback and future multi-locale descriptor evolution beyond present en/ar behavior.
6. Rollout controls, migration path, rollback timing, and independent external SDK conformance fixture.
7. Approve exact action-level authorization and record-ownership policy, including how plugin capabilities interact with current Staff roles and whether new permissions are needed.
8. Approve mandatory remediation of legacy LMS dynamic HTML interpolation before production acceptance; see [NUI-00 findings](native-admin-ui-nui00-review.md#findings-and-disposition).

**No production approval is claimed.** A default-off Host admission/read-only renderer candidate is present, but CI, API/browser acceptance, NUI-03 resources/actions, LMS migration and operator sign-off remain open.
