# EXT-201/202 — Host-mediated extension HTTP routes (initial contract)

**Status:** Initial implementation; NOT a stable external SDK and NOT a complete
LMS backend. Requires build, security review, conformance and rollout gates.

## Trust, compatibility and admission

This feature extends existing `@vibress/plugin-sdk` **1.0.0** additively.
Existing `PluginModule.activate/deactivate/onEvent`, manifests and bundled
plugins continue to work without `routes`. An operator must still deploy a
single-file, digest-pinned ESM artifact using the trusted lockfile, register it,
activate it globally, and **explicitly enable it per publication**.

An external manifest may declare `extension.routes.admin`,
`extension.routes.member`, `extension.routes.public`. Unknown capabilities
remain denied. Bundled legacy-global modules cannot serve scoped extension
routes. Route descriptors live in the module's optional `routes` array and are
validated by the **host** against `@vibress/api-contracts` on dispatch.

This initial contract has **one route path segment** (`id`, kebab case),
`GET` or `POST` only, up to 32 descriptors per plugin, and strict
string-only query and primitive body/response field descriptors (max 24 fields,
max 4096 characters per string). The runtime rejects unrecognized fields,
wrong primitive types, invalid descriptors, duplicate audience/method/id
tuples, unsafe route names and invalid output. Public routes are **GET-only**.
This design does not promise course/lesson relational storage (EXT-203).

## Reserved host-owned endpoints

| Audience | URL | Host policy |
| --- | --- | --- |
| Admin | `/api/admin/v1/extensions/:pluginId/v1/:routeId` | Valid Staff session, host-resolved publication, declared core Staff permission, Origin on writes |
| Member | `/api/members/v1/extensions/:pluginId/v1/:routeId` | Valid Member cookie, matching host-resolved publication, Origin on writes, site privacy policy |
| Public | `/api/content/v1/extensions/:pluginId/v1/:routeId` | Host-resolved publication, existing public-content privacy hook, anonymous principal, GET only |

All audiences require the operator-approved plugin to be active and enabled
for the resolved publication, and the corresponding declared capability.
Unknown/disabled routes return 404. Invalid request data returns 400.
Plugin faults return a generic 503 with a request ID, not exception internals.
Handlers are bounded by the host's 64 KiB HTTP body cap and rate limit
(60 requests per minute per configured limit key). Protected responses use
`Cache-Control: no-store`.

No route accepts a client publication or actor ID as proof of authorization.
The handler receives a host-created read-only TypeScript
`PluginApiScope` (`publicationId`, `requestId`, and the Staff/Member/anonymous
principal); do not derive tenant identity from the body, query or user-supplied
headers. A Member session from publication B is rejected on A **before**
the plugin is resolved.

## Minimal example

The example is TypeScript for an operator-approved, separately bundled module.
It has no core imports beyond the documented SDK:

```ts
import type { PluginModule } from "@vibress/plugin-sdk";

const plugin: PluginModule = {
  async activate() {},
  routes: [{
    id: "courses",
    audience: "admin",
    method: "POST",
    permission: "posts.edit",
    body: { fields: { title: "string" }, required: ["title"] },
    response: { fields: { title: "string" }, required: ["title"] },
    async handle(input, scope) {
      // Additive shape-only example: EXT-203 is required to persist courses.
      // Only the host-provided scope has authority, never input.body.tenantId.
      return { title: String(input.body.title) };
    },
  }],
};
export default plugin;
```

The manifest must declare `"extension.routes.admin"`. In this initial
contract only existing core Staff permissions are supported; plugin-owned
named permissions and persisted permission descriptors still need an
independent reviewed versioned contract.

## Operations, limitations and future work

- Installed extensions are **operator-trusted in-process JavaScript**, not a
  sandbox. Route admission protects host-mediated surfaces, not Node builtins.
- Admission is currently checked on each dispatch, not a persisted immutable
  route declaration in the installation database. Production conformance,
  multi-replica lifecycle drains and strong distributed fencing remain pending.
- No raw DB/Drizzle, unrestricted SQL/transactions, Member billing authority,
  Next.js page routing, plugin-owned data migrations, jobs or arbitrary URLs.
- `EXT-203` must design scoped typed repository/storage and schema migration
  ledger before courses/enrollments are claimed functional.
- Member/private site tests, capability isolation and the publication matrix
  must remain mandatory release gates. There are no new migrations or env vars
  in EXT-201/202, preserving both fresh installs and upgrades.

See [roadmap](external-extensions-roadmap.md), [identity/data RFC](external-extensions-identity-data.md)
and [trusted extension implementation status](external-extensions-implementation-status.md).
