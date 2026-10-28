# Vibress Plugin SDK — Native Admin UI Developer Contract v1.0 (Proposal)

**Status:** Revised **proposal** for stabilization and extension. The document revision is v1.0; this is **not** a Native wire protocol version, published SDK, feature flag approval or released API.  
**Prepared:** 2026-10-28  
**Owner:** Vibress core Plugins/SDK + Admin/API/Security/i18n owners.  
**Companion:** [Unified Plugins Platform Roadmap v3.0](plugin-platform-master-roadmap-v3.md).  
**Compatibility:** Preserve existing `@vibress/plugin-sdk` and its runtime `SDK_VERSION = "1.0.0"`; `packages/plugin-sdk/package.json` currently declares package `1.2.0`, `private: true`. These version numbers do NOT represent a shipped stable public SDK.

## 1. Product promise

A developer can create a professional Vibress extension UI **using only a public, versioned SDK**, and Vibress renders its controls using the Admin design system without iframe by default **only after Host/operator admission**. Developers should not need React/Vite/Next.js/Fastify/Drizzle internals to author Native pages. Complex business workflows must go through separately authorized Host-bound backend actions. The plugin does not execute JavaScript in the privileged Admin origin.

Three developer paths are intentionally supported:

- **Native (preferred when admitted):** inert, typed page/navigation/resource/action/workflow declarations rendered by Vibress components.
- **Existing Host scalar/data view:** supported legacy projection with independent Host authentication and release policy.
- **Isolated iframe:** retained only for previously supported interactive HTML or intentionally isolated custom UI; opaque-origin/sandbox rules still apply. Never silently downgrade a security-denied Native view to executable HTML.

## 2. Current verified baseline and gaps

| Existing source | What already exists | What remains |
| --- | --- | --- |
| `packages/plugin-sdk/src/index.ts` | `PluginModule`, `adminViews`, `adminNavigation`, optional `adminPages`, `adminResources`, `adminActions`, `adminDomainWorkflows`; SDK ABI v1.0.0 | Stable public exports, ergonomic helpers, version negotiation, external release policy |
| `native-admin-ui.ts` | Experimental Host-rendered stat/field-list page types | Conformance freeze and richer bounded components, layouts, action references |
| `native-admin-data.ts` | Model/resource projection and basic create/update action metadata | Explicit typed filtering, field presentation, schema-specified write/visibility controls and documented errors |
| `native-domain-workflow.ts` | Bound create/save/publish form metadata | General domain workflow evolution with idempotency and strict Host admission (do not use generic storage to publish) |
| `packages/api-contracts/src/extension-native-*.ts` | Strict Zod schemas and size/count ceilings | Cross-version wire compatibility, new widgets via versioned schemas, machine-readable SDK conformance |
| `apps/api/src/routes/extension-admin-views.ts`, `extension-native-data.ts` | Operator-gated Native admission and resource/action gateway | Hardened public support contract, zero authorization drift, update/revocation coordination |
| `apps/admin/src/components/platform/NativeExtension*.tsx` | Host renderer, bounded forms/records/domain workflows | Design-system widget coverage, complete settings/media UX, UX polish and adversarial acceptance |
| PR #96 | Merged with automated Native acceptance evidence | Formal human/operator production opt-in (read/write allowlists remain unset by default) |

**Existing v1 hard bounds (do not expand implicitly):** up to 8 `adminPages` per module; up to 12 components per page; maximum 64 KiB page descriptor; up to 8 resources and 16 actions; data page up to 20 records; domain workflow at most 16 KiB. Individual field/label limits are enforced by the existing Zod contracts. Further growth requires measured limits and a versioned change.

## 3. Design principles

1. **Single canonical SDK:** `@vibress/plugin-sdk`. Add optional types, pure declaration helpers and conformance fixtures. No competing SDK; separate CLI only if needed for packaging.
2. **Manifest is intent, not authority:** declared capabilities, labels, permissions, resources and actions do not grant any Host privilege.
3. **No executable browser contribution:** no plugin-provided JSX, React components, JS functions, event handlers, arbitrary hrefs, HTML, inline CSS or dynamic expressions in Native descriptors. Admin owns rendering, sanitization, focus and data transport.
4. **Typed and bounded end-to-end:** exact Zod runtime validation in Host API, TS types in SDK, reviewed limits, resource projection, stable errors and positive/negative conformance.
5. **Explicit permissions:** read and write separately checked at the Host for session, publication, role, plugin activation, capability, signed artifact digest, model/record and operator release allowlist.
6. **Data never acts as code:** no plugin-selected SQL, arbitrary table names, tenant IDs, API URLs, dynamic import or code evaluation.
7. **Additive compatibility:** current `PluginModule` methods, Host v1 route ABI, legacy Admin views and persisted content remain supported. Reject unknown required features explicitly.
8. **International by design:** no LTR-only labels; locale fallbacks and directionality, keyboard, accessible names and semantic forms are Host responsibilities.
9. **Independently buildable:** external SDK consumer must compile and test outside monorepo without accessing `@vibress/database`, `@vibress/domains/plugins` or private source files.
10. **Operationally honest:** exact release identity and operator opt-in matter; neither package semver nor a successful static parse proves production admission.

## 4. Developer ergonomics: shipped v1 shape versus proposed vNext

### 4.0 Existing experimental contract — accurate v1 example

The following is a **TypeScript authoring-shape example of current public exports**, not a deployable approved plugin. Native rendering additionally requires a separately approved release and existing Staff/Host permissions. Both page title locales are mandatory in v1; the example does not change the published ABI.

```ts
import type { PluginModule } from "@vibress/plugin-sdk";

const label = { en: "Overview", ar: "نظرة عامة" };
export const plugin = {
  activate() {},
  routes: [{
    id: "overview",
    audience: "admin",
    method: "GET",
    permission: "plugins.read",
    response: { fields: { total: "number" }, required: ["total"] },
    handle: () => ({ total: 0 }),
  }],
  adminViews: [{ id: "overview", routeId: "overview", title: label }],
  adminNavigation: [{ viewId: "overview", label, permission: "plugins.read" }],
  adminPages: [{
    schemaVersion: 1,
    viewId: "overview",
    title: label,
    components: [{ type: "stat", id: "total", label, field: "total" }],
  }],
} satisfies PluginModule;
```

**Not a security grant:** the plugin manifest, operator release, exact artifact digest, approved capabilities, publication enablement, runtime module admission and Host routing still must be configured independently. Without Native approval it uses the documented compatible legacy behavior; malformed/denied Native metadata fails closed.

### 4.1 Proposed vNext builder API (NOT IMPLEMENTED)

The code below is a **target authoring experience**, not the present runtime API. Final naming and wire shape require API/SDK review. Helpers must return inert JSON-compatible declarations; no React runtime or private Host import is allowed.

```ts
// NON-RUNNABLE design sketch: names, schemaVersion 2 and shapes do not exist in the SDK.
import {
  definePlugin,
  defineAdminPage,
  defineAdminResource,
  defineDomainAction,
  defineAdminNavigation,
} from "@vibress/plugin-sdk";

const coursesPage = defineAdminPage({
  schemaVersion: 2, // an explicit future protocol; v1 stays supported
  id: "courses",
  title: { key: "lms.courses.title", fallback: "Courses" },
  description: { key: "lms.courses.description", fallback: "Manage courses" },
  layout: [
    { type: "stat", id: "total", source: "course-summary", field: "total" },
    {
      type: "table", id: "course-list", source: "courses",
      columns: [
        { key: "title", heading: { key: "lms.course.title", fallback: "Title" } },
        { key: "status", heading: { key: "lms.course.status", fallback: "Status" } },
      ],
      rowActionId: "open-course",
    },
  ],
});

const courseResource = defineAdminResource({
  id: "courses", modelKey: "courses", // only after separate operator model approval
  fields: ["title", "status"],
  allowedFilters: ["status"],
  // Field projection and filtering do not create DB tables or grant read access.
});

const publishCourse = defineDomainAction({
  id: "publish-course",
  routeId: "course-operations", operation: "publish",
  // Host must still validate release, caller, publication, route schema and CAS.
  requiresConfirmation: true,
});

export default definePlugin({
  manifest: { /* separately reviewed and signed manifest */ },
  admin: {
    pages: [coursesPage],
    resources: [courseResource],
    domainActions: [publishCourse],
    navigation: [defineAdminNavigation({ pageId: "courses", groupId: "learning" })],
  },
});
```

**Scope caveat:** Do NOT copy this pseudocode into a production plugin. The sample does not imply that a real `courses` database model, generic table action, `layout` schema, `schemaVersion: 2`, or any builder is already shipped. The existing v1 uses `viewId`, linked admitted GET routes, static `stat`/`field-list`, and limited approved resource/action/workflow declarations. A new v2 protocol must be introduced only with explicit negotiation and tests. The sample represents DX goals, not an authorization design or deployable recipe.

### Proposed developer helpers

| API | Responsibility | Must NOT do |
| --- | --- | --- |
| `definePlugin()` | Validate authoring structure and infer TypeScript types | Import plugin code into Admin, grant runtime capabilities |
| `defineAdminPage()` | Produce inert page definitions with stable IDs and component references | Accept JSX, callbacks, raw styles or dynamic URLs |
| `defineAdminResource()` | Describe a bounded, projected Host-approved model/data source | Open SQL connections or create schemas at definition time |
| `defineDomainAction()` | Refer to an independently admitted existing backend action with typed input/output | Manufacture a Host endpoint or bypass route validation |
| `defineAdminNavigation()` | Describe grouped labels and icon IDs | Create arbitrary routes, navigation URLs or actor permission predicates |
| `defineSettings()` | Type labels, nonsecret settings and secret-field handling rules | Embed decrypted secrets in metadata or return them to the browser |
| `defineTranslations()` | Declare BCP-47-aware message catalogs / fallback keys | Treat locale as a tenant selector or send unvalidated HTML |
| `createTestHost()` (future test harness) | Run plugin declaration/authorization tests in isolated fixtures | Claim actual production attestation or Tier 2 security |

Use pure helpers with zero network, filesystem or DB side effects when imported. Defer any runtime command handler to the approved module's existing Host-routed API, where permissions are rechecked on every call.

## 5. Native Admin UI descriptor protocol roadmap

### 5.1 v1 — existing additive contract (stabilize before expanding)

- `adminViews` explicitly link to a Host-admitted GET route; `adminPages` extend an existing view ID and declare `stat`/`field-list` only.
- `adminNavigation` uses Host-generated paths, labels and a restricted icon set.
- `adminResources` refer to an independently operator-approved storage model and exactly projected fields. Host returns bounded rows, handles cursor pagination and validates filters.
- `adminActions` are basic `create`/CAS `update` of approved storage, NOT arbitrary business operations.
- `adminDomainWorkflows` bind an admitted read view + paired authorized POST route with allowed `create`, `save`, `publish` operations, owned by the plugin domain handler.
- Read and write allowlists `VIBRESS_NATIVE_ADMIN_UI_RELEASES` and `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` are separately pinned to exact signed plugin release digests and default disabled. No plugin can toggle them.

### 5.2 vNext — professional components only after demand/approval

**Tier A components (first proposed additions):** resource-backed data table, approved filters, pagination, detail fields, status badge/notice, empty/error/loading skeletons, link-to-Host-owned page, deterministic form layout and primary/secondary confirmation actions.

**Tier B components (separately reviewed):** non-secret settings panel, select/checkbox/number/textarea, date/locale inputs, media picker bound to the existing Host-authorized library, reusable validation messaging, supported Studio rich-text editing only through a narrow content API. No raw HTML editor or arbitrary embedded script.

**Tier C (only demonstrated use cases):** charts from bounded numeric series, bounded tabs/sections, import/export jobs with resumable progress, plugin-owned background workflows and optional desktop/mobile refinements. Import/export and file upload require independent permissions, malware scanning, quota and cleanup review.

For *each* new component define a discriminated schema, version, size/depth bounds, data-source binding, sanitized error/empty state, accessibility semantics, locale behavior, representative plugin fixture and denial tests. Do not implement generic executable UI DSL or open-ended theme component resolution.

### 5.3 Navigation and routing

Host namespace stays canonical: `/admin/extensions/:pluginId/:viewId`. Navigation is a validated projection of admitted descriptors, and does not invent routes or permissions. The Plugin Manager `/admin/plugins` is core-owned and separate. Group metadata should not infer LMS status from plugin IDs; older ungrouped navigation remains valid.

### 5.4 Settings and secret fields

Provide a typed settings schema adapter referencing existing publication-local settings and encryption behavior. Host renders masked secret controls, supports explicit replace/revoke, and never reveals decrypted secret values in descriptor, discovery, cache, developer preview or logs. Settings migration is a backend/data operation, not a UI-renderer switch. Audit privileged updates and protect secrets from unsaved-draft leakage across publications.

### 5.5 Translations and RTL

Existing SDK v1 requires `{ en, ar }` labels. Preserve this as a supported legacy shape. A versioned Native localization extension should use declared BCP-47 message catalogs or translation keys with reviewed fallback behavior, not arbitrary browser/locale selectors; the Host resolves active UI locale, applies pluralization and bidi-safe formatting, and uses `dir=auto` for mixed-language data. Require tests for Arabic long labels, English mixed with Arabic, keyboard navigation, screen readers, dates, numbers and mobile breakpoints. Avoid changing published plugin content language policy when extending UI labels.

## 5A. Developer-facing trust and boundary guarantees

- **Server-side descriptors are untrusted input** even when shipped by an operator-approved package. Validate after loading, reject unknown properties, bounded nested depth, forbidden URL schemes, prototype-shaping keys, duplicate IDs and cross-page references. Do not render plugin-provided HTML or turn label strings into markup.
- **Data is not a capability.** Discovery can show available resources, but write grants require independently approved Host action, current authenticated Staff permission and publication owner/admin role, correct plugin activation and release fingerprint, exact approved model/record authorization and runtime Zod validation. Every action is rechecked when submitted.
- **Browser delivery is never the Tier 1 isolation boundary.** A signed Tier 1 backend can run with Node privileges; a safe Native Admin renderer only avoids running plugin JavaScript within the privileged Studio document. The previous iframe remains opaque-origin and sandboxed; disablement/denial never grants a fallback authorization.
- **No browser-to-DB or plugin-selected Host requests.** Neither URLs, HTTP methods, tenant IDs, credentials, authorization predicates nor query snippets may be supplied by descriptors. Host route linking, data projection and cursor pagination are fixed and reviewed. Reject arbitrary media/file paths, redirects, SSRF targets and background job names.
- **Session and release transitions are security events.** On publication switch, session/role change, plugin deactivate/revoke, digest replacement or allowlist update: re-check each request, invalidate affected cursors/caches, cancel or ignore in-flight browser responses, and clear optimistic/editor/secret state. Do not require a full browser reload for safety.
- **No generic domain mutations by inference.** A form confirmation, declared `publish` operation, `adminActions` metadata or `PluginModule` capability string never grants a backend write. The separately reviewed domain handler must enforce business rules, optimistic CAS, safe retries, audit atomicity and durable idempotency across external side effects.

## 6. Data/resource/action authorization protocol

### 6.1 Admission sequence

1. Operator independently verifies immutable artifact/lockfile/signature and compatibility; sets exact read/write allowlists as appropriate.
2. Host loads only admitted Tier 1 code or approved Tier 2 runtime; no browser-origin plugin code is imported into Admin.
3. Host validates descriptor with Zod and checks each page reference against a real, permitted Admin GET route (plus associated approved storage resource and POST route for workflows).
4. Staff session, permissions, current authoritative publication, publication-local role, plugin global and local activation, release fingerprint, capability approval and resource/action ownership are checked **at request time**.
5. Host returns only the bounded data and allowed UI semantics. Admin performs no trust decisions based solely on a visible button, link or selected plugin ID.
6. Any invalid, revoked or unsupported Native descriptor is rejected with sanitized error; absence of a declaration may use existing legacy mode. Never turn Native denial into privileged iframe execution.

### 6.2 Action lifecycle

```text
User intent
  -> Host-owned form schema + client validation (UX only)
  -> request to fixed Host API route with CSRF/Origin protection
  -> Staff session + permission + publication role + plugin/release/capability check
  -> Zod input validation + model/record ownership + optimistic CAS + idempotency
  -> existing domain handler (no direct Admin DB)
  -> authorized atomic data/audit commit / queue dispatch as needed
  -> typed result and sanitized status/error + fresh permission/release check
```

Do **not** automatically turn a generic storage `update()` into a domain-specific `publish()` operation. Publication workflows, membership and billing changes require explicit reviewed domain actions. An approval click or confirmation dialog does not confer new server rights.

### 6.3 Error and concurrency policy

Preserve existing API error envelopes and request IDs. Return stable documented 400 for invalid schema, 401 for no valid session, 403 for forbidden role/capability, 404 for missing/out-of-scope resources (when nondisclosure is required), 409 for stale version/duplicate/conflicting state, 429 for bounded rate limits, and sanitized 503 for unavailable providers. Recheck existing route conventions before introducing new codes. Validate resource cursor against actor, publication, plugin ID, resource ID, filter, release digest and expiry. Use HMAC integrity and timing-safe checks as implemented; a signed cursor is not a substitute for authorization.

Retry semantics must be explicit: Host storage writes use CAS/unique keys; domain commands with external effects require idempotency keys and persisted receipts where appropriate. Never promise exactly-once external behavior merely because BullMQ redelivers the same job ID.

## 7. Compatibility and version negotiation

Five distinct identifiers must be documented:

- **SDK package semver** (`packages/plugin-sdk/package.json`; presently `1.2.0`, private).
- **Runtime Host/SDK ABI** (`SDK_VERSION`, presently `1.0.0`).
- **Native descriptor protocol version** (`adminPages[].schemaVersion`, existing `1`; new incompatible shape requires a new version).
- **Plugin version and immutable release/artifact SHA-256** (the exact admission identity).
- **Operator permission/read-write rollout policy** (not plugin-controlled).

A Host must negotiate support and reject unsupported **required** Native features without guessing or treating a matching semver as sufficient. Old plugins retain existing `adminViews` and iframe mode. New plugins that require vNext can declare a minimum supported Host/descriptor contract and be refused by older Hosts. Optional new fields must not change defaults. Legacy `plugin-core` contracts remain preserved or explicitly adapted after a complete consumer inventory. Deprecation demands a documented support window, migration adapter and passing independent compatibility tests.

| Host / Plugin combination | Required behavior |
| --- | --- |
| New Host + old plugin | Supported old API, scalar/iframe path unaffected; absent Native metadata is normal |
| Old Host + new plugin with optional Native | Old supported features work; Native not implied active |
| Old Host + plugin requiring new Native protocol | Explicit incompatible release or disabled feature; no unsafe silent fallback |
| New Host + malformed Native metadata | Fail closed and diagnose without exposing private data |
| New Host + revoked/disallowed release | No Native read/write and no previously cached sensitive UI |
| Mixed replica allowlists/releases | Fail closed; operator must prove homogeneous rollout and draining |
| Publication or Staff context changed | Evict/reset UI and pagination state, reauthorize every request |

## 8. SDK build, test and distribution proposal

### Authoring package

`@vibress/plugin-sdk` ships versioned public `.d.ts` definitions, runtime-safe pure helper constructors, migration/admission contract documentation and a deliberate exports map. Keep Node-only utilities out of browser consumers; avoid accidental `node:crypto` imports in public browser-facing helpers, and test clean installs under supported Node/TypeScript versions. Preserve existing main export to avoid breaking consumers.

### Optional CLI tooling

A separate `@vibress/plugin-cli` or repository CLI can scaffold, typecheck, validate manifests/Native UI, test Host conformance and build deterministic artifacts. Offline signing and verification tools must isolate private keys, avoid lifecycle script execution on untrusted packages, support immutable lockfile hashes and emit machine-readable failure reasons. Installing a plugin into a production Host is an **operator action**, not a CLI `publish` side effect.

### Independent examples

1. Read-only metrics dashboard using `stat` and `field-list` (v1).
2. Publication-owned settings + masked secret (requires approved Host settings integration).
3. Resource table with pagination/filters and CAS editing (vNext components only after protocol approval).
4. Backend domain workflow create/save/publish (paired authorized route, existing LMS fixture only for conformance).
5. Legacy iframe extension tested unchanged and migration guide showing safe opt-in Native mode.

Package one example outside the monorepo and run `pnpm pack`/install (or equivalent reproducible package acceptance) to demonstrate that imports resolve only public exports. Build/verify/sign its immutable release, stage, enable and open the Native page in a real disposable Host + PostgreSQL + Redis + browser environment. Never claim that a packed test artifact has already been published to a public registry.

## 9. Security and QA acceptance matrix

| Category | Mandatory tests |
| --- | --- |
| Schema/XSS | Reject HTML/JS/CSS/URL/oversized/deep/malformed descriptors, malicious persisted strings, event handler fields and unknown component types |
| Auth and tenancy | Anonymous, missing Staff role, revoked session, forbidden plugin capability, foreign publication/record, guessed IDs, operator versus publication admin distinctions |
| Lifecycle | Not installed, inactive, globally active but publication-disabled, stale/revoked release, plugin version upgraded, read/write allowlist independently changed |
| Action safety | Bad payload, forged IDs, wrong route, mismatched body/response schema, stale CAS, duplicate/retry, remote provider outage, audit rollback |
| Concurrency | Multi-tab, multi-API replica, old/new Worker release, overlapping staff edits, revoked cursor or stale cache after publication switch |
| Legacy | Old scalar routes, opaque-origin iframe, old SDK/Host, old `plugin-core`, previously persisted settings and plugin data |
| Global Admin | English/Arabic/RTL, mixed text, translation fallback, dark mode, mobile width, keyboard, focus, screen reader, low-motion preference |
| Ops | Clean Docker images, frozen deps, managed+self-hosted TLS/reverse proxy, PostgreSQL/Redis recovery, signed artifacts, fresh and populated DB upgrades |

**Existing evidence vs additional acceptance:** Merged #96 has automated Native CI and independent packaged-consumer fixtures; PR #89 contains extensive separate operator recovery tests. This spec itself was reviewed as documentation only; its sample code, compatibility matrix and security acceptance requirements were **not** executed against a merged tree. Cross-branch *integrated* evidence, formal Native production allowlist approval, stable public SDK publication and Tier 2 sandbox acceptance **do not follow automatically** from either result.

## 10. Proposed implementation tickets (SDK track)

| ID | Deliverable | Exit gate | Dependencies |
| --- | --- | --- | --- |
| SDK-NUI-00 | Audit current v1 SDK and Native Host contract; validate external consumer and freeze no-break commitments | Signed contract matrix/ADR | Roadmap M0 integration |
| SDK-NUI-01 | Document/export current v1 types and version negotiation, improve conformance without changing wire shape | Old plugin/new Host and packed consumer green | 00 |
| SDK-NUI-02 | Introduce pure typed definition helpers with no external side effects | Independent strict TS and public exports only | 01 |
| SDK-NUI-03 | Productionize current read-only stat/field list, navigation and Host rollback | Actual operator sign-off and browser/replica tests | 01 + M1A |
| SDK-NUI-04 | Versioned table/filter/row-detail declarative contracts | 400/403/404 + cursor authorization + accessibility | 02 + API review |
| SDK-NUI-05 | Versioned forms and typed domain actions (CAS/idempotency/confirmation) | No cross-publication write; audit and replay proof | 04 + M2 |
| SDK-NUI-06 | Publication settings + secrets and media-picker Host bridges | Mask/revoke/capability and no token leakage | 05 |
| SDK-NUI-07 | BCP-47 translation key/catalog protocol with `{en,ar}` v1 adapter | Cross-locale and RTL E2E | 02 |
| SDK-NUI-08 | Official independent example packages / CLI validator / documentation | Package install, signed fixture, Host E2E | 03–07 |
| SDK-NUI-09 | Versioned SDK semver/ABI support policy, deprecation, changelog and stable registry release | Sign-off + repeatable external consumer CI | M2/M3 quality gates |

**Prioritize 00→01→02→03 before new widget development.** Tables/forms/media/translation protocol must be driven by signed-off independent plugin use cases, not speculative abstractions.

## 11. Owner review and final decisions required

- **Architect + SDK owner:** approve canonical export naming, Host v1 preservation, protocol negotiation and whether a second `@vibress/plugin-cli` package is warranted.
- **Security:** approve no-code UI boundary, read/write grants, action idempotency, cursor HMAC and revoke/upgrade invalidation.
- **API + DB:** approve wire versions, stored data boundaries, stable errors, migrations and CAS rules.
- **Plugin/Theme + i18n/RTL + Accessibility:** approve examples, design-system components, localization and iframe backward compatibility.
- **QA + Operations:** approve external package matrix, real browser/DB/fleet/DR acceptance and release rollback.

**Exit condition:** a fully supported SDK is not declared stable until the independent consumer, security review, self-host/upgrade tests, Native UI operation and operator approvals all pass on the same accepted release candidate. No unsafe relaxation of authorizations or legacy compatibility is permitted to accelerate SDK publication.

**Implementation note:** This specification is a proposed contract; its v1 example describes existing TypeScript exports, while the builder sketch is explicitly hypothetical. Updating this document neither adds SDK exports nor enables Native UI, creates migrations, installs a plugin or authorizes third-party executable code. See [v3 roadmap review and adoption register](plugin-roadmap-v3-review-and-adoption.md).