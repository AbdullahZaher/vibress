# Plugin extensibility: current implementation and proposed platform

**Documentation status: design proposal — 2026-10-19.** These documents do not imply the features are implemented.

## Architecture decision

**Approved for implementation direction, not shipped:** [RFC review/approval record](EXTENSION_RFC_APPROVAL.md) and [accepted architecture ADR](../adr/2026-10-19-external-extension-host-vnext.md). Conceptual API examples remain unimplemented; production release and SDK contract freeze require the gates below.

## Implemented extension milestones (October 2026)

The roadmap documents the complete target. EXT-201 through EXT-204 have been
merged; [EXT-301A](extension-admin-views-ext301a.md) is a **partial**
Host-owned, read-only Studio navigation/view implementation. The proposed
[EXT-301B1](extension-admin-views-ext301b1.md) adds only operator-pinned
Admin UI asset verification; it does not serve or execute those assets. It is not a
general executable Admin UI or a declaration of extension platform release
readiness. The historical baseline below describes the 2026-10-19 design review.

## Read in this order

1. [External extensions architecture](external-extensions-architecture.md) — production trust boundary, service ownership, lifecycle, tenant model, deployment.
2. [Extension contracts (proposed v1)](external-extensions-contracts.md) — versioned illustrative manifests, APIs, routes, UI slots, data and capability definitions.
3. [Extension security and operations](external-extensions-security-operations.md) — threats, releases, migration, rollback, observability, fail-closed behavior.
4. [Implementation roadmap](external-extensions-roadmap.md) — tickets, dependencies, gates, acceptance criteria and pilot.
5. [SDK compatibility and adapter](external-extensions-sdk-compatibility.md) — resolve the two existing plugin interfaces and preserve v1.
6. [Principal scope and typed data](external-extensions-identity-data.md) — publication-bound sessions, old settings migration and storage.
7. [Package integrity, UI and worker runtime](external-extensions-package-and-ui.md) — detached release checksums, dynamic surface limitations and lifecycle.
8. [Typed storage and runtime validation contract](external-extensions-storage-contract.md) — concrete host-mediated, schema-bound data API design.
9. [Current plugin system](plugin-system.md) and [current SDK](plugin-sdk.md) — existing functionality, **not** complete external installation support.

### Known baseline (verified from `main` on 2026-10-19)

- `apps/api/src/plugins/plugin-host.ts` contains a hard-coded trusted module registry; registering a manifest does **not** install executable code.
- `packages/plugin-sdk/src/index.ts` exports `PluginManifest`, `PluginContext`, `PluginModule` and capability declarations; no production route, admin component, data migration, or render-registration APIs exist.
- `packages/domains/plugins/src/application/plugins-service.ts` provides registration, activation, settings and partial hook dispatch; it does not implement a generalized extension router or complete per-publication installation model.
- `packages/database/src/schema/platform.ts` stores plugins/settings at platform scope without publication-scoped settings.
- `apps/api/src/routes/platform.ts` protects management endpoints with staff auth, `plugins.read/manage` and origin validation, but generic request shapes need shared runtime schemas.
- `packages/plugin-core/src/extension-host.ts` simulates an envelope; it is **not** an isolated execution process. The deprecated `node:vm` path is not a sandbox. Moreover `packages/plugin-core/src/index.ts` defines an **alternate** `VibressPlugin` contract with different lifecycle method and context shapes; it is not interchangeable with `@vibress/plugin-sdk`.
- Existing documentation/examples contain conflicting historical API and sandbox claims: reconcile them before presenting a stable external developer SDK.

### Scope and policy

Trusted, operator-installed packages are **phase 1**. In-browser ZIP upload, runtime npm execution, an untrusted marketplace and sandbox claims are **not** supported. Implementation requires an explicit ADR; nothing here changes the accepted [plugin trust model](../14-decisions/plugin-trust-model.md).

### Reference pilot

The private `AbdullahZaher/vibress-lms` repository is the proposed integration/acceptance pilot. The goal is a fully separate codebase that adds a course catalog, one protected lesson, authenticated enrollment and admin management **without deep imports or edits to Vibress core for the individual plugin**.

### Maintaining these documents

- Change a contract with an ADR, compatibility review, migration plan, changelog and consumer tests.
- Keep `Current` versus `Proposed` labels honest; replace them only after code and tests land on `main`.
- Do not treat planning estimates as committed dates or claim release readiness based on documentation alone.
