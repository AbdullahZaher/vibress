# Plugin System

## Trust Model

V1 plugins are **trusted installed code from controlled sources**:

- Bundled, versioned packages shipped with Vibress (the official example
  plugin ships in the API app).
- No runtime npm install from Admin.
- No arbitrary uploaded package execution.
- No loading of unsigned/unknown remote code.

A future marketplace/sandbox is explicitly out of scope.

## Manifest

Versioned manifest validated before any state is written:

| Field               | Notes                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `id`                | Stable identifier, lowercase alphanumeric + hyphens                                        |
| `name` / `version`  | Display + semver                                                                           |
| `vibressApiVersion` | Must equal the SDK version (`@vibress/plugin-sdk`); incompatible versions are **rejected** |
| `entrypoint`        | Module entry within the plugin package                                                     |
| `capabilities`      | Explicit capability list — unknown capabilities are **rejected**                           |
| `settingsSchema`    | Declarative settings (incl. `secret: true` flags)                                          |
| `hooks`             | Approved hook names                                                                        |

Supported capabilities (v1): `events.subscribe`, `webhooks.register`,
`storage.provider`, `content.read`, `admin.navigation`,
`settings.read-own`, `settings.write-own`. There is **no** all-access
capability for ordinary plugins.

## Lifecycle

`registered → active → inactive` with `error` as a visible terminal state on
activation failure.

- Register (validate manifest, upsert metadata)
- Activate (load module via trusted host, run `activate()`, mark active)
- Deactivate
- Update metadata (re-register)
- Unregister (delete)

**Failure isolation:** an activation failure marks the plugin `error` and
throws a domain error — it never crashes or degrades unrelated core
functionality.

## Settings / Secrets

- Declarative schema; non-secret values stored plainly.
- Secret values: encrypted at rest, masked on read, never logged,
  replace-only on update (empty values keep the existing encrypted secret).
- Plugins read their own settings and secrets through `PluginContext`
  (`settings` for plain values, `getSecret(key)` for decrypted secrets).

## Admin

- `plugins.read` — list plugins, view settings (masked).
- `plugins.manage` — register, activate, deactivate, set settings, unregister.
- 401/403 verified.
