# NUI-00 — Architecture, Documentation, and Security Review

**Status:** Technical documentation review completed; NUI-00 approval gate OPEN. NUI-01 has an inert descriptor schema/type prototype but no runtime integration or test run. This is not independent security certification.
**Review date:** 2026-10-25.
**Reviewed baseline:** Vibress `main` at `782d7499ad695bafe90411b1512596380e667ca8`; independent `vibress-lms` `main` inspected on this date.
**Branch:** `docs/native-admin-ui-plan-20261025`.
**Scope:** documentation and targeted source inspection only. No runtime code, data migration, test execution, operator sign-off, or release activity.

## Review outcome

The Host-rendered, declarative direction is preferable to loading external React/JavaScript into the privileged Admin document. The original v2.0 plan captured that boundary, but lacked a sufficiently concrete threat model, consumer inventory, mode-negotiation policy, policy ownership for actions/resources, and explicit handling of already-known LMS presentation hazards. These documentation gaps are addressed or recorded as blocking decisions here. **NUI-01 must not be presented as approved until the open decisions and approvals below are resolved.**

### Reviewed roles and conclusions

| Role | Concrete conclusion |
| --- | --- |
| Architect | Extend canonical `@vibress/plugin-sdk` additively; avoid a second speculative UI SDK and preserve Host-owned routes/design primitives. Existing `plugin-core.VibressPlugin` is a different interface, not a compatible alias. |
| Security Reviewer | Native declarative schemas do not grant permissions and do not isolate server-side Tier 1 ESM. Keep iframe sandboxing for legacy artifacts; authorize every data/action request in the Host. |
| API Designer | Current route responses are scalar-only and action methods are limited. New typed resources/actions require a separately versioned transport, rejection rules and Host-side policy binding. |
| Plugin/Theme Reviewer | Old view/navigation declarations and Host-generated URLs are durable contracts. Native Admin UI must not require editing individual themes or LMS-specific core logic. |
| i18n/RTL Reviewer | Existing en/ar labels must remain compatible; future locale extension needs explicit negotiation, logical-layout and bidi safety. |
| QA Engineer | Validate absence/presence/invalidity of descriptors separately; prove old/new Host/plugin interoperability, two publications, browser security, and populated upgrade/rollback. |

## Verified source and consumer inventory

| Surface | Reviewed source | Current role and compatibility constraint |
| --- | --- | --- |
| Canonical plugin ABI | `packages/plugin-sdk/src/index.ts` | `PluginModule.adminViews` and `adminNavigation` are optional; route permission enum is bounded. ABI protocol currently `1.0.0`. New declarations must remain optional. |
| Legacy ABI | `packages/plugin-core/src/index.ts` | `VibressPlugin.onActivate/onDeactivate` is not the same module shape; do not pretend native descriptors work through it without an explicit adapter review. |
| Runtime data validation | `packages/api-contracts/src/plugins.ts` | `ExtensionAdminViewSchema`, navigation schemas and `validateExtensionApiObject` enforce legacy scalar responses. No silent array/object widening. |
| Admin admission | `apps/api/src/plugins/admin-view-registry.ts` | Maximum eight views/plugin; each view must link to one admitted Admin GET route with matching permission and bounded optional query. |
| Staff permission | `apps/api/src/plugins/admin-view-permissions.ts` | Global permission **and** publication-local role; existing `plugins.manage` is publication owner/admin only. Action policy must be independently designed. |
| Write boundary | `apps/api/src/plugins/admin-write-permission.ts` and `apps/api/src/routes/extension-api.ts` | Existing Admin POST accepts only `plugins.manage` or `posts.edit`, still subject to Staff/publication checks. Native action registration cannot bypass this with a UI declaration. |
| API host routes | `apps/api/src/routes/extension-api.ts`, `extension-admin-views.ts`, `extension-admin-iframe.ts` | Preserve Admin v1 route prefixes, Origin protections, no-store, linked read/write restrictions and frame-ticket security. |
| Browser renderer | `apps/admin/src/components/platform/PluginAdminView.tsx` and `PluginAdminDataView.tsx` | Existing opaque-origin frame + legacy read-only scalar view; neither is a general-purpose native editor. |
| Browser bridge | `apps/admin/src/lib/extensions/admin-bridge.ts` | Fixed linked route, limited MessagePort operations, Host-owned mutation confirmation. Do not downgrade its protections. |
| Routing/sidebar | `apps/admin/src/lib/router.tsx`, `components/layout/sidebar/NavExtensionViews.tsx` | Reserved Host route `/admin/extensions/:pluginId/:viewId`; current LMS-name check is a UI special case, not an extensibility contract. |
| UI primitives | `apps/admin/src/components/common/AdminPageHeader.tsx`, `components/platform/ScopedPluginSettingsEditor.tsx` | Reuse title/description/actions and existing publication settings behavior. Do not treat settings masking as a generic secret schema. |
| LMS plugin | `vibress-lms/src/extension/course-admin.mts` | Courses route GET/POST; `plugins.manage`; optimistic versioned draft updates. Separate `vibress-lms-authoring` manifest is not interchangeable with `vibress-lms-pilot`. |
| LMS HTML | `vibress-lms/assets/courses.html` | Interactive pinned HTML uses iframe bridge; has a dynamic HTML interpolation surface requiring separate hardening. |
| LMS release fixture | `vibress-lms/scripts/prepare-authoring-release.mjs` | Outputs an **unsigned, uninstalled review fixture**, not an approved production artifact. |

Relevant existing tests (not run in this review): `apps/api/src/plugins/__tests__/admin-view-registry.test.ts`, `admin-view-permissions.test.ts`, `admin-ui-frame-tickets.test.ts`, `apps/admin/src/lib/extensions/__tests__/admin-bridge.test.ts`, `apps/admin/src/components/layout/sidebar/__tests__/NavExtensionViews.test.tsx`, `packages/api-contracts/src/__tests__/extension-admin-write.test.ts`, and `vibress-lms/test/course-admin.test.mjs`.

## Findings and disposition

**Severity refers to risk if the affected behavior is enabled or trusted, not a claim that an end-to-end exploit was demonstrated.** "Documented" means only that this design review now records the control; no implementation was performed.

| ID | Severity | Evidence and impact | Disposition / required closure |
| --- | --- | --- | --- |
| NUI-S01 | High | No finalized action permission matrix; current Host restricts linked writes to `plugins.manage` or `posts.edit`. A page-level `permission` cannot safely authorize course/resource mutations or arbitrary plugin-specific permissions. | **Design gate open:** specify Host-owned action admission, record ownership, permission mapping and required negative cases before NUI-03. |
| NUI-S02 | High | `vibress-lms/assets/courses.html` interpolates stored course ID/title into `tr.innerHTML` (near its `renderList` implementation). Escaping/DOM construction is not assured at this sink. Opaque-origin iframe limits browser privileges but does not make interpolated markup safe. | **Existing-code follow-up required:** replace dynamic HTML interpolation with `textContent`/`createElement` or correctly reviewed equivalent; test hostile stored values. Do not claim an exploit or fix from documentation alone. Prioritize before a production LMS pilot. |
| NUI-S03 | High | `vibress-lms/src/extension/course-admin.mts` builds `coursesJson` with `JSON.stringify(...).slice(0, 4000)`, which can truncate JSON inside a record and is not a paginated data contract. | **Implementation blocker for native table:** create an authenticated, bounded, typed cursor resource. Avoid stringified JSON and never widen scalar v1 silently. |
| NUI-S04 | High | Existing Tier 1 plugin code executes inside API/Worker process; UI sandboxing and release signature do not constrain its Node privileges. | **Trust gate remains open:** only operator-trusted code until separately reviewed Tier 2 isolation. Explicitly separate browser safety from runtime containment. |
| NUI-S05 | High | Incomplete native mode/fallback rules could downgrade a rejected descriptor to an iframe or bypass release/permission revocation. | **RFC clarified; implementation untested:** select mode only from approved Host state; fail closed for selected invalid/revoked native declarations. |
| NUI-S06 | Medium | Route-linked metadata, renderer-visible descriptors, caches, delayed responses and multi-publication switching offer stale scope/confused-deputy risks. | **RFC and threat model strengthened:** bind state and request authorization to Staff, publication, plugin ID, release and action; ignore stale browser responses. |
| NUI-S07 | Medium | SDK v1 and `plugin-core` expose different interfaces; "additive" alone does not prove old Host/new plugin negotiation. | **Compatibility gate open:** map consumers and negotiate Host/SDK/UI contract versions, including unsupported required-native cases. |
| NUI-S08 | Medium | LMS authoring routes and published data share a limited pilot schema; feature work on LMS remains paused and native adoption could accidentally imply data-model migration. | **Scope rule:** LMS remains conditional; presentation cannot rewrite durable data or alter published/member contracts. |
| NUI-S09 | Medium | Descriptor/row/action limits, expensive callbacks, cursor replay, plugin upgrade and cache pollution need explicit bounded implementation. | **Design gate open:** freeze measured limits and token-binding semantics before NUI-01/NUI-03 code; adversarial tests required. |
| NUI-S10 | Medium | Future locale support, localization fallbacks, keyboard/focus behavior and RTL are not fully specified by existing two-key label schemas. | **Acceptance strengthened:** preserve en/ar v1, design future locale negotiation, and test bidi/long-label/accessibility. |
| NUI-S11 | Medium | A new user-visible operator activation flag or configuration is an upgrade/operations contract, not just a UI preference. | **Design gate open:** choose existing operator-control mechanism or document, validate and test any new setting/environment variable before implementation. |
| NUI-S12 | Medium | A native page that references forbidden or deleted resource/action IDs may still appear legitimate while the API denies the call. | **RFC clarified:** admission must bind page/resource/action to one immutable approved release; unbound references fail before rendering. |

## Design decisions for review

| Decision | Proposed resolution | State |
| --- | --- | --- |
| Native rendering trust boundary | Inert Host-rendered descriptors only; no imported plugin UI code | Recommended; approval pending |
| SDK surface | Add optional versioned native declarations to canonical SDK | Recommended; approval pending |
| Resource transport | New versioned, typed and bounded envelope; no v1 scalar widening | Recommended; protocol shape pending |
| Action permission | Explicit Host-enforced resource/action grants with global + publication-local authorization | Mandatory; policy mapping pending |
| Mode precedence | No-native or operator-disabled uses legacy; selected invalid native fails closed | Recommended; implementation tests pending |
| Operator activation | Default-off by reviewed release; no invented flag/env variable yet | Mechanism pending |
| UI components | Fixed Host allowlist with measured limits | Recommended; numeric budgets pending |
| Locale policy | Preserve en/ar labels; separately version multi-locale descriptors | Migration policy pending |
| LMS rollout | No LMS work until explicitly resumed; then parity and independent security closure | Pending |

## Decision and NUI-01 status

See the [NUI-00 decision record](native-admin-ui-decisions.md). The v1 read-only type and syntax validator are now authored as an **experimental, non-executed** contract slice; it grants no permission and is not accepted by existing Host routes or the Admin browser. Formal sign-offs, Host view/field admission, compatibility test runs and operator opt-in policy remain blocking.

## NUI-00 acceptance register

| Required evidence | Current status |
| --- | --- |
| Source/consumer inventory and documented proposed threat model | **Drafted in documentation** |
| Explicit NUI-00 findings with severity, controls and affected owners | **Drafted in documentation** |
| Approved action/resource policy and route ownership | **OPEN — API/Security/Architecture** |
| Host/SDK/UI negotiation and degradation contract | **OPEN — API/Plugin reviewer** |
| Quantified descriptor/resource budgets and load-profile evidence | **OPEN — QA/Performance** |
| Operator rollout and backward-compatibility mechanism | **OPEN — Operations/Architecture** |
| Locale extension policy and accessibility reference | **OPEN — i18n/RTL/Accessibility** |
| Risk remediation for legacy LMS HTML sink | **OPEN — LMS Security/Implementer** |
| Security, API, Architecture and Operator sign-off | **NOT OBTAINED** |
| Runtime tests/CI/real container drills | **NOT RUN** |

## Next allowed activity

Revise and approve the RFC/policy decisions and quantify budgets with an independent consumer/Host acceptance fixture. Do **not** advertise NUI-00 as signed off or enable native write APIs. Follow-up code hardening for LMS HTML belongs to a separately scoped implementation change and is not addressed by these documentation edits.
