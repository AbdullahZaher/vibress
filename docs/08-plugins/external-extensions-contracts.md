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
  "integrity": { "algorithm": "sha256", "digest": "<RELEASE_ARTIFACT_DIGEST>" },
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

**Illustration only:** release metadata schema, capability names and host API negotiation require formal approval. Digest is over a reproducible immutable release artifact (not a mutable file path). Additional detached signing and publisher provenance are recommended for remote distribution.

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
  data: { transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> };
  jobs: { enqueue(name: string, payload: unknown, idempotencyKey: string): Promise<void> };
  log: { info(message: string, fields?: Record<string, string>): void };
};
```

All real contracts should expose **typed, narrowed services**, not raw DB transactions or `unknown` in the final implementation. `tx` above is a placeholder pending API design. Reject dangerous coercions, raw SQL and arbitrarily supplied publication-scoped context.

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
- CORS/CSRF, auth cookies, caching and entitlement checks are **host-side**, not opt-in extension conventions.
- Admin navigation registration is not authentication: every route enforces authorization independently.

## 4. Settings and data

- Distinguish `plugin_installation` (platform artifact), `plugin_publication_state`, `plugin_publication_settings` and versioned `plugin_schema_migrations`. Preserve and migrate existing `plugins`/`plugin_settings` and old status semantics.
- Settings are keyed by plugin + publication, typed against manifest schema, secrets encrypted with key rotation support and never returned in clear. Platform-global settings require explicit high-privilege capability.
- Data ownership: namespaced plugin tables with scoped composite keys and host-mediated typed repositories. Foreign cross-schema refs to members may be permitted only via reviewed migration and correct publication invariant; never create orphan member links. Migrations are additive, resumable, idempotent and do not modify prior released scripts.
- Disabling preserves settings and data by default. Purge is a separate authenticated, confirmed, audited operation.
- Source of truth for Member identity, payments and subscriptions stays in Vibress core; plugin stores only its own enrollment and course authorization facts.

## 5. UI / theme / jobs / events

- Admin UI: declarative nav + approved view registration (signed static bundles or origin-locked iframe, CSP, no arbitrary HTML), permission keyed and accessible.
- Web: sanitized localized view models, theme-safe optional slots, accessible default page, SEO metadata and preview policies; no raw server internals in Liquid context.
- Workers: job namespace `extension.vibress-lms.*`; scoped payload, retry with idempotency key, dead-letter visibility, disable/drain semantics. No implicit at-most-once claims.
- Events: named, versioned payload schemas; publish only safe fields, stable event IDs/occurredAt; consumers handle duplicate and out-of-order deliveries. Explicit subscription list, audited capability.
- Logging: request correlation, pluginId, publicationId, eventId; scrub PII/secrets/tokens; metrics with bounded labels.

## 6. Contract tests and versioning

1. Ship host SDK consumer fixtures in a separate example package; compile/runtime-contract-test every published host major.
2. Verify two-publication isolation, each principal type, capability denial, CSRF/XSS/SSRF, data versioning, localization/RTL and disabled/no-handler behavior.
3. Test upgrade from legacy bundled rows; old plugins continue to activate through compatibility adapter.
4. Run pilot against **released** Vibress images and independently built LMS artifact.
5. Publish a compatibility matrix (Vibress core version × host API version × LMS version × database migration head), plus a clear deprecation period before removing a public extension API.

No sample code in this RFC is an instruction to bypass existing `@vibress/plugin-sdk` limitations.
