# Plugin SDK / Native Admin V1 — Compatibility and Version Policy

**Status:** Experimental, additive SDK-NUI-01 contract baseline on PR #89. This policy is not a public SDK release, a new negotiation endpoint, an operator approval, or a Tier 2 isolation certification.  
**Source of truth:** The runtime Host schemas in `packages/api-contracts/src/extension-native-admin.ts` and `extension-native-workflow.ts`, Host admission code, and `@vibress/plugin-sdk` public exports. The Host checks runtime bytes and permissions independently; this document never overrides its implementation.  
**Verification:** [Native Admin SDK conformance](native-admin-ui-sdk-conformance.md) and [external SDK release gates](external-sdk-release-gates.md).

## Current compatibility identities (do not conflate)

| Independent identity | Current value / location | Meaning and enforcement |
| --- | --- | --- |
| SDK npm package version | `@vibress/plugin-sdk@1.2.0`, `private: true` | Distribution/dependency label; **not** proof of a published supported package, ABI, Host capability or release approval |
| Host/plugin route ABI | `SDK_VERSION = "1.0.0"` and `PluginManifest.vibressApiVersion` | `validateManifest` requires exact equality; `"1.2.0"`, `"2.0.0"` and unknown versions must be rejected, even when package semver appears compatible |
| Native page wire schema | `NATIVE_ADMIN_PAGE_SCHEMA_VERSION = 1` and `adminPages[].schemaVersion` | Public SDK constant matches Host `ExtensionNativeAdminPageV1Schema`; unknown versions, unknown component tags, executable metadata and malformed definitions are invalid |
| Native domain workflow schema | `NATIVE_DOMAIN_WORKFLOW_SCHEMA_VERSION = 1` and `adminDomainWorkflows[].schemaVersion` | Independent Host `ExtensionNativeDomainWorkflowV1Schema` verifies the exact V1 shape and its linked approved routes/resources |
| Other Native resource/action metadata | Existing V1 unversioned field types, guarded by Host validators | Do **not** invent a `schemaVersion` field or claim that `NATIVE_ADMIN_PAGE_SCHEMA_VERSION` covers these separate contracts |
| Plugin identity | `manifest.id`, `manifest.version`, immutable entrypoint SHA-256, approved lockfile/signature | Operator-approved release identity; package or schema version matching does not authorize execution |
| Native rollout authority | `VIBRESS_NATIVE_ADMIN_UI_RELEASES`, `VIBRESS_NATIVE_ADMIN_ACTION_RELEASES` | Separate default-off exact-release allowlists for reads and writes; no plugin declaration or SDK helper may enable them |

The two exported Native V1 constants are **authoring metadata**, not a Host capability-discovery handshake. SDK-NUI-02's `definePluginModule` and `defineNative*V1` helpers return declarations unchanged; they do not validate incoming data, authorize a request or certify that a particular deployment supports Native rendering.

## Current admission rules and failure semantics

- An existing V1 manifest with `vibressApiVersion: "1.0.0"` and no optional Native fields remains valid; `adminViews`, isolated iframe and Host scalar routes retain their existing behavior subject to their own permissions.
- Optional Native declarations are parsed and linked to previously admitted Admin GET routes. No Native fields means `absent`; unknown/invalid V1 descriptors mean `invalid`. Invalid descriptors must not become an executable or privileged fallback.
- A requested Host without Native capability cannot be assumed to support these fields merely because its SDK package dependency is newer. **V1 has no negotiated minimum Native Host-version manifest field.** A plugin **requiring** Native functionality must be held by the operator's deployment compatibility preflight on older Hosts; do not infer runtime support from a TypeScript constant.
- For a future incompatible Native V2, introduce a separately reviewed discriminated runtime schema, explicit feature/version negotiation and minimum-Host policy before admitting any required feature. Preserve the V1 parser and legacy behaviors during a documented support window. Never silently reinterpret V2 as V1 or relax Zod validation.
- Admission and authorization are independent. On every Host request, require authenticated Staff, authoritative publication, current role/permission, plugin state, exact approved release digest, capability, linked route, model/record ownership and write Origin/CSRF where applicable. Revoke caches and stale cursors after publication/release/session changes.
- Tier 1 operator-approved ESM remains process-privileged. Signatures, npm semver, Host-rendered Native UI and these constants **do not** sandbox Node code. No marketplace or arbitrary install-to-execute is approved.

## V1 Host / Plugin compatibility matrix

| Scenario | Required behavior | Existing verification |
| --- | --- | --- |
| Current Host + existing plugin without Native | Valid route ABI and legacy view; Native contribution `absent` | `native-admin-independent-consumer.test.ts`, packaged consumer conformance |
| Current Host + valid V1 Native plugin | Validated and linked V1 declaration; rendering only after separate release/caller authorization | `native-admin-registry.test.ts`, independent packaged consumer and Native E2E |
| Current Host + unsupported page/workflow version | Reject via Host runtime schema; no reinterpretation, no accidental mutation privileges | V1 page and workflow negative cases in independent consumer conformance |
| Current SDK + manifest declaring package semver as ABI | Reject exact ABI mismatch | Independent SDK consumer tests, `validateManifest` |
| Older Host + plugin *requiring* new Native widgets | Operator deployment compatibility gate blocks unsupported release; **not automatically negotiated by shipped V1 Host** | **Future cross-version Host-image conformance / preflight required** |
| Merged code + operator has not enabled exact Native release | Default-off Native reads/writes; legacy paths only under existing permissions | Existing Host allowlist/permission acceptance; operator rollout still unapproved |
| Mixed API/Worker releases, revoked signer/digest or wrong publication | Fail closed; no stale job/receipt/cursor may bypass the authoritative Host decision | Signed fleet/restore drills and Native multi-process tests; production fleet sign-off outstanding |

## Change control and publication

1. Keep all currently accepted V1 wire shapes and `SDK_VERSION` unchanged for additive SDK helpers, translations, tests and documentation. Do not silently broaden any wire shape or Host privileges under the same version.
2. A breaking route ABI requires a separately versioned Host/SDK release, old consumer inventory, supported adapter or deprecation window and exact-version integration tests.
3. A breaking Native schema requires new Host runtime validators and a deliberately negotiated opt-in, including downgrade-denial and old-plugin/new-Host tests. The Node-side API and packaged TypeScript declarations must match the actual Host schemas.
4. Before publishing a stable package, prove a clean `pnpm pack`/independent install, no private imports, strict TypeScript, runtime exports, exact ABI mismatch and unsupported Native version rejection, signed artifact admission, fresh/upgrade DB, Arabic/RTL and accessibility, multi-replica release revocation, backup/restore and documented support ownership.
5. Keep `private: true`, existing release allowlists and Draft PR status until an explicitly approved separate stable release. No external registry publication or production activation is implied by this ticket.

**Limits:** This repository fixture validates **current Host + independent packaged plugin**, not actual old Host binaries, multiple deployed SDK versions, production operator sign-off or Tier 2 isolation. Retain those limitations in acceptance reports.
