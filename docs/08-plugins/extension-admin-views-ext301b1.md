# EXT-301B1 — Operator-pinned Admin UI asset admission

**Status:** First security foundation for EXT-301B; **not a runnable Admin UI renderer**. The API and browser do not serve or execute these assets in this ticket. This document must not be read as release approval for third-party JavaScript.

## Why this is a separate gate

EXT-301A keeps all Studio views Host-rendered and text-only. Before adding isolated interactive views, an operator must pin the **exact independent UI artifact bytes** outside the plugin-controlled module. A plugin-provided URL or self-declared checksum does not grant admission.

EXT-301B1 extends the **existing trusted-plugin lockfile schema version 1** with optional `adminUiAssets` entries. Old lockfiles and plugins without assets remain valid and behave exactly as before. The extension does not change `PluginModule.adminViews`, HTTP routes, browser permissions, or persistence.

### Example operator-maintained lockfile

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "manifest": {
        "id": "vibress-lms",
        "name": "Vibress LMS",
        "version": "0.1.0",
        "vibressApiVersion": "1.0.0",
        "entrypoint": "dist/plugin.mjs",
        "capabilities": ["admin.navigation", "extension.routes.admin"]
      },
      "sha256": "REPLACE_WITH_SHA256_OF_FINAL_PLUGIN_MJS_BYTES",
      "adminUiAssets": [
        {
          "viewId": "courses",
          "path": "dist/admin/courses.html",
          "sha256": "REPLACE_WITH_SHA256_OF_FINAL_HTML_BYTES"
        }
      ]
    }
  ]
}
```

The two `sha256` placeholders above are explanatory and **will be rejected** until replaced with lowercase/uppercase 64-character hexadecimal digests computed **after** each file has been built. The lockfile is operator-controlled and external to both compiled artifacts. `viewId` must correspond to an independently admitted EXT-301A view, but this metadata alone does not provide an Admin route.

**Packaging for now:** one self-contained UTF-8 `.html` file per approved view, with any reviewed CSS/JS inlined. The exact renderer, script policy, iframe creation and API bridge are intentionally not enabled. Operators distribute identical pinned lockfiles and asset bytes to all API replicas; the system checks the on-disk SHA-256 on every read.

## Current admission checks

- Maximum **8 Admin UI assets per plugin** (and 64 plugins per operator lockfile); duplicates in view IDs or file paths fail the entire lockfile.
- Both `admin.navigation` and `extension.routes.admin` must be declared in the operator-pinned manifest.
- Paths are **relative `.html` files** in the lockfile's directory. Absolute/URL paths, `..`, dot segments, backslashes, and query fragments are rejected.
- Real filesystem paths must stay under the lockfile directory; symbolic-link file targets, escapes, directories, oversized files (over **256 KiB**) and mismatched SHA-256 are rejected.
- Decoding uses strict UTF-8. Invalid byte sequences or NUL characters are rejected.
- `readApprovedAdminUiAsset(plugin, viewId)` accepts a host-resolved installed `Plugin` and verifies it still matches the approved operator manifest.
- The operation is intentionally **internal only**: no new HTTP endpoint, rendered content, cookie exposure, iframe or script execution is added.

The checksum protects asset integrity **at read time**, not plugin process isolation, signature-based publisher authentication, or cross-replica synchronization. Operator-reviewed server-side modules still have Node process privileges, as described in [the trust-model RFC](external-extensions-package-and-ui.md).

## Required next increments: EXT-301B2A and EXT-301B2B

[EXT-301B2A](extension-admin-views-ext301b2.md) adds authorized JSON delivery but **not**
a browser renderer. Items below still require the separately reviewed iframe,
CSP and bridge implementation; the endpoint itself is not proof of isolation.


1. Host-authorize asset resolution **per request** using Staff session, Host-resolved publication, local/global Staff permissions, enabled plugin state, admitted view ID and operator-pinned artifact identity.
2. Deliver only hash/version-addressed assets through an approved serving contract with explicit `Cache-Control` and error handling for stale/disabled instances; verify replica parity on startup/rollouts.
3. Render interactive HTML in a browser **opaque-origin** iframe sandbox with restrictive CSP; never `allow-same-origin` with `allow-scripts`, mount plugin JS in the parent Admin origin, or expose ambient Staff cookies/tokens.
4. Design a strictly typed, capability-filtered, publication-scoped message/API bridge with replay/stale-session protection before any plugin view can read or mutate data. Do not grant raw `fetch` or arbitrary URL navigation.
5. Cover permission denial, disable during active session, artifact tampering, multi-node upgrades, CSP enforcement, keyboard navigation, Arabic/RTL, and dedicated E2E tests before declaring EXT-301 complete.

## Validation

Unit tests exercise legacy lock compatibility, valid Arabic HTML, checksum tampering, invalid manifest capability, duplicate IDs/files, unsafe paths, symlinks, directory escape, oversized files, invalid encoding and symlinked lockfiles. Full CI and a multi-replica staging drill are separate release gates.
