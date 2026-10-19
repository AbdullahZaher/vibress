# Trusted package, integrity, UI and worker integration RFC

**Status:** ACCEPTED DESIGN DIRECTION — operator-pinned artifact, separated Studio/Web routes, versioned UI/worker assets. Exact package encoding/loading is subject to EXT-101/301/302/401 tests. No runtime support today. [ADR](../adr/2026-10-19-external-extension-host-vnext.md).

## Immutable artifact and digest scope

**Important:** placing a SHA-256 of the entire release archive **inside that same archive** creates a circular checksum definition. The illustration `manifest.integrity.digest` in early docs is **not an accepted self-verification scheme**.

Proposed safe design:
1. Build reproducible versioned package `vibress-lms-0.1.0.tar.zst` (or a reviewed equivalent), containing `manifest.json`, compiled server module, schema/migrations, admin/web assets, locale files and immutable asset map. No runtime `npm install`/postinstall.
2. Compute SHA-256 of the **final archive bytes after packaging**. Store digest outside the archive in a separate operator-trusted lockfile or signed release envelope. A detached signature covers canonical release metadata including package ID, version and archive digest; validate against operator-trusted signing keys, expiry/revocation policy and allowlist. Never trust a digest published only by the package itself.
3. At deployment compare expected digest with downloaded/mounted exact bytes; reject mismatches, path traversal, symlinks, unsupported protocol, oversized artifacts, duplicate filenames and writable mutable paths **before unpack/import/evaluation**.
4. Use content-addressed extraction directory, atomic rollout to new immutable version, and immutable artifact ID across API/Web/Worker nodes. Stage migration/health before publication enablement; retain previous compatible artifact as rollback option.
5. Trust remains *operator-reviewed JS* with Node process privileges. Hash/signature provides provenance/integrity, not permission sandbox. Future untrusted plugins require a separate process/container isolation ADR.

### Proposed deployment lockfile (*external to archive*, illustrative)

```json
{
  "schemaVersion": 1,
  "packages": [{
    "id": "vibress-lms",
    "version": "0.1.0",
    "archive": "artifacts/vibress-lms-0.1.0.tar.zst",
    "sha256": "REPLACE_WITH_64_HEX_DIGEST_FROM_RELEASE_PIPELINE",
    "approvedPublisher": "operator-reviewed",
    "hostProtocolMajor": 2
  }]
}
```

**Note:** placeholders make the snippet explanatory; a real validator rejects non-hex/non-64-character values. The plugin-internal manifest must omit self-referential archive checksum, or reference immutable release identity that is authenticated via the external envelope.

## UI / SSR contribution contract (proposed choices; approval required)

| Surface | Artifact | Resolution & security | Disable/version semantics |
| --- | --- | --- | --- |
| Admin navigation | Staff-only registered `viewId`, translation key and permission; **no public href** | Host validates permission and locale, long labels, keyboard focus | Hidden and API disabled atomically |
| Admin view | Reviewed static bundle **or** origin-locked iframe; no arbitrary React internals | CSP, asset integrity, constrained origin, no ambient credentials across origins; host auth API | Asset path carries plugin ID+version+hash; old bundle cache cannot call disabled APIs |
| Public route | Reserved route descriptor; sanitized localized view-model and approved template slot | Next.js host dispatcher + explicit publication/site privacy, canonical/hreflang and theme fallback | Runtime registry resolution by enabled publication+artifact version; never dynamic source file edits |
| Learner/private view | Member-verified SSR/API with per-request entitlement and private cache | No secret lesson data in public hydration/metadata/search or unsafe Liquid context | Disabled immediately denies new SSR/API/media grants |
| Assets | Manifest-declared content-addressed paths | Escaped URLs, content-type allowlist, immutable-cache only for hash paths, restrictive CSP | New release gets new asset URL, old cache harmless |
| Theme slots | Typed sanitized stable view-model schema and fallback default component | Bounded fields, bidi-safe strings, tests with built-in and external Liquid themes | Missing slot does not break existing themes |

**Admin/Web route separation:** Manifest `adminNavigation[].viewId` resolves only to `adminViews[].id` under the **host-computed Studio base path**, not `/extensions/:pluginId/*`. The latter is reserved for public Web route descriptors. Protected Member lesson pages require an explicit Member-authenticated renderer and private cache. Treat forged view IDs, same-name collisions and stale assets as admission/runtime errors.

Do not assume the existing `packages/theme-core/src/route-contract.ts` has extension routes: it currently covers home/posts/pages/tags/authors/collections/portal and theme assets. Approval requires a collision resolver with priority, locale prefixes and canonical rules; first iteration uses reserved `/extensions/:pluginId/*` only. The host must prevent theme/extension JS from reading authenticated member data without a private route.

### Multi-node and self-hosting constraints

- All replicas must pin the same artifact release and protocol during a rollout; route registration from DB alone cannot inject code into unbuilt Next.js workers. Use controlled startup/staged reload/dispatcher strategy.
- Reproduce packaging in Docker build/immutable volumes, reverse-proxy-safe paths and correct CSP/asset base URLs; avoid required proprietary distribution.
- For separately hosted iframe, never forward Staff/Member cookies to arbitrary origins; use short-lived audience-bound host-mediated handshake and same-site constraints only after security review.
- UI rendering does not authorize API calls: each handler independently checks session, publication and policy.

## Async execution and lifecycle contract

- Plugin task registry binds stable fully qualified name, artifact version, payload schema and published event schema; enqueue through host service with authoritative publication and idempotency key.
- Workers consume only when compatible artifact loaded and publication enabled, with migration head satisfied; on disable **stop new admissions**, drain bounded in-flight leases, preserve durable pending work for explicit policy, revoke schedules and prevent future side effects.
- Delivery is at least once; every side-effecting job stores dedup key and durable outcome; out-of-order events have monotonic version/timestamp guard where required.
- `activate` and `deactivate` have explicit call semantics, timeouts, failure record and recovery. A JS Promise timeout does **not** stop CPU-bound execution in a shared process; do not claim process isolation.
- Support host restart: rebuild registry deterministically from trusted installed artifacts and persisted publication enablement, re-register routes/assets/jobs idempotently, and compare package/checksum before processing.

## Explicit release gates

1. Tampered artifact, escaped archive, mismatched signing key, obsolete SDK, missing module, unavailable publisher key are rejected before evaluation.
2. Docker from scratch + upgrade + multi-instance rolling deployment loads identical package and observes consistent version.
3. Admin and Web route collisions, disabled plugin, locale prefix, private-site policy, SSR cache leakage, CSP and asset integrity tested.
4. Worker retry/restart/duplicate delivery, deactivation drain, partial migration, and operator restore tested.
5. Arabic/RTL keyboard UI, external themes, mobile, safe media URLs and accessibility tests green.
6. Publish operator release/provenance format and no false untrusted sandbox promises.

**Decision owner:** Architect + Security + DevOps + Web/Admin/Worker + QA.
