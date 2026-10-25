# Native Admin UI — Security, Compatibility, and Acceptance Matrix

**Status:** Updated design checklist following source review; NOT a completed security assessment, implementation, or test report.
**Date:** 2026-10-25.
**Related:** [Implementation plan](native-admin-ui-plan.md), [RFC](native-admin-ui-rfc.md), [Tier 2 ADR](plugin-runtime-tier2-isolation-adr.md), [SDK release gates](external-sdk-release-gates.md).

## Security invariant

A native Admin plugin page is Host-rendered **untrusted data**, never Host-executed browser code contributed by a plugin. This protects the browser trust boundary but **does not** constrain the privileges of an operator-trusted in-process Tier 1 ESM plugin in API/Worker. No untrusted ZIP/GitHub/marketplace execution is authorized. Tier 2 process/container isolation must be handled separately.

## Threat/control matrix

| Threat | Required control | Required negative test |
| --- | --- | --- |
| DOM XSS via a title, cell, error, or field | Text-only React rendering; no dangerous HTML/JS, arbitrary href, CSS, component type, or expression | Inject scripts, event attributes, dangerous URL schemes and hostile Unicode through every display field |
| Privilege escalation through declarative controls | Descriptors may reference only fixed approved action/resource IDs; server separately authorizes every request | Forge an action ID, method, URL, permission, and request body |
| Cross-publication access (IDOR) | Host derives publication from authenticated Staff context, checks global permission AND local role, verifies resource ownership | User from site A opens/edits same ID on site B; switch site during an in-flight request |
| Inactive/revoked/changed plugin | Check live status and release identity on each resource/action request; invalidate view state on changes | Disable or upgrade plugin with a page open; attempt stale/replayed requests |
| Secret disclosure | Secret values are not descriptors/discovery data; preserve settings masking/redaction/encryption | Inspect initial HTML, network JSON, errors, logs and drafts for leaked plaintext secrets |
| CSRF/origin bypass | Retain `requireStaffSession`, `validateOrigin`, and same existing route protections | Cross-origin POST or cookie-only request without valid Host context |
| Descriptor denial of service | Bound bytes, depth, items, columns, recursion, rows, pagination, latency, and active actions | Deeply nested, huge, circular-looking, repeated, or expensive descriptor/resource inputs |
| Conflicting or duplicate mutation | Explicit version/ETag or optimistic checks, guarded idempotency where relevant, consistent audit | Concurrent save/publish, stale revision, duplicate submit, retry after network loss |
| Caching private data across sites | No global cache of session/role/publication data; generation/scoped query keys on client | Render site A data after switching to B; late promise resolution |
| Unsafe fallback | Missing native contract uses legacy mode; invalid/revoked native contract fails closed | Corrupt native declaration then attempt iframe/HTML privilege bypass |
| Browser API or network access | Plugin descriptors never run code or choose fetch targets; Admin transport fixed in Host | Supply external script/import URL, data exfiltration URL or forged action endpoint |
| Supply-chain/artifact confusion | Bind descriptor/version to the operator-approved immutable release; no unverified assets | Change release digest, stale descriptor, mismatched Host/API replicas |
| Per-action/resource permission confusion | Page visibility cannot authorize mutation; Host validates fixed action ID, capability, global/local permission, and record ownership | Forge page permission, cross-plugin action ID, resource ID and publication-owned record ID |
| Legacy LMS stored markup injection | Treat persisted values as hostile; remove dynamic `innerHTML` interpolation from legacy LMS HTML | Store hostile course title/ID; verify no executable markup or unexpected bridge use |
| Truncated serialized course lists | Do not rely on `JSON.stringify(...).slice(0, 4000)`; use typed paginated resources | 50+ courses and large/multilingual labels must paginate without malformed JSON |
| ABI/version mismatch | Negotiate Host/SDK/UI schema/release digest; do not assume `plugin-core` is canonical SDK | Old Host/new required-native plugin, unsupported schema, mixed-replica release |
| Operator rollout setting ambiguity | Default off, pinned release allowlist and documented operator setting/upgrade contract | Missing/invalid setting, revoked allowlist, rollback with stored production data |

For read-only views, never infer that hidden controls are enforcement. For writes, UI confirmation does not make a request authorized. Return sanitized errors and preserve request IDs.

## Backward-compatibility matrix

| Existing consumer or state | Required behavior | Upgrade test |
| --- | --- | --- |
| v1 `PluginModule` without `adminPages` | Continue to load unchanged | Build and invoke an old plugin in new Host |
| Existing `adminViews`/`adminNavigation` | Preserve IDs, link generation, declared route permissions and locale labels | Old view list/navigation still matches |
| Approved iframe assets | Preserve opaque-origin sandbox, Redis ticket, CSP, MessagePort security and revocation | Existing frame loads; permission revocation fails closed |
| Host-rendered scalar data view | Preserve current read-only output and legacy fallback rules | Plugin with no HTML/native descriptor renders as before |
| Old Host receiving new plugin | Optional metadata is ignored only for legacy-compatible behavior; plugins requiring native must declare a compatible minimum Host/ABI and must not silently lose critical functions | Test old Host with native-optional and native-required plugins and mixed-release workers |
| Existing `PluginApiRoute` scalar contract | No silent object/array widening or changed error shapes | Existing route/response-schema tests remain green |
| Stored plugin settings/secrets | No copy between publications, no plaintext leak, no reset on render-mode switch | Populated upgrade; secret masking; site switch |
| LMS course/enrollment/lesson data | Keep current durable formats and publication/member isolation | Reopen existing draft and published courses after UI switch |
| Admin routes and bookmarked URLs | Keep `/admin/extensions/:pluginId/:viewId` where possible | Deep link and browser back/forward behavior |
| Public Web SSR, member APIs and themes | No change required to consume Native Admin UI | Two-theme rendering/SEO/member access regression |
| Self-hosted/multiple replicas | Deterministic approved version, identical admission and graceful rollback | Mixed rollout then pinned rollback/restore |

A backward-compatibility claim is incomplete without **both** a fresh install and a populated upgrade test. Released migrations must not be rewritten. No database migration should be added solely to switch display mode unless there is a reviewed, proven storage requirement.

## Locale, accessibility, and design-system acceptance

- Host locale resolution and well-defined fallback; v1 `en`/`ar` labels remain valid, but the future ABI cannot assume two permanent global languages.
- Arabic RTL, mixed-direction titles, translated long labels, and content IDs displayed with correct direction.
- Accessible page heading and hierarchy, keyboard navigation, visible focus, screen-reader labels, and validation error association.
- Dialog focus trap/return, save success/error announcements, loading/empty/denied states, and unsaved-change protection.
- Mobile, tablet, narrow sidebar, zoom, dark mode, and reduced motion where relevant.
- Consistent Admin Posts-style header and shared components, not copied extension-specific styles.

## Test matrix by increment

| Increment | Primary tests | Evidence required |
| --- | --- | --- |
| NUI-00 | Documentation diff and architecture review | RFC decisions recorded; explicit sign-offs |
| NUI-01 | SDK/contract unit tests, malicious descriptors, legacy ABI | Independent old/new consumer fixtures |
| NUI-02 | Renderer component/E2E, CSP and DOM injection, locale/RTL | Native read-only page without executable plugin code |
| NUI-03 | API/auth/integration, cross-publication, conflicts, duplicate actions | Negative authorization, structured data and concurrency tests |
| NUI-04 | Admin E2E and a11y, settings secrets, navigation | Keyboard/dark/RTL/mobile and permission matrix |
| NUI-05 | LMS API/database/browser parity across two publications | Existing content preserved; create/edit/save/publish parity |
| NUI-06 | Security review, Docker, cross-replica, rollback, restore, performance | Operator evidence and release sign-off |
| NUI-07 | Independent plugin conformance and compatibility suite | Published support policy and version matrix |

The checks to run vary with the affected scope. Appropriate gates include targeted Vitest, API/DB integration, relevant E2E, `pnpm typecheck`, `pnpm lint`, `pnpm verify:explicit-any`, `pnpm vitest run`, `pnpm build`, dependency auditing, image scans and operator restore/rollout drills. Do not claim any gate passed when it has not been executed.

## Rollout / rollback acceptance

1. Operator-enabled Native is initially off and can be activated per reviewed release.
2. Revoke plugin, change publication or role, log out, and remove/stale the release while a page is open: the UI must stop accepting data/mutations.
3. If native metadata is absent, existing frame/data selection works. If it is explicitly invalid or access was revoked, show a denial; do not automatically downgrade to a more privileged implementation.
4. Roll back native rendering without removing plugin content, settings, migrations, enrollments, or artifact admission controls.
5. Confirm replica-consistent release activation before opening the feature to additional publications. Rollback of code does not imply DB rollback.

## Open blockers / sign-off

See the detailed [NUI-00 architecture/security review](native-admin-ui-nui00-review.md) and [threat model](native-admin-ui-threat-model.md) for source inventory, severity-ranked findings, abuse cases, and owner-specific acceptance criteria. Documentation of a control is not evidence that the control is implemented.

- NUI-00 RFC, compatibility negotiation and threat model require explicit architecture/security/API approval.
- Structured resource transport, action admission and server-side mutation authorization are **not implemented**.
- Native component renderer and generic plugin navigation are **not implemented**.
- The LMS migration remains conditional on permission to resume LMS work.
- Cross-publication E2E, populated upgrade/rollback, multi-replica and operator security acceptance have **not been run** for Native UI.

**Decision record:** this is a checklist and proposed gate, not security certification.
