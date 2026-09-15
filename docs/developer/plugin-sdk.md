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

## 4. Sandbox Isolation & Resource Limits

Plugins execute in child process sandboxes with strict CPU, memory, and timeout constraints:
- **Maximum Execution Timeout**: 5,000ms per invocation.
- **Maximum Heap Allocation**: 128MB.
- **Package Integrity**: All plugin archives must match their declared SHA-256 checksum upon installation.
