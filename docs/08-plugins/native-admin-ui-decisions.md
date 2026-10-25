# NUI-00 — Native Admin UI Decision Record and NUI-01 Entry Gate

**Status:** Engineering decisions recorded; NUI-01/NUI-02 read-only Host implementation candidate exists behind a default-off, release-pinned operator allowlist. Formal Architecture, Security, API and Operator approval is pending.
**Date:** 2026-10-25.
**Branch:** `docs/native-admin-ui-plan-20261025`.
**Context:** [NUI-00 review](native-admin-ui-nui00-review.md), [threat model](native-admin-ui-threat-model.md), [RFC](native-admin-ui-rfc.md), [release gates](external-sdk-release-gates.md).

## Role review (technical conclusions, not delegated approvals)

| Role | Review conclusion | Approval status |
| --- | --- | --- |
| Architect | Canonical SDK only, additive inert descriptors; no separate UI SDK or embedded browser extension code | Recommended, operator approval required |
| Security | Existing Staff publication enforcement must remain authoritative; page metadata grants no permission; iframe safety unchanged | Recommended, independent approval required |
| API Designer | NUI-01/NUI-02 implement only read-only scalar projection with release-pinned Host checks; structured tables/actions require separately authorized protocol | Recommended, API approval required |
| Plugin/Theme | Stable legacy `adminViews`, `adminNavigation`, routes, themes, settings and persisted content | Compatibility tests required |
| i18n/RTL | Preserve en/ar v1 labels, Host-owned text rendering; v2 localization extensibility needs a deliberate policy | Acceptance required |
| QA | Old/new ABI, hostile descriptors, wrong-publication, revoked state, performance and real upgrade/rollback tests | Execution pending |

## Decisions for an implementable first slice

### D-01 — Canonical SDK and scope

Use `@vibress/plugin-sdk` as the public module contract, not `plugin-core.VibressPlugin`. Extend `PluginModule` with optional `adminPages` metadata. Never import components from `apps/admin` into plugins. SDK types are not a security boundary: parse at runtime on the Host. Preserve v1 `adminViews`, `adminNavigation` and all existing fields, `SDK_VERSION = "1.0.0"`, and public/private app contracts.

**Implemented as an unverified default-off candidate:** optional SDK type/Zod schema, Host-side view/field binding, Staff/publication-authorized GET endpoint and native read-only renderer. No actions, data tables or supported external SDK release. The new public type is not frozen and cannot be marketed as generally supported.

### D-02 — Read-only native descriptor v1

To avoid premature permissions and API contract changes, Native descriptor `schemaVersion: 1` is an **inert read-only projection** tied by `viewId` to an existing, admitted `adminViews` GET route. Initial component kinds are `stat` (one declared scalar field) and `field-list` (bounded declared scalar fields). Fields and labels are plain data, never expressions.

A future admission service **MUST** ensure each native `viewId` maps to exactly one admitted legacy Admin view, that every referenced field exists in that linked GET route's declared response shape, and that the route matches the user's publication/permission. Syntax validation alone cannot establish any of this. Until the admission service exists, no descriptor is returned to browsers or rendered.

**Explicitly deferred:** native tables/arrays/pagination, forms, mutations, permissions other than those supported by the linked existing GET, actions and plugin-defined navigation groups. They require NUI-03/NUI-04 and must not be simulated with unvalidated JSON strings.

### D-03 — Conservative syntax limits (prototype defaults)

| Attribute | NUI-01 limit | Status |
| --- | --- | --- |
| Native pages per plugin | 8 | Matches current `MAX_VIEWS_PER_PLUGIN` |
| Components per page | 12 | Conservative provisional cap |
| Fields per `field-list` | 12 | Conservative provisional cap |
| Nested components | 0 | No recursion in v1 |
| Localized title/label | 100 UTF-16 code units per en/ar string | Mirrors legacy Zod limit |
| Page descriptor payload | 64 KiB UTF-8 JSON | Conservative provisional cap |
| Component and view ID | Single Host-validated segment | Uses legacy-compatible identifier class |
| Resource/page response rows | Not applicable in NUI-01 | NUI-03 design gate |
| New write/action IDs | None in NUI-01 | No mutation contract yet |

Numeric limits above are **chosen safety ceilings**, not performance measurements or a promise of acceptable latency. Before native rendering is enabled, measure representative modules and verify correct performance at boundary inputs.

### D-04 — Version and compatibility behavior

Keep `SDK_VERSION` unchanged for this additive read-only contribution: the upgraded Host now consumes optional metadata only after explicit approved-release opt-in, while previous modules and runtime route ABI stay intact. `schemaVersion: 1` covers only the small stat/field-list projection. Never assume that adding data tables or actions to the same v1 schema will work in older Hosts; a new version/feature negotiation must be designed.

Old Host + old plugin remains unchanged. New Host + old plugin uses existing rendering. Old Host + plugin with optional native metadata must preserve legacy functionality **only if** that plugin still offers a valid legacy view. A plugin requiring native functionality must declare a supported minimum Host release via the operator approval/compatibility mechanism and must fail admission on an old Host. This is a **future gating requirement**, not an implemented new manifest flag. `plugin-core` has no implied native compatibility.

### D-05 — Render selection and downgrade prevention

Operator default remains **legacy mode**. Future Native enablement must be explicit, operator-controlled and tied to an immutable approved release identity (prefer the existing operator approval digest). An extension cannot enable itself by supplying `adminPages`.

- No native declaration or operator not opted in: old authorized iframe/data-view selection.
- Operator opted in + descriptor admitted: Host Native renderer.
- Operator opted in + descriptor invalid, unsupported, stale, revoked, or access denied: Host-owned failure; **no silent iframe downgrade**.
- Intentional operator rollback: disable Native for the release only after verifying the legacy mode remains authorized; preserve data and existing iframe defenses.

**Implemented proposal, pending operator sign-off:** `VIBRESS_NATIVE_ADMIN_UI_RELEASES` is a centrally validated, default-unset environment allowlist of exact `pluginId@entrypointSha256` values. It does not add a plugin capability or change the operator lockfile schema. See the [rollout runbook](native-admin-ui-rollout-runbook.md); production enablement is prohibited before acceptance.

### D-06 — Resource and action authorization (future NUI-03)

Page-level permission controls only visibility. Every read/write resolves a Host-owned namespaced identifier bound to the same approved plugin/release and independent Staff permission and publication-local role. Mutations require resource/record ownership plus dedicated write permission; generic `plugins.read` or `posts.read` is never a grant. Existing v1 Admin POST restrictions remain intact. New resource/operation policy cannot silently expand them.

Proposed transport for NUI-03, **not implemented or frozen**: versioned Host-owned `GET /api/admin/v1/extensions/:pluginId/resources/:resourceId` and `POST /api/admin/v1/extensions/:pluginId/actions/:actionId`. No arbitrary browser-provided URLs/methods/permissions; share existing error envelopes, Origin, Staff, capability, publication, rate limiting, ownership and audit policy.

Cursor semantics require authenticated, opaque scope-bound tokens (Staff/publication/plugin/release/resource/query), TTL/rotation rules, bounded rows and stable ordering. **OPEN API DECISION:** pick a specific implementation compatible with current storage and self-hosting, then test mixed-replica failure/replay cases before creating endpoints. Do not introduce raw SQL, ad hoc user-supplied cursors or unsigned tenant selectors.

### D-07 — Locale and design system

Native v1 uses the existing required `en`/`ar` plain-text labels, matching `ExtensionAdminLabelSchema`. It is not a durable global two-locale mandate: future generalized BCP-47 labels require versioned negotiation and fallback policy. React Host owns escaping, `dir=auto`, logical CSS, focus, keyboard behavior, responsive design, errors, and the Posts-style `AdminPageHeader`. A later generalized locale map must not silently change v1 acceptance.

### D-08 — Deployment, trust and compatibility

No plugin JS/HTML/React/CSS is imported into the privileged Admin document. Existing opaque-origin iframe/one-use Redis ticket/CSP/MessagePort remain unchanged. Tier 1 ESM still runs with privileged API/Worker process access; Tier 2 isolation is separate. No existing migration or persisted LMS format is modified merely to switch presentation modes.

## NUI-01 prototype boundary and tests

**Included now:** SDK types, Zod schema/response validation, API static admitted-view binding, release fingerprint allowlist, Host-only stat/field-list rendering and authored tests.

**Explicitly not included:** structured resources/pagination, mutations/actions, forms, generic plugin navigation groups, LMS changes, database migrations, production verification or a stable external SDK. The Host/API/UI behavior changes only if an operator explicitly allowlists a pinned release.

The tests are authored but not executed in this environment. They prove only syntax rejection **if they pass**; no schema unit test can prove server admission/authorization or DOM text escaping.

Required NUI-01 follow-up: run `pnpm --filter @vibress/api-contracts typecheck`, `pnpm --filter @vibress/plugin-sdk typecheck`, the focused Vitest tests, lint and affected regression tests in a full checkout. Review generated build artifacts and diff. A future Host admission/consumer integration needs separate permissions/integration tests and explicit approval.

## Acceptance checklist and sign-off

| Gate | State | Owner evidence required |
| --- | --- | --- |
| D-01 SDK boundary and additive shape | Proposed + prototype | Architect/API/Plugin approval; old-consumer typechecks |
| D-02 bounded read-only descriptor | Proposed + prototype | API/Security approval; linked GET field admission tests |
| D-03 conservative limits | Draft defaults | QA profiling, boundary tests and approved production budgets |
| D-04 Host/SDK/UI negotiation | Policy proposed | Old/new Host/plugin matrix and operator release compatibility |
| D-05 release-scoped Native opt-in | Strategy proposed | Operator config mechanism, signed approval identity, rollback/upgrade drills |
| D-06 resource/action authorization | Invariants proposed | Specific API routes, ownership matrix, cursor policy, adversarial tests |
| D-07 locale/a11y | v1 shape drafted | i18n/RTL and accessibility acceptance |
| D-08 browser/runtime trust | Preserved in design | Independent Security approval and real iframe/native E2E |
| Legacy LMS HTML injection | Existing issue OPEN | Separate LMS hardening code + hostile-content tests |
| Formal Architecture/Security/API/Operations sign-off | **NOT OBTAINED** | Named reviewers explicitly approve the RFC |
| CI/typecheck/lint/integration/E2E | **NOT RUN for NUI-01** | Green relevant gates and reviewer evidence |

**Release decision: HOLD.** Do not enable the new release-pinned environment allowlist in production before tests, API-first deployment verification, and Security/Architecture/API/Operator sign-off. See [rollout runbook](native-admin-ui-rollout-runbook.md).
