# External extensions: contract proposals (not an SDK reference)

**Status: DRAFT RFC, no implementation shipped.** Names, JSON and URLs below are proposed design targets. Do not import or call them today. Existing `@vibress/plugin-sdk` `SDK_VERSION` is `1.0.0` in source and exact-match validation is current behavior. Package.json version does not replace SDK protocol compatibility.

## 1. Artifact + deployment manifest (illustrative vNext)

```json
{
  "id": "vibress-lms",
  "name": "Vibress LMS",
  "version": "0.1.0",
  "hostApi": { "major": 2, "minMinor": 0 },
  "entrypoint": "dist/server/index.js",
  "artifactRef": "vibress-lms@0.1.0",
  "capabilities": [
    "extension.routes.admin",
    "extension.routes.member",
    "extension.routes.public",
    "extension.data.own",
    "members.read-scoped",
    "extension.jobs"
  ],
  "permissions": ["lms.course.read", "lms.course.manage"],
  "contributions": {
    "adminNavigation": [{"id":"courses","titleKey":"lms.nav.courses","path":"/extensions/vibress-lms/courses"}],
    "publicRoutes": [{"path":"/extensions/vibress-lms/courses/*","localeAware":true}]
  },
  "migrations": { "namespace": "vibress_lms", "head": "0001" }
}
```

**Illustration only:** release metadata schema, capability names and host API negotiation require formal approval. `artifactRef` is an identity resolved **only from an operator-trusted external lockfile or detached signed envelope**, whose SHA-256 covers the *final archive bytes*. The archive must not claim its own archive digest from inside itself (circular checksum). See [package and UI RFC](external-extensions-package-and-ui.md).

### Manifest validation requirements

- Strict IDs (bounded lowercase kebab case), semver, normalized relative entrypoints/no symlinks/out-of-root paths, declared size and asset limits; fail on unknown fields or unsafe capability requests.
- Integrity check *before* module loading, pinned dependency tree, admission against operator allowlist; no unsigned runtime installation from Admin.
- Required feature detection and explicit incompatibility error; new optional fields additive, incompatibility across majors blocks enablement.
- Separate package version, host API version, schema migration version and public API version.

## 2. Host-created context (illustrative TypeScript, not exported yet)

```ts
type ExtensionScope = {
  publicationId: string; // authoritative; unavailable for global-only actions
  principal: { kind: "staff" | "member" | "machine" | "anonymous"; id?: string };
  locale: string;
  direction: "ltr" | "rtl";
  requestId: string;
};
type ExtensionServices = {
  hasPermission(permission: string): Promise<boolean>;
  members: { getScopedMember(id: string): Promise<unknown | null> };
  entitlements: { hasActiveAccess(input: { memberId: string; productId: string }): Promise<boolean> };
  // Data access is intentionally not declared: approve typed, scoped
  // repository operations before publishing a callable API.
  jobs: { enqueue(name: string, payload: unknown, idempotencyKey: string): Promise<void> };
  log: { info(message: string, fields?: Record<string, string>): void };
};
```

**No callable data API is specified by this snippet.** It intentionally omits a storage method until reviewed typed repository operations are available. The approved design must expose registered, capability-checked **typed publication-scoped repository operations**, not a raw SQL or Drizzle transaction. See [identity/data RFC](external-extensions-identity-data.md). Reject dangerous coercions, raw SQL and arbitrarily supplied publication-scoped context.

## 3. Route namespaces / policy

Host owns the router; extensions register **declarative handlers with schema and policy**, never receive a raw Fastify instance:

| Audience | Proposed prefix | Host-enforced policy |
| --- | --- | --- |
| Admin | `/api/admin/v1/extensions/:pluginId/v1/*` | Staff session, `requirePermission`, origin validation on mutation, publication resolution |
| Member | `/api/members/v1/extensions/:pluginId/v1/*` | Member session, anti-CSRF/origin on mutation, publication resolution |
| Public | `/api/content/v1/extensions/:pluginId/v1/*` | Publication resolution, safe-field projection, rate limits |
| Pages | `/extensions/:pluginId/*` | Locale/SEO/canonical resolution and theme fallback |

- Validate all external input with shared runtime contracts; stable errors `{ "errors": [{ "code", "message", "requestId" }] }`.
- Conflict-free route registry rejects collisions, unapproved verbs, unbounded payloads, missing schema, namespace escape and duplicate IDs at install time.
- Public/non-staff return 404 for unpublished/paid content instead of leaking existence or internal metadata.
- CORS/CSRF, auth cookies, caching and entitlement checks are **host-side**, not opt-in extension conventions. `requireMemberSession` alone is insufficient for publication isolation: the host MUST match the returned Member's `publicationId` to resolved site/publication context. Global public-content privacy middleware does not automatically cover new route prefixes; host must apply equivalent site privacy guards.
- Admin navigation registration is not authentication: every route enforces authorization independently.

## 4. Settings and data

- Distinguish `plugin_installation` (platform artifact), `plugin_publication_state`, `plugin_publication_settings` and versioned `plugin_schema_migrations`. Preserve global legacy state with an explicit v1 adapter: **no blind copying settings/secrets** and **no auto-enabling all publications**. Preserve and migrate existing `plugins`/`plugin_settings` and old status semantics.
- Settings are keyed by plugin + publication, typed against manifest schema, secrets encrypted with key rotation support and never returned in clear. Platform-global settings require explicit high-privilege capability.
- Data ownership: namespaced plugin tables with scoped composite keys and host-mediated typed repositories. Foreign cross-schema refs to members may be permitted only via reviewed migration and correct publication invariant; never create orphan member links. Migrations are additive, resumable, idempotent and do not modify prior released scripts.
- Disabling preserves settings and data by default. Purge is a separate authenticated, confirmed, audited operation.
- Source of truth for Member identity, payments and subscriptions stays in Vibress core; plugin stores only its own enrollment and course authorization facts.

## 5. UI / theme / jobs / events

- Admin UI: declarative nav + pinned content-addressed signed static bundle or origin-locked iframe, CSP, validated asset map and no arbitrary HTML. Route/asset versions and disabled behavior must work across Admin/API/Web/Worker replicas; see [package and UI RFC](external-extensions-package-and-ui.md).
- Web: sanitized localized view models, theme-safe optional slots, accessible default page, SEO metadata and preview policies; no raw server internals in Liquid context.
- Workers: job namespace `extension.vibress-lms.*`; scoped payload, retry with idempotency key, dead-letter visibility, disable/drain semantics. No implicit at-most-once claims.
- Events: named, versioned payload schemas; publish only safe fields, stable event IDs/occurredAt; consumers handle duplicate and out-of-order deliveries. Explicit subscription list, audited capability.
- Logging: request correlation, pluginId, publicationId, eventId; scrub PII/secrets/tokens; metrics with bounded labels.

## 6. Contract gaps that block implementation

- The current API host uses `@vibress/plugin-sdk`; `packages/plugin-core` separately declares `VibressPlugin`. The adapter and event/deactivate differences are described in [SDK compatibility](external-extensions-sdk-compatibility.md).
- The final packaged artifact digest must be stored outside the artifact; a field inside a self-hashed archive is not proof of integrity.
- Member publication binding, trusted scope provenance, member/core table FK limitations, non-sandboxed host storage, and migration of old global settings are specified in [identity and data](external-extensions-identity-data.md).
- Locale-aware public routes and theme slots require a real Next.js dispatcher and a stable asset/CSP scheme, not just manifest route declarations. See [package and UI](external-extensions-package-and-ui.md).
- Public extension route v1 prefixes are drafts. No registered route, SDK method or capability in this RFC is callable until implemented and versioned.

## 7. Contract tests and versioning

1. Ship host SDK consumer fixtures in a separate example package; compile/runtime-contract-test every published host major.
2. Verify two-publication isolation, each principal type, capability denial, CSRF/XSS/SSRF, data versioning, localization/RTL and disabled/no-handler behavior.
3. Test upgrade from legacy bundled rows; old plugins continue to activate through compatibility adapter.
4. Run pilot against **released** Vibress images and independently built LMS artifact.
5. Publish a compatibility matrix (Vibress core version × host API version × LMS version × database migration head), plus a clear deprecation period before removing a public extension API.

No sample code in this RFC is an instruction to bypass existing `@vibress/plugin-sdk` limitations.
