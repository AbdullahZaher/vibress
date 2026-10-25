# Native Admin UI Extensions — Production Implementation Plan (v2.0)

**Status:** NUI-01/NUI-02 read-only candidate plus experimental NUI-03 storage-backed resources/create/update routes and opt-in NUI-04 navigation groups. NUI-03 is not yet production-accepted or an arbitrary business-action framework; NUI-04 forms and NUI-05 to NUI-07 remain incomplete.
**Date:** 2026-10-25.
**Owner:** Vibress core platform.
**Baseline:** `main` at `782d7499ad695bafe90411b1512596380e667ca8` (merged PR #88).
**Pilot:** `AbdullahZaher/vibress-lms`, only after the existing pause on LMS feature development is explicitly lifted.
**Priority:** P1 design work. Existing P0 plugin-platform security, installation, and operational acceptance gates remain authoritative.

This plan is subordinate to the [Plugin Platform Production Completion Plan](plugin-platform-production-plan.md), [external SDK release gates](external-sdk-release-gates.md), and [plugin trust model](../14-decisions/plugin-trust-model.md). It does not authorize untrusted plugin code, a marketplace, automatic installation, or bypassing unresolved production gates.

## Problem and verified starting point

The Host already has the pieces of a secure but limited extension experience:

- `@vibress/plugin-sdk` exposes optional `PluginModule.adminViews` and `adminNavigation`, linking a view to a Host-authorized Admin GET route. The current SDK protocol is `1.0.0`, not a newly published independent SDK.
- `apps/api/src/plugins/admin-view-registry.ts` validates a bounded view/navigation registry; there is an independent Staff and publication-local permission check in `admin-view-permissions.ts`.
- `PluginAdminDataView.tsx` renders escaped, read-only scalar data inside Admin. `PluginAdminView.tsx` uses an opaque-origin, sandboxed iframe for separately pinned interactive HTML when available.
- `ScopedPluginSettingsEditor.tsx` already renders a narrow Host-owned native editor for publication settings; it is not a general extension form framework.
- `apps/admin/src/components/layout/sidebar/NavExtensionViews.tsx` currently treats LMS specially by testing the plugin ID string. A general navigation registry should not encode product names.
- Extension Admin API response shapes are scalar-oriented; LMS currently serializes some course lists into bounded JSON strings. A native data table requires a reviewed, structured, paginated resource contract.
- `vibress-lms/assets/courses.html` provides independent HTML/JavaScript for course authoring. Migrating its presentation must not change persisted course, enrollment, or lesson data semantics.

No native interactive extension-page contract, resource envelope, or action registry is shipped by this plan.

## Outcomes

1. Operator-approved plugins describe pages declaratively; the **Vibress Host**, not plugin JavaScript in the browser, renders existing React Admin components.
2. Native pages inherit Admin shell, header style, shared controls, navigation, theme, locale/RTL, accessibility, responsive layouts, and error handling.
3. A typed, server-authorized resource/action boundary supports real read/write workflows without a browser-supplied URL, method, publication, or permission.
4. Old `adminViews`, `adminNavigation`, iframe artifacts, and scalar views remain functional on fresh installs and upgrades.
5. The LMS pilot demonstrates real course list/create/edit/save/publish parity before native rendering becomes a supported default.
6. A plugin developer can build an independent, conforming example using only documented public SDK exports.

## Architecture decisions to propose, not assume shipped

- **Host-rendered declarative UI** is the target native mode. The plugin supplies bounded, inert descriptors; the Host owns React, DOM, styling, routing, API transport, and action execution.
- **Additive SDK evolution:** extend the existing canonical `@vibress/plugin-sdk` interface with optional versioned native descriptors. Do not create `@vibress/admin-ui-sdk` until independent consumers demonstrate a need.
- **Three render modes:** `native` (new), `isolated-frame` (existing), and `legacy-data` (existing). Version/admission rules determine the mode, not an arbitrary client URL.
- **Distinct contracts:** page/layout schema, typed data-resource contract, and typed action contract. A page descriptor alone cannot grant access to a route or mutation.
- **Allowlisted components first:** page header, card, stat, table, form, tabs, and alert. No arbitrary component registry, CSS, HTML, script, code expression, `eval`, or plugin-provided React module.
- **Preserve authority:** Staff session, validated Origin where appropriate, both global permission and publication-local role, Host-resolved active publication, plugin status and admission, plus per-resource/action access checks.
- **Compatibility before aesthetics:** avoid changes to persisted LMS formats, public/member routes, themes, or existing installation tables merely to implement a native editor.
- **Trust boundary is not a sandbox:** native UI reduces browser exposure; it does not isolate Tier 1 ESM executed inside API/Worker. Tier 2 remains separately gated.

See the [Native UI RFC](native-admin-ui-rfc.md), [NUI-00 decision record](native-admin-ui-decisions.md), [architecture/security review](native-admin-ui-nui00-review.md), [threat model](native-admin-ui-threat-model.md), and [Security and Compatibility Matrix](native-admin-ui-security-compatibility.md). The NUI-00 source inventory is recorded in the review; documentation work is not release approval.

## Deliverables and exit gates

### NUI-00 — Design, threat model, and compatibility inventory (design gate)

**Scope**
- Map all `adminViews`/`adminNavigation` consumers, direct Admin API routes, plugin installation/admission, active-publication state, iframe fallback, settings, and LMS producer/consumer behavior.
- Review the proposed descriptor/resource/action ABI and version negotiation with security, API, Plugin/Theme, i18n/RTL, and QA owners.
- Approve a documented accessibility and design-system reference based on the existing Posts header, form elements, and sidebar.
- Identify exact contracts and error codes that cannot change. Define measured budgets for payload size, nesting, pages, rows, action count, and discovery latency; avoid fabricated performance promises.
- Record RFC decisions and alternatives. No code or database changes in this ticket.

**Gate:** a reviewed and signed-off RFC, complete source/consumer inventory, threat model, exact native/legacy fallback state machine, Host-owned action policy, release/ABI negotiation, operator rollout policy, bounded budgets and baseline tests. The inventory, threat model and findings are now documented, but owner sign-offs and several protocol decisions remain **OPEN**. No runtime code work is authorized by this document alone.

### NUI-01 — Additive native descriptor and API contract

**Scope**
- Add optional versioned `adminPages` (working name) to the canonical SDK; keep current fields and behavior unchanged.
- Use runtime Zod schemas in `@vibress/api-contracts` for descriptors, labels, component kinds, binding IDs, action IDs, and an allowlisted icon set.
- Admit descriptors only for active, operator-approved, publication-enabled modules with declared relevant capabilities. Include release/version identity in static descriptor caching; never cache user authorization.
- Define explicit compatibility negotiation for unsupported or malformed schema versions; test under old Host/new plugin and new Host/old plugin combinations.
- Keep all Admin links Host-generated. No plugin-supplied routing paths, script/asset URLs, raw style objects, or permission predicates.

**Gate:** valid and adversarial descriptor fixtures; old v1 plugin fixtures unchanged; unsupported versions fail closed; no migrations needed for the descriptor alone.

### NUI-02 — Native read-only page renderer

**Scope**
- Add an allowlist renderer in `apps/admin` using existing Admin design tokens and components (including `AdminPageHeader`).
- Reuse Host-owned `/admin/extensions/:pluginId/:viewId` routing where feasible; do not overwrite routes or inject React modules.
- Implement loading, empty, error, denied, revoked, and plugin-disabled states.
- Honor server-validated locale labels, `dir=auto` for mixed content, keyboard navigation, focus, and responsive layouts.
- For an absent native declaration, preserve established iframe/data-view selection. Do not fall back after an explicitly invalid or unauthorized native declaration.

**Gate:** a real read-only plugin page renders without iframe, has accessible E2E coverage, and cannot render executable plugin markup.

### NUI-03 — Structured resources and authenticated actions

**Scope**
- Introduce a **separate versioned resource envelope** for arrays/objects, bounded typed records, stable cursor pagination, and allowlisted server-side filters and sorts. Do **not** silently broaden the v1 scalar route response contract.
- Register namespaced action IDs against fixed Host-approved Admin routes and explicit read/write permissions **plus resource/record ownership**. Treat page-level permission as a visibility hint only; never infer an action grant from a button, route presence or plugin manifest. All inputs and outputs have runtime schemas and bounded sizes.
- Apply Staff/publication-local role checks on every call, independent of navigation visibility. Bind publication exclusively from the Host-authenticated session/context.
- Define optimistic concurrency/version conflict behavior; handle duplicate, stale, and retried mutations deliberately. Operations that create or publish records must not succeed twice by accident.
- Preserve existing status/error envelopes, request IDs, rate limits, CSRF/origin validation, no-store behavior, and audit requirements.

**Gate:** resource/action success plus 400/401/403/404/409, wrong-publication, stale-session, duplicate, and malicious input tests; documented compatibility with old scalar routes.

### NUI-04 — Forms, settings, actions, and generic navigation

**Scope**
- Implement bounded form fields only where needed: text, number, select, checkbox, textarea, and an explicitly reviewed secret-field policy. Use server-authoritative validation.
- Preserve existing settings encryption and masking semantics. Never put decrypted settings secrets into page descriptors, discovery payloads, logs, or default form values.
- Add Host-owned confirmations, busy states, unsaved-change protection, field errors, and consistent notifications. Confirmation is UX, not a server authorization grant.
- Introduce validated navigation groups/ordering/icons without hard-coded LMS name detection. Keep old navigation items and route URLs valid.
- Match the Admin Posts-style header (title + description, no leading title icon), spacing, shared controls, and design tokens.

**Gate:** native settings and form E2E for keyboard, screen reader, dark mode, mobile, English/Arabic/RTL; no secret leakage or cross-publication draft persistence.

### NUI-05 — LMS course-authoring pilot (conditional on LMS resumption)

**Scope**
- Add **plugin-owned** native descriptors and typed resource/action wiring in the independent LMS repo; do not add LMS-specific React, sidebar rules, or handlers to Vibress core.
- First reproduce the supported course list/search/filter and course draft create/edit/save/publish operations, including bilingual fields and version conflicts.
- Maintain existing storage, published content, API semantics, member/private lesson authorization, and public catalog behavior. No feature expansion into payments, assessments, or unfinished analytics.
- Run parity tests against the existing authoring workflow before enabling Native by default. Keep the old frame route for rollback.

**Gate:** real API + database + browser acceptance in two publications and two locales; zero content-format changes or unauthorized mutations.

### NUI-06 — Security, rollout, and production acceptance

**Scope**
- Independently review XSS, schema recursion, policy confusion, IDOR/BFLA, origin/CSRF, publication switching, cache invalidation, plugin revocation, secret fields, denial of service, and rollback paths.
- Test mixed-version Host/API replicas, signed operator artifacts, disabled/updated plugins, retries, concurrent writes, and populated upgrades.
- Stage native mode behind an **operator-controlled, default-off opt-in rollout** bound to the reviewed plugin/release; compare behavior with existing iframe and scalar modes. The rollout mechanism is undecided and must not be implemented by inventing an undocumented environment variable.
- Measure first-render, discovery, resource pagination, and action latencies in representative self-hosted environments; document real budgets and thresholds before GA.
- Complete relevant Vitest, typecheck, lint, build, Admin E2E, Docker, and operator acceptance gates. Do not call CI success production certification.

**Gate:** approved security/architecture review, verified fresh+upgrade+rollback, all affected checks green, and explicit operator sign-off.

### NUI-07 — Developer documentation and supported SDK release

**Scope**
- Publish a standalone conformance sample using only public plugin SDK/contract exports and the operator-approved admission model.
- Provide guides for page definition, resources/actions, localization, testing, upgrades, and legacy frame migration.
- Version the public contract and document compatibility ranges; release only after external consumer and operations gates are met.

**Gate:** independent consumer compiles and passes contract/E2E tests; support policy published; existing SDK and releases remain compatible.

## Dependency order and scope limits

`NUI-00 -> NUI-01 -> NUI-02 -> NUI-03 -> NUI-04 -> NUI-05 -> NUI-06 -> NUI-07`.
Independent docs/tests may be drafted in parallel, but no interactive native write path ships before NUI-03 security authorization. The first read-only vertical slice can complete NUI-02 without declaring the full system ready. Split tickets/PRs further when an increment spans independent security contracts.

**Never** bundle this design with unrelated plugin installation/runtime isolation changes or LMS feature expansion. Operator-trusted Tier 1 packages and Tier 2 containment are governed by their existing separate plans.

## Activation, fallback, and rollback policy

1. Native mode starts operator-disabled, enabled per reviewed plugin/release only after each gate.
2. A plugin with **no native declaration** continues existing legacy iframe or Host-read-only behavior.
3. An **explicit malformed, revoked, disallowed, or unsupported native declaration** produces a fail-closed state and diagnostics; never silently render untrusted HTML or downgrade access controls.
4. Feature disable/rollback changes the presentation mode only; never delete, rewrite, or migrate durable plugin data as part of the renderer switch.
5. For a production rollout, pin the artifact/version, check Host/API replica parity, and keep a tested operator rollback path. A legacy fallback after a security denial is not permitted.

## Definition of done for each ticket

- Status, role review, scoped code/docs diff, and tested backward-compatibility implications.
- No direct DB access from browser; Host-authorized Admin API remains the sole data/mutation boundary.
- Tests cover valid, invalid, unauthorized, cross-publication, disabled/revoked, stale, conflict, and relevant retry cases.
- Arabic/RTL, accessibility, responsiveness, multi-replica/self-hosting, persisted content, plugins/themes, and migrations reviewed as applicable.
- Only actual test/CI results reported. No speculative release or production-readiness claim.

## Documentation state and next step

**Completed by documentation:** initial plan, draft RFC, source/consumer inventory, NUI-00 design/security findings, threat model, compatibility matrix and cross-document navigation.
**Implemented on development branch, pending full CI acceptance:** optional NUI-01 SDK/Zod descriptor, server-side binding of native pages to already admitted Admin GET fields, release-digest allowlisted Staff/publication-scoped Native discovery endpoint, NUI-02 Host-owned stat/field-list renderer, and additive NUI-04 optional navigation-group metadata with server admission and an Admin sidebar renderer. Regression/security tests are written, not run. The environment allowlist is unset by default. See [rollout runbook](native-admin-ui-rollout-runbook.md).
**Not yet done:** formal Architecture/Security/API/Operations sign-off, NUI-03 production API/security integration acceptance and business-specific authorization for non-storage actions, NUI-04 native forms/settings, measured performance budgets, LMS native migration, populated upgrade/rollback acceptance and operator approval. The experimental NUI-03 API supports Host-approved plugin storage only, with separate default-off read and write release allowlists and signed publication/actor/digest-bound pagination cursors. It does not implement LMS publish or bypass its domain invariants.

**Next step:** run scoped/full checks in a complete checkout; obtain Architecture, Security, API, QA and Operator approvals before enabling the allowlist. Validate and harden NUI-03 Host storage resource/action routes, then implement remaining NUI-04 native forms/settings and NUI-05 independent LMS parity, NUI-06 live acceptance, and NUI-07 SDK release in separately validated increments. Do not label this read-only slice production-ready.

## Latest NUI-04 through NUI-07 development-branch state

NUI-04 now includes an operator-field-typed, Host-rendered resource table with pagination, text filters and confirmation-gated storage create/update forms. These controls are inert without independent, default-off Host approval and do not execute plugin React/JavaScript. NUI-05 has an independently branched, read-only LMS Course Overview candidate that preserves the existing authoring/publishing iframe and does not register generic LMS storage actions. See the [NUI-06 security/production acceptance matrix](native-admin-ui-production-acceptance.md) and [NUI-07 SDK developer conformance guide](native-admin-ui-sdk-conformance.md). Full browser localization, signed release, compatibility, upgrade and multi-replica acceptance remain blocking; documentation completion alone is not certification.
