# ADR-017: Plugin Trust Model

**Status:** Accepted
**Date:** Batch 12

## Context

Vibress needs an extensibility foundation. Without a trust decision, plugins
could execute arbitrary code, import private internals, or access key
material. Integrations, webhooks, and API keys are related but distinct
concepts that must stay separate.

## Decision

1. **Plugins are trusted installed code from controlled sources.** The first
   official plugin ships bundled with the API app. No runtime npm install,
   no arbitrary uploaded package execution, no unsigned/unknown remote code.
   A future marketplace/sandbox is out of scope.

2. **The plugin SDK is the only boundary.** Plugins import only
   `@vibress/plugin-sdk`. Database schema, private repositories, admin
   internals, and security key material are never importable from plugins.
   Hooks are stable domain-facing interfaces (`activate`, `deactivate`,
   `onEvent`) invoked by the trusted host — no monkey-patching of private
   runtime objects.

3. **Manifests are validated before any state changes.** `vibressApiVersion`
   must match the SDK version; capabilities must be from the supported set.
   Invalid manifests are rejected with `INVALID_MANIFEST`.

4. **Capabilities are explicit and minimal.** `events.subscribe`,
   `webhooks.register`, `storage.provider`, `content.read`,
   `admin.navigation`, `settings.read-own`, `settings.write-own`. There is no
   broad all-access capability for ordinary plugins.

5. **Settings and secrets are declarative and protected.** Secret values are
   encrypted at rest, masked on read, never logged, and replace-only on
   update, using `@vibress/security` secret encryption.

6. **Integrations, API keys, webhooks, and plugins remain separate
   concepts.** An integration is an external-service connection; an API key
   is a machine credential (hash-stored, scope-enforced); a webhook is an
   event-delivery mechanism (SSRF-hardened, HMAC-signed); a plugin is a
   trusted code extension.

## Consequences

- Failure isolation: activation errors surface as plugin `error` state, never
  crashing core functionality.
- Outbound webhook delivery uses the centralized hardened HTTP client with
  DNS-rebinding protection, redirect rejection for POST, timeouts, and size
  bounds.
- Machine credentials are independent of Staff/Member identity with generic
  invalid-credential responses and exact scope enforcement.
