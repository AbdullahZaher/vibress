# ADR — Trusted external extension host for Vibress (vNext)

**Status:** Accepted — architecture direction / authorized for implementation **only**  
**Decision date:** 2026-10-19  
**Scope:** External operator-installed plugin platform and the independently versioned `vibress-lms` pilot  
**Authority:** Project-requested architectural decision. **This document does not assert that separate human Security, DB, Ops or QA approvals, implementation, CI, or release certification occurred.**

## Context / verified baseline

- The running API host uses `@vibress/plugin-sdk.PluginModule` with exact `SDK_VERSION = "1.0.0"`; `apps/api/src/plugins/plugin-host.ts` loads only bundled known modules. Registering a manifest **does not** load an external package.
- `packages/plugin-core.VibressPlugin` is a different legacy-facing type with different context/lifecycle methods; `extension-host` does not implement process sandboxing.
- `PluginsService.deactivatePlugin` currently changes DB status but does not invoke `deactivate()`; `executeHook` does not pass the actual event name to `onEvent`. Treat these as implementation defects and test/compatibility constraints, not established extension guarantees.
- `plugins` and `plugin_settings` are global; no publication-level enablement or safe migration lifecycle exists for external plugins.
- `requireMemberSession` authenticates a Member but does **not** itself assert Member publication equals independently resolved site publication. New Member extension APIs must enforce that check.
- Prior accepted [ADR-017](../14-decisions/plugin-trust-model.md) and [plugin runtime ADR-0009](STEP_F_PLUGIN_RUNTIME_ARCHITECTURE.md) establish a **trusted** model but contain some overbroad wording on failure isolation and `process.env` access. Trust boundaries must be described accurately.

## Decision — approved architectural invariants

1. **Package/distribution:** external plugins live in independent repositories and ship **reviewed, immutable, operator-installed packages**, pinned by an external trusted release digest or detached signed envelope over the *final archive bytes*. No runtime Admin upload/remote npm execution, marketplace of untrusted modules or self-referential archive digest. Reproducible Docker/self-hosted deployment and rollback-by-compatible-version are mandatory.
2. **Trust boundary:** vetted trusted JS may run in process in phase 1. **SDK-only imports and capability flags are programming/host mediation rules, not an OS security sandbox.** In-process code can access its runtime privileges and cause process-wide OOM/stall/exit; strong crash/security isolation needs separately supervised process/container sandbox with OS constraints and another ADR.
3. **Canonical public ABI:** evolve `@vibress/plugin-sdk` using explicit host protocol negotiation while preserving current bundled v1 via compatibility path. Inventory `plugin-core` consumers before deciding whether a shim is necessary; never silently convert ambiguous manifests or alter old released migration files.
4. **Scope and identity:** platform-installed artifact vs per-publication enabled state are distinct. Host resolves a Staff/Member/Public/Machine principal authoritatively. Explicitly verify `member.publicationId === resolvedPublicationId`. IDs/headers/payloads are not permission. Scoped secrets/settings and denial of unauthorized cross-publication data access are hard requirements.
5. **Data / validation:** use **admitted, versioned, namespace-bound typed repositories** with scoped unit of work and runtime schemas from a **public SDK interface**; the host adapts schemas to `@vibress/api-contracts` and performs scoped DB operations. Plugin handlers do not use private domain imports, raw Drizzle/SQL or arbitrary transaction objects. Migrations are forward-only, immutable, reviewed, and safe for old installs; old global settings/activation are adapted without blindly enabling or distributing secrets.
6. **Routing/UI:** host registers admin/member/public API routes with independent auth/origin/privacy/rate-limit controls and stable errors. Studio navigation references a registered Staff-only `viewId` resolved by Studio, never a public Web URL. Public pages use reserved `/extensions/:pluginId/*` namespace initially, with locale/SEO-safe sanitized view models and a default accessible fallback. Private learner pages/media are Member-authorized and not publicly cached.
7. **Background/runtime:** namespace and version jobs/events; validate publication and enabled plugin state at dispatch, apply idempotent at-least-once processing, retries and disable/drain. A Promise timeout is *not* process containment. No plugin-specific core source edit is required once host extension points are implemented.
8. **Data/ops:** disable/uninstall preserve student/settings/data by default; purge is separately authorized, audited, confirmed and backup-capable. Fresh install, non-empty upgrade, worker restart and backup/restore are required. Arabic/RTL, keyboard accessibility and built-in/external themes are release gates.
9. **LMS pilot:** one free published course with a protected lesson, Staff course editing, Member enrollment/progress and two-publication isolation is the acceptance pilot. Core billing remains money truth; paid one-time course purchase and LMS Pro operator licensing are separate later decisions.

## Relationship to previously accepted ADRs

This decision **extends**, not silently deletes or rewrites, existing trusted-only plugin ADRs. It supersedes **only** any assertion that in-process hooks cannot degrade core service or that SDK discipline prevents trusted code accessing Node environment/secrets at the OS/process level. Enforced host services can restrict mediated API operations, but cannot contain hostile JS co-located in the API process. Existing bundled v1 plugin behavior and trust/admission policy remain supported. Any future untrusted package execution or hard crash isolation must have a new approved runtime architecture, sandbox threat model and operator implications.

## Considered alternatives

- **Bake LMS into Vibress core:** rejected; independent upgrades/themes/contracts would be coupled.
- **Run arbitrary uploaded npm/ZIP inside the API process:** rejected for security and operability.
- **Mandatory external SaaS host:** rejected for core self-hostability and offline operation.
- **Separate sandboxed process/container from vNext day 1:** deferred; appropriate for untrusted packages or stronger availability requirements, but not claimed by trusted v1.
- **Direct plugin DB credentials/SQL, private deep imports or Next.js source patches:** rejected as unstable and unsafe public extension contracts.

## Approval scope, delegated details, and hold points

**Approved now:** the nine architectural invariants above and the internal pilot/prod separation. This is an authorization to start scoped `EXT-001..004` engineering and to implement reviewed incremental contracts.

**Not approved as frozen/shipped public API:** sample TypeScript signatures, `hostApi.major=2`, capability strings, specific DB tables, exact filenames of archives, frontend UI-bundle packaging, loader binaries, or example route URLs. These remain illustrative until `EXT-004` produces versioned runtime schemas and independent conformance samples. No external installation, child process, LMS runtime or safe migration is claimed working.

**Before code touching sensitive runtime/migrations:** verify consumers and old data, choose schema/migration strategy, Security + DB + API review the scoped implementation diff, and test negative/auth/tenant paths. **Before public release:** full SDK compatibility, Docker/upgrade/rollback, multi-replica consistency, crash/failure semantics, jobs, RTL/themes/accessibility, protected media and CI gates must pass. Capture actual reviewer identities/approvals as part of the PR/release process; this ADR is not a substitute.

**Implementation ticket dependency:** `EXT-001..004 → EXT-101..104 → EXT-201..204 → minimal EXT-301/302 → LMS-101..106 (EXT-501 internal pilot)`; production requires `EXT-301..304 + EXT-401..404 + EXT-501..504` and LMS MVP QA. `EXT-504` freezes SDK only *after* conformance evidence.

## Validation of this ADR

Reviewed current source and draft contracts, including SDK/core ABI, host loader, Member middleware, global plugin schema and theme routes. **No code, database migration, tests, builds, CI, security audit or operational rehearsal executed by this documentation change.** See the [RFC approval record](../08-plugins/EXTENSION_RFC_APPROVAL.md) for status and decision traceability.
