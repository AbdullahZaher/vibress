# Vibress Plugin SDK Guide

## Overview
The `@vibress/plugin-sdk` package defines the exclusive, stable API surface available to third-party extensions. Plugins run inside isolated child process sandboxes and are restricted to explicitly declared capabilities.

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

## 2. Supported Capabilities

| Capability | Description |
| :--- | :--- |
| `events.subscribe` | Listen to asynchronous platform domain events |
| `webhooks.register` | Programmatically register outbound webhooks |
| `storage.provider` | Implement a custom binary asset storage driver |
| `content.read` | Read-only access to published public posts, pages, and collections |
| `admin.navigation` | Inject custom menu items into the Admin sidebar |
| `settings.read-own` | Access plugin-scoped configuration parameters |
| `settings.write-own` | Update plugin-scoped configuration parameters |

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
