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

## Lifecycle & Multi-Replica Coordination

Status progression: `registered → activating → active → deactivating → inactive`, with `error` as a terminal or failure state.

- **Atomic CAS Transitions:** Transitions between states (`registered/inactive/error → activating → active`, `active → deactivating → inactive`) use optimistic database-level conditional updates (`tryTransitionStatus`). Competing replicas or concurrent activation calls receive `PLUGIN_TRANSITION_IN_PROGRESS` or idempotently return the target state without double-activation.
- **Replica Initialization:** When an active plugin receives events on a new replica or worker process, it is locally initialized before the first event and tracked in memory (`initializedHere`).
- **Graceful Shutdown:** On server termination (`app.close()` / `SIGTERM`), Fastify's `onClose` hook triggers `PluginsService.shutdown()`, which cleanly executes `module.deactivate()` on all locally active plugin instances.
- **Stuck State Failure Recovery:** If a replica crashes while a plugin is in a transitional status (`activating` or `deactivating`), platform operators can recover the plugin via `POST /api/admin/v1/plugins/:id/recover`:
  - `activating` transitions safely to `error`
  - `deactivating` transitions safely to `inactive`
  - Emits `plugin.recovered` domain event for observability and audit logging.

## Multi-Tenant Publication Isolation (Migrations 0040 & 0041)

- External extensions are scoped per publication via `plugin_publication_states` (disabled by default, `REFERENCES plugins(id) ON DELETE RESTRICT`).
- Plugins cannot be uninstalled while publication state associations exist (`PLUGIN_HAS_PUBLICATIONS`).
- Publication settings and secrets are partitioned in `plugin_publication_settings` with composite foreign keys cascading on publication removal (`ON DELETE CASCADE`).
- Secret check constraints enforce at the database layer that secrets cannot contain plaintext and non-secrets cannot contain ciphertext.

## Authorization & Operator Gate

- **Platform Operator Gate:** Global lifecycle operations (`/register`, `/activate`, `/deactivate`, `/recover`) require platform operator authorization (`isPlatformPluginOperator`), requiring global `owner` or `administrator` role with both `plugins.manage` and `system.manage` permissions. Publication-scoped editors or tenant staff are strictly denied (403 `PLATFORM_OPERATOR_REQUIRED`).
- **Publication Enablement:** Per-publication enablement (`PATCH /plugins/:id/publication-state`) and scoped settings require `plugins.manage` within the authenticated publication session.
- **CSRF & Origin Verification:** All state-changing plugin endpoints validate Origin/Referer against allowed origins.
