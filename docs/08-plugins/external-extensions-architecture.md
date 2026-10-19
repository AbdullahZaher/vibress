# External plugin platform — architecture RFC

**Status:** ACCEPTED FOR IMPLEMENTATION — architectural direction only; NOT IMPLEMENTED. [ADR](../adr/2026-10-19-external-extension-host-vnext.md).  
**Date:** 2026-10-19  
**Owners:** Vibress core maintainers (Architect, Security, API, DB, Web/Admin, QA)  
**Pilot consumer:** `vibress-lms` (independently versioned repository).

## 1. Goal and invariants

Support independently developed, operator-installed, versioned **trusted** extensions for a self-hostable multi-publication CMS. Plugin activation must not require editing platform application source for each extension. Preserve existing API/SDK, database content, configured themes, backwards upgrades, Arabic/RTL, accessibility, SEO, backups, and core service availability.

The smallest useful milestone is a **vertical slice**: install a versioned trusted package at deployment, enable for one publication, expose one protected admin route + view, one protected member endpoint + public page, persist a plugin-owned record, deploy an additive migration, disable without deleting data, and upgrade/re-enable successfully.

### Non-goals for v1

- Arbitrary source/ZIP upload or install-from-Admin; auto-downloading remote code; public plugin marketplace.
- Executing hostile extensions safely in a shared Node.js process.
- Giving plugins private Drizzle, auth, billing or server internals.
- Native React/Next.js dynamic imports from unverified plugin artifacts.
- Replacing theme contract or plugin-managed billing gateways in the first slice.

## 2. Verified baseline and gaps

| Area | Exists today | Gap |
| --- | --- | --- |
| Trust | `BundledPluginHost`, trusted module map | No external installed-package resolver |
| Manifest | `validateManifest`, SDK version and declared capabilities | No package provenance, permissions admission workflow or full schema/version policy |
| Lifecycle | `PluginsService` registration, activation, status, settings | No atomic install/upgrade/rollback, publication enablement, reliable deactivation drain |
| Isolation | Current hook checks plus `publicationId` in context | Global plugin/settings rows; no complete host-mediated services or scoped data model |
| API | Fastify admin plugin management, existing public/member/machine APIs | No namespaced extension routes, policy-controlled service bridge |
| UI | Admin plugins panel; Next.js themes and Liquid collections | No executable/declared extension pages, secure UI registration or public route resolver |
| Data | Core Drizzle schemas/migrations, Content Modeler | No plugin-owned migration registry/upgrade lifecycle |
| Jobs | Existing BullMQ worker and webhooks | No extension-owned namespaced idempotent task registry |

The code contains **two non-equivalent plugin contracts**: `@vibress/plugin-sdk` (`PluginModule.activate/deactivate/onEvent`) and `packages/plugin-core` (`VibressPlugin.onActivate/onDeactivate/onEvent` with a different context). Before vNext, choose canonical SDK and explicitly test compatibility adapters; see [SDK compatibility RFC](external-extensions-sdk-compatibility.md). Existing SDK protocol constant is `1.0.0` even though the npm package version is `1.2.0`. Developer examples and sandbox claims require reconciliation.

## 3. Deployment and runtime model

`Operator/deployment → verified package artifact → trusted host registry → publication activation → mediated domain services`.

- Stage A: package all code/assets in one immutable artifact; record the **final archive SHA-256 in an external trusted operator lockfile or detached signed envelope**, not as a self-referential field inside the same archive. Include compiled JS, static assets and manifest in reproducible Docker images or mounted immutable artifacts. Install/restart is an **operator** action, not a CMS browser upload.
- Stage B: discover the package at startup, validate manifest/schema/API compatibility, allowlist, integrity and dependency constraints; fail closed if unknown/incompatible. No path traversal or mutable remote entrypoints.
- Stage C: record **installed globally** vs **enabled for publication** as separate states. Registry identifies executable modules only from the resolved, audited deployment manifest. Registration of JSON by itself never loads code.
- Stage D: dispatch all plugin actions through stable, narrow host services; no private imports. Runtime type enforcement and authenticated scope matter more than TypeScript restrictions.
- Stage E: when plugin work can block, delegate durable tasks to existing workers. For unstable external integrations, choose a separately deployed service accessed through authenticated, bounded APIs rather than claiming an in-process timeout is isolation.

A trusted in-process JS module has effective process privileges even if its SDK does not export `process`. **Ordinary rejected async handlers may be caught, but fatal OOM, CPU/event-loop stalls, process exit and global mutations are not isolated. Core continuity during arbitrary plugin faults cannot be promised.** Strong availability guarantees require a separately designed and supervised process/container runtime. Capabilities control *authorized mediated operations*, not the kernel/OS privileges of hostile JS. Only reviewed/controlled packages qualify for this model. A future remote service/WASM/container sandbox requires a separate ADR and threat model.

## 4. Ownership and boundaries

| Layer | Owns | Extension boundary |
| --- | --- | --- |
| `packages/plugin-sdk` | Public TS types, runtime schema, stable errors, version negotiation | Only allowed dependency for in-process plugin code |
| `packages/domains/plugins` | Install, enable, permissions, settings, audit, migration lifecycle contracts | Public exports; no HTTP concerns |
| `packages/database` | Core registry/state tables and additive migration runner metadata | Plugin data via mediated, scoped storage interface, never importing core Drizzle internals |
| `apps/api` | Authenticated admin/member/public route namespace, origin, rate limits | Route descriptor registration, not raw unrestricted Fastify instance |
| `apps/worker` | Namespaced queue registration and retries | Idempotent, scoped job messages; no ad hoc worker monkey patches |
| `apps/admin` | Stable admin nav and isolated page/container slots | Declarative nav; reviewed asset bundles or origin-locked iframe |
| `apps/web` + themes | SEO-aware route dispatch, page rendering, Liquid view-model slots | No arbitrary template evaluation against raw DB rows |
| `packages/security` | Authoritative caller context, capabilities, audit, secret handling | No plugin-level bypass |

## 5. Publication and principal model

- Package installation is **platform-scoped**; enablement/settings/data are **publication-scoped by default**. Legacy globally active plugins/settings remain on an explicit v1 compatibility path and are never copied or auto-enabled in arbitrary publications. A platform capability (e.g. system storage provider) requires an explicit elevated operator policy.
- Resolve `publicationId` from authenticated Staff session, verified site resolution or validated queue envelope. A Member session proves Member identity **but does not alone prove requested publication**: match resolved `member.publicationId` against authoritative site/publication context before dispatch; reject if absent/mismatched. Never trust a plugin caller-supplied ID as authorization. All APIs look up resources by compound publication + resource ID; wrong-tenant behavior matches not-found.
- Staff RBAC (`requireStaffSession` + `requirePermission`), Member identity (`requireMemberSession`), Machine credentials, and anonymous public visitors remain separate principals.
- A plugin may define namespaced permissions (e.g. `lms.course.manage`); the host maps them to staff roles using a declared, audited permission registry. Member enrollment/instructor status is domain authorization, not Staff RBAC.
- Do not place full PII or unmasked secrets into event envelopes or logs.

## 6. Extension points — host-provided, not runtime features yet

1. Versioned admin, member and public API route descriptors; shared `@vibress/api-contracts` runtime validation; host owns auth/tenant middleware and stable errors.
2. Declarative navigation references registered staff-only Studio view IDs, never public routes; admin plugin views are isolated by origin/CSP and keyboard/RTL verified. No open-ended React internals.
3. Reserved public route namespace (`/extensions/{pluginId}/...` initially) and SEO metadata/locale-aware helper. Vanity `/courses/...` routes only after collision-safe route-registration design.
4. Host-mediated members and commerce readers for *entitlement checks*, content modeler public editors/readers as explicit capabilities; do not assume existing subscriptions cover one-time course purchases.
5. Namespaced per-publication data access, migrations, background tasks and events.
6. Theme-safe course cards/detail slots as sanitized, localized view models; absence of a slot uses accessible default rendering.

## 7. State machine, upgrades and uninstallation

`discovered → installed → enabled(publication) → disabled`, with independently tracked `install_error`, `enable_error` and `migration_required`. Historic `registered/active/inactive/error` rows remain readable via an adapter; never rewrite released migration files.

- Install: validate artifact/manifest/config first; stage; transactionally record installed artifact and compatible schema state.
- Enable: check actor, package compat, migration head and declared permissions; invoke bounded lifecycle; publish state only on success. Avoid partially enabled routes.
- Upgrade: operator pins new artifact; preflight semver/SDK/data migrations, backup, apply *forward-only* migrations idempotently, health checks; switch traffic with explicit rollback playbook. Rollback code only if old code understands new schema; otherwise forward-fix or restore tested backup.
- Disable: deny new requests/jobs, drain in-flight work, unregister contributions, keep data + settings. Failure to stop running side effects requires operator alert.
- Uninstall: remove code/contributions after disable, default to **retaining plugin data**. Destructive purge must require explicit separate confirmation, backup/export, and audit.
- Fresh install and existing install must converge to identical invariants after migration/backfill. No dependency on a provider-managed cloud control plane.

## 8. Implementation-blocking specifications

The typed storage and shared runtime-schema direction is [accepted by the ADR](../adr/2026-10-19-external-extension-host-vnext.md) but not implemented. Sensitive implementation remains blocked until [SDK ABI and legacy adapter](external-extensions-sdk-compatibility.md), [principal publication binding, typed data and legacy migration](external-extensions-identity-data.md) and [immutable release integrity, Admin/Next.js assets and worker lifecycle](external-extensions-package-and-ui.md) have explicit decisions, test fixtures and owners. `packages/theme-core/src/route-contract.ts` does not register extension pages today. `PluginsService.deactivatePlugin` does not call `deactivate()`, and `executeHook` does not forward the actual event name correctly; those are functional blockers for credible lifecycle documentation.

## 9. Adopted architecture choices requiring concrete implementation and contract freeze

| Decision | Accepted design default | Implementation/release gate |
| --- | --- | --- |
| Package source | Operator-vetted release/lockfile, built into image | Supply-chain/security sign-off |
| API compatibility | New major host contract; additive optional fields | SDK consumer test suite |
| Database | Namespace-per-plugin schema or mediated owned tables, in same Postgres initially | DB/migration review |
| UI | Declarative nav and origin-locked plugin UI before arbitrary component slots | XSS/CSP/RTL review |
| Public routes | Reserved namespace first, vanity aliases later | SEO/collision design |
| Entitlements | Existing subscription reader (recurring), one-time purchases as later capability | Billing policy |
| Sandbox | None claimed in trusted v1 | Documented operator trust |

## 10. Architecture acceptance

Pass the pilot without editing private core files for the **individual LMS module**, including: two publications with no cross-read/write; authenticated/unauthorized/missing/disabled paths; fresh deployment and upgrade with existing data; rollback decision tested; Arabic+English locale and RTL keyboard navigation; theme fallback; worker crash and retry recovery; ability to reinstall after disable with content intact.

Related docs: [contracts](external-extensions-contracts.md), [security/operations](external-extensions-security-operations.md), [execution plan](external-extensions-roadmap.md), [existing ADR](../14-decisions/plugin-trust-model.md).
