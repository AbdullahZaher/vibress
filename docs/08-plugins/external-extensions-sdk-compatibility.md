# Extension SDK unification and legacy compatibility RFC

**Status:** ACCEPTED DESIGN DIRECTION — canonical `@vibress/plugin-sdk` + v1 preservation; consumer inventory/legacy adapter contract pending EXT-001/102. No SDK change shipped. [ADR](../adr/2026-10-19-external-extension-host-vnext.md).

## Existing executable contracts (verified 2026-10-19)

| Concern | `@vibress/plugin-sdk` (used by API host) | `packages/plugin-core` (alternate legacy-facing API) |
| --- | --- | --- |
| Manifest | `PluginManifest` requires `vibressApiVersion`, `entrypoint`, `capabilities` | `PluginManifestSchema` requires `id`, `name`, `version`; extra metadata, no SDK protocol |
| Entry module | `PluginModule.activate(context)`; optional `deactivate()`, `onEvent(eventName,payload)` | `VibressPlugin.onActivate(context)`; `onDeactivate(context)`, `onEvent(eventName,payload,context)` |
| Context | `manifestId`, name/version, optional publicationId, settings, `getSecret`, function-style `log` | `pluginId`, manifest, optional publicationId, settings, object-style `log.info/warn/error` |
| Validation | `validateManifest` and exact `SDK_VERSION = "1.0.0"` | Separate Zod `validatePluginManifest` with different accepted fields |
| Host | `apps/api/src/plugins/plugin-host.ts` loads `PluginModule` from hardcoded bundled registry | `extension-host.ts` returns mock result; `sandbox.ts` uses deprecated `node:vm`; neither is a general secure external loader |

`packages/plugin-sdk/package.json` currently reports package version `1.2.0`, which **does not equal the SDK protocol version**. Do not infer API protocol from npm semver, and do not claim the alternate core contract is already used in production without enumerating its consumers.

## Proposed canonical contract and migration policy

1. **Canonical runtime ABI:** extend `@vibress/plugin-sdk` via a separately versioned *vNext host protocol*; `apps/api` uses this exclusively for newly admitted packages. Final names/types follow an RFC and release process. Preserve v1 bundled `PluginModule` behavior.
2. **Inventory before adapter:** search imports/usages of `@vibress/plugin-sdk`, `@vibress/plugin-core`, `plugin-core/src`, `VibressPlugin`, manifests, worker hooks, theme code, tests and operator docs. Classify each by active, test-only, historical or externally consumed. Do not remove or rename blindly.
3. **Explicit version dispatch:** loader chooses exactly one adapter by verified manifest format and admitted protocol; unknown/ambiguous or mixed manifest versions fail closed. A plugin-core manifest with no `vibressApiVersion` must *not* be silently treated as an SDK v1 external artifact.
4. **Compatibility mapping:** for demonstrably supported legacy consumers, bridge `onActivate(context)` to host activation, `onDeactivate(context)` with captured original context and `onEvent(event,payload,context)` with scoped context. Do not drop context or settings; reject unsupported capabilities or lifecycle semantics rather than silently ignoring them.
5. **Stable existing v1:** keep exact-match `vibressApiVersion` validation for existing bundled modules; new protocol negotiation is additive and supports only explicitly advertised majors/minors. Keep current status, settings, error format, request IDs and current bundled IDs working.
6. **Known lifecycle gaps:** `PluginsService.deactivatePlugin` currently only sets state and emits an event; it does not call module `deactivate`. `executeHook` currently invokes `module.onEvent("onEvent", payload)` and can return a success marker for unhandled hook names. Fix with named event delivery, capability and publication-scoped guards, async failure propagation, and admission/drain lifecycle tests **before** promising vNext hooks. Preserve documented v1 behavior where feasible; incompatible fixes require documented explicit version routing.
7. **Documentation:** reconcile `docs/developer/plugin-sdk.md`, `docs/developer/examples/sample-plugin/*`, `docs/08-plugins/plugin-system.md` and references to child-process resource limits; ship a compiled conformance sample for each supported major.

## Proposed compatibility table (release gate; not yet verified)

| Runtime | Existing host support | Proposed vNext behavior |
| --- | --- | --- |
| Bundled SDK `vibressApiVersion: "1.0.0"` | Supported by hardcoded host | Remain supported through v1 compatibility path |
| `plugin-core` legacy shape | Not equivalent to runtime SDK | Support only after usage inventory + approved explicit adapter |
| Operator-installed vNext | Not supported | Requires pinned verified artifact + new host contract |
| Unknown/incompatible source | Rejected | Rejected, with actionable operator error |

## Required tests before declaring this resolved

- v1 bundled plugin activates and maintains settings/error semantics after upgrade; mixed/unknown manifests fail.
- Legacy plugin-core sample (if supported by inventory) retains log/settings/context and all lifecycle callback semantics, including event name and deactivate cleanup.
- Deny undeclared capabilities at **each service call**, not merely by `hasCapability` label.
- Invalid module exports, missing lifecycle hooks, double activation, interrupted deactivation, queue drain and cross-publication event tests.
- A clean external sample compiles using **only** published SDK packages; no private deep imports. Run conformance against supported host API majors and Docker image versions.

**Decision owner:** Plugin/Theme Reviewer + Architect + Security + QA. Architecture decision accepted in [ADR](../adr/2026-10-19-external-extension-host-vnext.md); exact adapter behavior remains an implementation hold point until consumer evidence/tests exist.
