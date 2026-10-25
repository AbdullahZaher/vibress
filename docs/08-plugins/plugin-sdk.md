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
  publicationId?: string | undefined; // Authoritative PublicationContext
  settings: Record<string, unknown>; // plain (non-secret) settings
  getSecret(key: string): Promise<string | null>; // decrypted secret
  log(message: string, level?: "info" | "warn" | "error"): void;
  hasCapability?(capability: string): boolean;
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

## Experimental Native Admin UI (NUI-01; not active)

The [Native Admin UI RFC](native-admin-ui-rfc.md) and [NUI-00 decision record](native-admin-ui-decisions.md) describe an **experimental** `PluginModule.adminPages?` read-only descriptor type and `@vibress/api-contracts` syntax validator. The first descriptor schema version only describes `stat` and `field-list` scalar projections linked, in a future Host admission step, to existing `adminViews` GET route declarations.

**There is no registered Host admission endpoint, API route, renderer, action execution or plugin UI capability for this new metadata.** Existing plugins must continue using their supported `adminViews` and optional isolated iframe paths. Type declarations and syntactic validation are not authorization. Do not advertise `adminPages` as a supported integration contract, or depend on its fields for production behavior, until NUI-00 approval, Host bindings, tests and external SDK release gates are complete.

The public SDK protocol constant remains `SDK_VERSION = "1.0.0"`; the package's version is not an independent guarantee that an experimental Native UI protocol is supported by deployed Hosts.
