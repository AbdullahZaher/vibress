# NUI-07: Native Extension SDK Conformance (Experimental)

The supported `@vibress/plugin-sdk` `SDK_VERSION = "1.0.0"` API-route ABI is unchanged. New optional `adminPages`, `adminResources`, `adminActions` and `adminDomainWorkflows` metadata remain experimental and must never be marketed as a generally available stable SDK without the external release gate.

## Bounded read-only example

```ts
import type { PluginModule } from "@vibress/plugin-sdk";

const label = { en: "Records", ar: "Records" }; // Replace with reviewed Arabic.
export const example: PluginModule = {
  activate() {},
  routes: [{
    id: "overview", audience: "admin", method: "GET",
    permission: "plugins.manage",
    response: { fields: { total: "number" }, required: ["total"] },
    handle: () => ({ total: 0 }),
  }],
  adminViews: [{ id: "overview", routeId: "overview", title: label }],
  adminNavigation: [{ viewId: "overview", permission: "plugins.manage", label }],
  adminPages: [{
    schemaVersion: 1, viewId: "overview", title: label,
    components: [{ type: "stat", id: "totals", label, field: "total" }],
  }],
  adminResources: [{
    id: "record-list", viewId: "overview",
    modelKey: "approved_records", fields: ["name"],
  }],
  // No adminActions: read-only pilot.
};
```

`approved_records` is illustrative and requires a verified operator-approved physical model, enabled publication, and independently authorized `extension.storage.read` capability. Metadata alone never creates tables, makes requests or grants permissions.

## Rules for extension developers

- A Native page augments an existing admitted GET Admin view; route permission still applies to every scalar read.
- All labels are plain text; no plugin React/JSX, CSS, HTML, direct Admin-origin JavaScript, arbitary URLs or SQL may execute.
- A resource must be linked through its optional `viewId` to be displayed in the Native page. A projected field must match the operator-approved model. Text filters require operator-indexed fields.
- Data pages contain up to 20 typed records and bounded signed HMAC pagination tokens bound to Staff, publication, plugin, resource, digest and filter.
- A write descriptor is an inert `create` or CAS-protected `update` of approved Host storage, never a general-purpose business-action registry. It needs publication-local owner/admin, global `plugins.manage`, storage write capability and the independent default-off release opt-in.
- Domain workflows such as LMS draft create/save/publish require bounded descriptions, a Host-admitted GET/POST route pair with plugins.manage and separately operator-approved storage write capability. The Host sends commands to the existing domain POST and never simulates publish with generic storage CRUD. Billing, membership and destructive domain actions require their own future contracts and independent security review.
- Localized field display labels, more locale variants and richer widgets require future contract approval. Current `en`/`ar` labels are a backward-compatible v1 constraint, not a worldwide permanent language policy.

## Publication and compatibility tests

Test old plugin/new Host, old Host/new plugin, Host without allowlist, revoked digest, bad model, two publications, stale/duplicate writes, large and hostile content, RTL/keyboard, real database upgrades and rollback. A plugin release requiring unsupported Native behavior must be rejected on an older Host, not silently downgraded.

The Host operator must approve and pin the final signed artifact digest and separately configure `VIBRESS_NATIVE_ADMIN_UI_RELEASES` for Native read and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` for Native writes. No plugin can self-enable these values.

See the [NUI-06 acceptance matrix](native-admin-ui-production-acceptance.md), [Native UI design RFC](native-admin-ui-rfc.md) and [rollout runbook](native-admin-ui-rollout-runbook.md). **Publishing a stable SDK and production enablement are on HOLD pending acceptance.**

## Experimental NUI-05 paired domain workflow

The independent LMS source demonstrates an optional `adminDomainWorkflows` descriptor. It is intentionally inert: it supplies a Host-owned existing Native view ID, exactly one `resourceId`, an existing Admin GET/POST `routeId`, bounded localized labels and input-field maximum lengths. The route ID cannot be a plugin-selected external URL. Only the `create`, `save` and `publish` operation names are supported in the initial constrained form contract.

Host admission validates the Native read view, publication-local `plugins.manage` for both paired routes, the exact POST required field names and types, a typed response, and an approved storage resource containing the referenced fields and a status marker. Domain mutations use `POST /extensions/:pluginId/v1/:routeId`, where the existing plugin handler owns CAS, validation and immutable published-state rules. They **must not** use generic storage update to set a published status.

The workflow is only returned after the operator independently allows the same pinned release in `VIBRESS_NATIVE_ADMIN_UI_RELEASES` and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES`. Both remain unset by default. The independent LMS code intentionally leaves `adminActions` undefined to block generic LMS storage mutations. A new release digest requires new explicit operator review and approval.

Minimal public contract fragment (illustrative, not a released SDK fixture):

```ts
adminDomainWorkflows: [{
  schemaVersion: 1,
  viewId: "overview", routeId: "courses", resourceId: "approved-course-records",
  idField: "courseId", versionField: "expectedVersion", operationField: "operation",
  operations: ["create", "save", "publish"],
  fields: [{ key: "title_en", label: { en: "English title", ar: "English title" }, maxLength: 180 }],
}]
```

A real consumer MUST also declare matching admitted `routes`, `adminViews`, `adminPages`, and `adminResources`, use reviewed translated labels, and pass all Host authorization and compatibility gates. This code fragment does not independently permit writes or constitute a stable SDK release.
