# Native Plugin Admin UI — Read-only Developer Guide

**Status:** Experimental development-branch API; not a supported or stable SDK release.
**Date:** 2026-10-25.
**References:** [RFC](native-admin-ui-rfc.md), [rollout runbook](native-admin-ui-rollout-runbook.md), [NUI-00 review](native-admin-ui-nui00-review.md).

The page descriptor v1 supports stat and field-list projections from an existing Host-admitted Admin GET route. Independent, additive contracts now provide typed paginated resources, Host-rendered storage forms, and an experimental domain-authoring workflow linked to an existing authorized POST route. None permits arbitrary plugin JavaScript in Admin.

## Optional plugin declaration

An operator-approved `PluginModule` can add this optional metadata while preserving its existing `adminViews`/`adminNavigation` and routes:

```ts
// Conceptual plugin module fragment; existing Host admission is still required.
const module = {
  activate() {},
  routes: [{
    id: "course-stats", audience: "admin", method: "GET",
    permission: "plugins.read",
    response: { fields: { total: "number", status: "string" } },
    handle: async () => ({ total: 12, status: "ready" }),
  }],
  adminViews: [{
    id: "course-stats", routeId: "course-stats",
    title: { en: "Course status", ar: "Course status" },
  }],
  adminNavigation: [{
    viewId: "course-stats", permission: "plugins.read",
    label: { en: "Course status", ar: "Course status" },
  }],
  adminPages: [{
    schemaVersion: 1,
    viewId: "course-stats",
    title: { en: "Course status", ar: "Course status" },
    components: [
      { type: "stat", id: "total", field: "total",
        label: { en: "Courses", ar: "Courses" } },
      { type: "field-list", id: "summary",
        fields: [{ key: "status",
          label: { en: "Status", ar: "Status" } }] },
    ],
  }],
} satisfies import("@vibress/plugin-sdk").PluginModule;
```

For clarity this English-only guide uses untranslated English placeholders in `ar`; a real localized release must provide reviewed Arabic strings.

**Admission:** `adminPages[].viewId` must match an admitted legacy GET view in the same operator-approved module; every referenced field must exist in that GET route's scalar `response.fields`. The Host validates schema (max 8 pages, 12 components/page, 12 fields/list, 100-character labels, 64 KiB/page) and checks permissions separately. Unknown metadata, callbacks, code/JSX, arbitrary URLs, HTML or CSS are rejected.

**Transport:** the Host-created GET `/api/admin/v1/extensions/:pluginId/views/:viewId/native` returns `{ "mode": "legacy" }` if no matching operator opt-in or Native declaration exists. For valid opted-in Native it returns `{ "mode": "native", "routeId": "...", "page": { ... } }`. Invalid native contributions and denied Staff/publication rights fail closed. The browser uses the Host-selected existing GET API to load scalar values; it never executes plugin UI code.

**Operator scope:** opt-in requires the exact reviewed `pluginId@sha256` entrypoint fingerprint via `VIBRESS_NATIVE_ADMIN_UI_RELEASES`. Merely declaring a page does not enable it. The operator trust model still allows privileged Tier 1 ESM execution in API/Worker; declarative UI is not a runtime sandbox.

**Compatibility:** existing plugin URLs and iframe/data renderers remain the default when Native is disabled. Do not require Native-only features on older Hosts without explicit compatibility checks. New tables, actions, forms and generic navigation must use future versioned contracts, not unsupported descriptor v1 fields.

**Release status:** tests have been authored but not run in this execution environment; do not use the new metadata for production before security/operations acceptance.

## Optional declarative navigation groups (incremental NUI-04)

Existing `adminNavigation` items can add a `group` object containing a stable `id`, localized `label` (`en` and `ar`) and optional `icon`. Accepted icon values are `puzzle`, `graduation-cap`, and `book-open`. Group names must be consistent for all items within a plugin and are scoped by the plugin ID, so two independent plugins cannot merge groups by choosing the same identifier. The UI renders grouped items using Host-owned React and existing Admin navigation styles. Ungrouped legacy LMS and other plugin pages keep their established sections.

This is inert presentation metadata only: it cannot grant permissions, add routes, or change the publication context. Translation values must be reviewed before release. An older Host whose strict navigation validator does not recognize `group` will reject a release that declares it; require a compatible minimum Host version and provide a legacy-compatible artifact for older installations. NUI-03 resources/actions and NUI-04 forms are experimental code; full production acceptance remains pending.

## NUI-03 experimental storage-backed resources (not production-ready)

Plugins may add optional `adminResources` and `adminActions` declarations to `PluginModule`. They are inert references to **existing approved Host storage models**, not executable handlers or SQL. A resource has a stable ID, `modelKey`, a bounded field projection, and optional indexed text equality filter fields. An action names a resource and operation `create` or `update` only. The Host validates the descriptor, binds it to an admitted Native GET view, checks each field against the operator's approved physical model and reauthorizes each request. The model key is never included in browser discovery.

The Host API is `GET /extensions/:pluginId/data`, `GET /extensions/:pluginId/resources/:resourceId` with validated `limit`, `cursor`, `filterField` and `filterValue`, and `POST /extensions/:pluginId/actions/:actionId` with `{ id, fields, expectedVersion? }`. Create forbids `expectedVersion`; update requires it. Both require publication owner/admin plus global `plugins.manage`; resource reads additionally require an operator-approved `extension.storage.read` model, and writes require `extension.storage.write`. No caller-supplied publication ID, permission, method, model key or URL is accepted.

Production deployments MUST keep `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` unset until independent operator/security acceptance; the read-only allowlist is not write consent. Native data records are not automatically eligible for LMS publishing or other business workflows. The SDK and transport remain experimental, and old Hosts cannot consume these new declarations without a compatible release policy.

## NUI-05 Host-rendered domain workflow (experimental)

The optional `adminDomainWorkflows` property links a Native page to one pre-admitted Host Admin GET/POST route pair and a Host-approved resource with all editor fields. The Host checks `plugins.manage` for the selected publication and the separately operator-approved pinned write release before disclosing workflow form metadata. A page only supplies localized labels, field limits and operation names. No HTML, scripts, functions, SQL, CSS or callback/URL fields are allowed.

On form submit, the Host uses the existing Admin POST route and its runtime request/response schemas. The domain handler enforces business rules: it decides whether the requested operation is allowed for the record, verifies the expected revision and rejects publishing incomplete or already published content. A native form may display an error but cannot override the server decision. Plugin release and operator write approval are independent of the existence of the form.

The first LMS implementation supports a paginated course list, bilingual draft create/save and a confirmed publish action, with old iframe authoring retained for older Hosts. It is not evidence of a complete LMS product or production security certification. NUI-06 requires live database/browser testing, an approved signed artifact, cross-version/release rehearsals, and independent operator acceptance.
