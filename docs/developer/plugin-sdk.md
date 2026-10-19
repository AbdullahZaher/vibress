# Vibress Plugin SDK Guide

## Overview
The `@vibress/plugin-sdk` package defines the exclusive, stable API surface available to Vibress plugins. In Vibress v1.0, plugins execute within a **Trusted Host In-Process Runtime** (`BundledPluginHost`), restricted strictly to explicitly declared capabilities, multi-tenant `PublicationContext` boundaries, and isolated secret management.

> [!NOTE]
> **Trust Boundary Notice:** Dynamic untrusted third-party code uploads are disabled in v1.0. Arbitrary untrusted code execution via Node `vm.createContext()` is deprecated. Third-party isolated sandboxing via WebAssembly is slated for Phase 2.

---

## 1. Manifest Definition (`plugin.json`)

Every plugin must define a `plugin.json` manifest:

```json
{
  "id": "acme-analytics",
  "name": "Acme Realtime Analytics",
  "version": "1.0.0",
  "vibressApiVersion": "1.0.0",
  "description": "Stream analytics events to Acme data platform",
  "entrypoint": "dist/index.js",
  "capabilities": [
    "events.subscribe",
    "settings.read-own",
    "settings.write-own"
  ],
  "settingsSchema": {
    "type": "object",
    "properties": {
      "apiKey": { "type": "string", "title": "Acme API Key" },
      "endpoint": { "type": "string", "title": "Custom Ingestion URL" }
    },
    "required": ["apiKey"]
  },
  "hooks": [
    "post.published",
    "member.created"
  ],
  "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

---

## 2. Supported Capabilities & Registry

| Capability | Scope | Risk | Description |
| :--- | :--- | :--- | :--- |
| `content.read` | Publication | Low | Read published and draft posts, pages, and tags within publication |
| `content.write` | Publication | Medium | Create or update posts and pages within publication |
| `posts.read` | Publication | Low | Read posts for metrics, SEO, or transformation within publication |
| `media.read` | Publication | Low | Read media asset metadata and URLs within publication |
| `media.write` | Publication | Medium | Upload and process media assets within publication |
| `publication.read` | Publication | Low | Read publication settings and profile |
| `publication.write` | Publication | High | Modify publication configuration |
| `settings.read` | Publication | Low | Read general publication settings |
| `settings.read-own` | Publication | Low | Access plugin-scoped configuration parameters |
| `settings.write-own` | Publication | Low | Update plugin-scoped configuration parameters |
| `email.send` | Publication | High | Send transactional or newsletter emails |
| `webhook.emit` | Publication | Medium | Trigger outbound webhooks for publication events |
| `webhooks.register` | Publication | Medium | Programmatically register outbound webhooks |
| `analytics.read` | Publication | Low | Read aggregated traffic and post metrics |
| `events.subscribe` | Platform | Low | Listen to asynchronous platform domain events |
| `events.read` | Platform | Low | Receive event payloads for analytics and monitoring |
| `storage.provider` | Platform | Critical | Implement custom binary asset storage driver |
| `admin.navigation` | Platform | Low | Inject custom menu items into the Admin sidebar |

---

## 3. Plugin Implementation (`src/index.ts`)

```typescript
import { PluginModule, PluginContext } from "@vibress/plugin-sdk";

export default class AcmeAnalyticsPlugin implements PluginModule {
  async activate(context: PluginContext): Promise<void> {
    context.log("Acme Analytics plugin activated successfully", "info");

    const apiKey = await context.getSecret("apiKey");
    if (!apiKey) {
      context.log("No API key configured — plugin in dormant mode", "warn");
    }
  }

  async onEvent(eventName: string, payload: unknown): Promise<void> {
    if (eventName === "post.published") {
      // Forward event to third-party endpoint
    }
  }

  async deactivate(): Promise<void> {
    // Graceful teardown
  }
}
```

---

## 4. Trust boundary and optional operator-installed ESM modules

The original host is **trusted, in-process Node.js code**; it is **not** a child-process sandbox. There is no guaranteed CPU, memory, or crash isolation. `executeWithTimeout` only races asynchronous work and cannot stop a synchronous infinite loop.

The operator may set `VIBRESS_TRUSTED_PLUGIN_LOCKFILE` to an **absolute path** of an operator-maintained JSON lockfile; when unset, only bundled official modules can activate. A lockfile entry is a fully validated v1 `manifest` plus a SHA-256 of its single compiled ESM `.mjs` file. Store this lockfile separately from the compiled file; add no self-referential hash to the module. Example:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "manifest": {
        "id": "my-trusted-plugin",
        "name": "My Trusted Plugin",
        "version": "1.0.0",
        "vibressApiVersion": "1.0.0",
        "entrypoint": "dist/index.mjs",
        "capabilities": ["events.subscribe"],
        "hooks": ["onEvent"]
      },
      "sha256": "REPLACE_WITH_64_HEX_SHA256_OF_COMPILED_ENTRYPOINT"
    }
  ]
}
```

The runtime verifies the bytes against this **operator-trusted pinned checksum** and evaluates **exactly those verified bytes** (avoiding checksum-to-import file replacement). Build a self-contained single-file ESM bundle with all non-builtin runtime dependencies included; relative module imports from the verified data URL are unsupported. Replace the placeholder with the actual 64-character lowercase hex value. Builtin Node.js APIs still have full process privileges: this initial loader **does not isolate the program**, validate a multi-file release artifact, distribute packages, register generic Admin/Web/Member routes or run worker jobs. It **does** support publication-scoped activation and publication-scoped string settings/secrets through approved Staff APIs. See [implementation status](../08-plugins/external-extensions-implementation-status.md) for gaps. Only load packages audited and controlled by the operator. Full independent extension contracts remain tracked by [the approved RFC](../08-plugins/EXTENSION_RFC_APPROVAL.md).

The package `@vibress/plugin-sdk` is the supported runtime ABI. Do not use the alternate `plugin-core.VibressPlugin` lifecycle class with this host. The bundled v1 API remains compatible; named event dispatch is exposed in the PluginsService domain as `dispatchEvent` for host-owned callers.

## 5. Operator deployment and publication setup (experimental)

See [the optional Docker Compose override](../../compose.extensions.example.yml). Prepare a read-only mount with `trusted.json` and the approved single-file `dist/index.mjs` bundle under the **same** host directory. Compute the pinned checksum from final built bytes:

```bash
sha256sum ./extensions/trusted/dist/index.mjs
```

Use the resulting 64-character hash in `trusted.json`. The approved lockfile belongs to the operator and **must not** be modifiable via the Admin UI or an extension runtime. Direct API `POST /plugins/register` refuses external manifests not matching an approved lockfile. Deploy the same read-only bytes across every API replica.

Once running, a Staff user with `plugins.manage` permission may discover and register an operator-approved plugin using **Plugins → Register trusted plugin**, activate it globally, and then **Enable for this publication**. Staff authentication, publication membership, and Origin validation are required on writes. An absent publication activation record is always disabled. Existing official bundled v1 plugins retain their legacy global behavior.

For a publication-enabled external plugin, `GET/PATCH /api/admin/v1/plugins/:id/publication-settings` reads/writes **declared string settings only**. Secret values are encrypted at rest, masked in reads, and blank or null secret updates are replace-only. Values are never copied from legacy global settings. `PluginModule.onEvent(name, payload, context?)` receives an optional context with this publication's settings/secret getter when invoked through an authorized host event path. Existing two-argument v1 handlers still work.

Only **global platform owner/administrator** Staff sessions with both `system.manage` and `plugins.manage` may register, activate, deactivate or uninstall packages across sites. A Staff user with local `plugins.manage` alone can only enable/disable approved plugins inside their accessible publication. Active plugin re-registration cannot change pinned metadata. Previously declared setting keys cannot change type/secret semantics without a reviewed data migration; reads fail closed and mask a secret if either stored data or the current manifest classifies it as a secret.

Plugin activation uses a conditional DB claim; repeated active activation does not rerun `activate`. On a new API process, event dispatch performs one lazy local initialization. This is **not** a distributed worker/lifecycle coordinator: resident timers or listeners in another process may remain until that process is restarted, and a process crash mid-transition requires controlled operator recovery. Operators must deploy trusted self-contained, idempotent event handlers without persistent background tasks until process isolation and coordinated workers exist.

The current system **does not** provide a generic extension endpoint, public page route, registered Studio custom view, safe arbitrary code sandbox, full package manager, runtime Worker queue resolver, cross-node drain guarantee, or trusted source attestation of multiple dependency files. Do not offer these as shipped extension capabilities.
