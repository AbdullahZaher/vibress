# Plugin SDK

## Boundary

`@vibress/plugin-sdk` is the **only** surface plugins may import.

Plugins must never import:

- Drizzle schema (`@vibress/database`)
- Database internals or private repositories
- Admin internals
- Security key material (raw encryption keys, token secrets)
- Private domain internals

The SDK exposes: `PluginManifest`, `PluginContext`, `PluginModule`,
`validateManifest`, `SDK_VERSION`, `SUPPORTED_CAPABILITIES`.

## Context API

```ts
interface PluginContext {
  manifestId: string;
  name: string;
  version: string;
  settings: Record<string, unknown>; // plain (non-secret) settings
  getSecret(key: string): Promise<string | null>; // decrypted secret
  log(message: string, level?: "info" | "warn" | "error"): void;
}

interface PluginModule {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  onEvent?(eventName: string, payload: unknown): void | Promise<void>;
}
```

## Hooks

Approved hooks are stable, domain-facing interfaces (`onEvent`, `activate`,
`deactivate`). Plugins cannot monkey-patch private runtime objects; hooks are
invoked by the trusted host against the SDK-defined surface.

## Official Example Plugin

`apps/api/src/plugins/official/example-plugin.ts` —
"vibress-content-metrics" (Content Metrics Logger).

It proves the real boundaries:

- imports **only** `@vibress/plugin-sdk`
- declares capabilities + settings schema in its manifest
- reads its own settings and secrets through `PluginContext`
- does not bypass the SDK

Registered and activated through the standard admin plugin lifecycle.
