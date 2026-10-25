# Native Plugin Admin UI — Read-only Developer Guide

**Status:** Experimental development-branch API; not a supported or stable SDK release.
**Date:** 2026-10-25.
**References:** [RFC](native-admin-ui-rfc.md), [rollout runbook](native-admin-ui-rollout-runbook.md), [NUI-00 review](native-admin-ui-nui00-review.md).

The first Native renderer supports only `stat` and `field-list` components, projecting fields from an **existing Host-admitted Admin GET route**. It deliberately has no forms, tables, arrays, pagination or mutation actions.

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

This is inert presentation metadata only: it cannot grant permissions, add routes, or change the publication context. Translation values must be reviewed before release. NUI-03 typed resources/actions and NUI-04 interactive forms remain unimplemented.
