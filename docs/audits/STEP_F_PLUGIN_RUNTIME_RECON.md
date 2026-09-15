# STEP F — AUDIT REPORT
# Plugin Runtime Reconnaissance & Security Surface Audit

**Document Version:** 1.0.0  
**Audit Date:** September 15, 2026  
**Auditor:** Lead Staff Engineer, Security Architect & Independent Auditor  
**Scope:** Plugin Architecture, Extension Host, Manifests, Capabilities, Sandboxing Reality, Multi-Tenant Scoping  

---

## 1. Executive Overview

The Vibress plugin architecture was designed to provide controlled extensibility for CMS events, content transformation, and storage integrations. However, historical documentation and comments occasionally blurred the line between **in-process trusted extensions** and **isolated hostile-code sandboxing**.

This reconnaissance audits every component, file, database table, and execution path in the repository to establish ground truth.

### Key Finding: Node `vm.createContext()` is NOT a Security Sandbox
Node.js documentation explicitly states that `vm` is **not** a security mechanism and should not be used to run untrusted code. In Vibress:
- `packages/plugin-core/src/sandbox.ts` contains `executeSandboxedPluginCode()`.
- While it includes AST/token regex checks for `constructor`, `__proto__`, `eval`, and `Function`, it is fundamentally incapable of guaranteeing containment against sophisticated hostile JavaScript escapes.
- **Authoritative Determination:** Vibress officially classifies `vm.createContext()` as **DEPRECATED** for hostile code. Dynamic untrusted third-party code execution is strictly disallowed in Vibress v1.x.
- Vibress enforces a **TRUSTED-ONLY** plugin model: only core bundled plugins and verified administrator-registered trusted extensions are permitted.

---

## 2. Complete Path & Component Classification Matrix

Every path is classified into one of six authoritative tiers:
- **TRUSTED**: Formally controlled, validated, and restricted to safe APIs.
- **SEMI-TRUSTED**: Provides limited defensive hygiene (e.g. timeout, AST filter) but cannot withstand hostile adversary code.
- **UNTRUSTED**: Hostile external code (currently blocked from dynamic execution).
- **MOCK**: In-memory test stub or envelope lacking real out-of-process isolation.
- **UNUSED**: Present in schema or types but not wired to runtime execution.
- **MISSING**: Necessary feature for untrusted sandboxing that does not exist in v1.x (by design).

| Path / Component | Source File(s) | Classification | Description & Security Finding |
|---|---|---|---|
| **Manifest Schema & Validation** | `packages/plugin-sdk/src/index.ts`<br>`packages/plugin-core/src/index.ts` | **TRUSTED** | `validateManifest()` and `PluginManifestSchema` validate lowercase hyphenated IDs, semantic versioning, and reject unknown capabilities. |
| **Bundled Plugin Registry** | `packages/plugin-core/src/bundled-registry.ts` | **TRUSTED** | `BundledPluginRegistry` maps verified built-in plugins (`vibress-content-metrics`, `analytics-tracker`). Rejects unknown plugins with `PluginSecurityViolationError`. |
| **Trusted API Plugin Host** | `apps/api/src/plugins/plugin-host.ts` | **TRUSTED** | `BundledPluginHost` loads only verified code modules in-memory. Zero dynamic npm install, zero remote code download, zero arbitrary tarball extraction. |
| **Dynamic VM Sandbox** | `packages/plugin-core/src/sandbox.ts` | **SEMI-TRUSTED** | Uses Node.js `node:vm`. Features AST pattern checks and timeouts, but cannot withstand hostile code. Marked `@deprecated`. |
| **Extension Host RPC** | `packages/plugin-core/src/extension-host.ts` | **MOCK** | `ExtensionHost` wraps hook execution in a `Promise` with timeout. Does not spawn separate processes or worker threads. |
| **Admin API Plugin Routes** | `apps/api/src/routes/platform.ts` | **TRUSTED** | Endpoints `/plugins/*` require `requireStaffSession`, `requirePermission("plugins.manage")`, and `validateOrigin`. Unprivileged users cannot register, activate, or alter plugins. |
| **Worker Hook Dispatch** | `apps/worker/src/processors/*` | **UNUSED** | Background workers currently execute core queues; no arbitrary plugin hooks are invoked asynchronously in workers. |
| **Database Schema** | `packages/database/src/schema/platform.ts` | **TRUSTED** | PostgreSQL tables `plugins` and `plugin_settings` manage metadata and encrypted settings. Complies with schema migration 0026. |
| **Secret Storage & Masking** | `packages/domains/plugins/src/application/plugins-service.ts` | **TRUSTED** | Secrets encrypted via AES-256-GCM (`encryptSecret`). `listSettings` masks secrets as `••••••••`. `PluginContext.getSecret` scopes retrieval strictly to own plugin ID. Zero access to host `process.env`. |
| **Capability Enforcement** | `packages/plugin-core/src/bundled-registry.ts`<br>`packages/plugin-sdk/src/index.ts` | **SEMI-TRUSTED** | Capabilities declared and checked per-hook (`posts.read`, `events.read`), but lacks multi-tenant `PublicationContext` scoping. Hardened in Step F. |
| **Remote Dynamic Installer** | N/A | **MISSING** | No remote marketplace or dynamic package extraction pipeline exists (deliberate defense-in-depth). |
| **Hostile Code Container Sandbox** | N/A | **MISSING** | WASM/gVisor/MicroVM runtime for arbitrary untrusted third-party code is absent; scheduled for future major versions. |

---

## 3. Detailed Audit Findings

### 3.1 Filesystem, Process, and Network Access
- **Filesystem Access:** In the trusted host model (`BundledPluginHost`), plugins are compiled TypeScript modules imported into the application. While trusted modules run in the Node process, plugin guidelines and SDK typing restrict imports exclusively to `@vibress/plugin-sdk`.
- **Process & Command Execution:** Neither `process` nor `child_process` is exported by `@vibress/plugin-sdk`. Host command execution (`exec`, `spawn`) is completely forbidden.
- **Network / Outbound Requests:** Plugins have no direct HTTP client in `PluginContext`. Any webhook emission or event handling must pass through core mediated APIs.

### 3.2 Tenant Isolation & Publication Scope
- **Finding:** Currently, plugins registered in `pluginsService` are registered at the platform level. If a plugin executes a content hook (e.g. `calculateMetrics` or `transformPost`), it must not be permitted to cross publication boundaries or access posts belonging to other publications.
- **Remediation in Step F:** `PluginContext` must incorporate authoritative `publicationId` scoping, and hook invocations must enforce that operations are bounded by the calling `PublicationContext`.

### 3.3 Secrets & Configuration Isolation
- `PluginsService.setSettings` distinguishes plain settings from secret settings via the manifest's `settingsSchema`.
- Non-secret settings are stored in plain text; secret settings are encrypted with `encryptSecret(String(value))` before storage in `plugin_settings.encrypted_value`.
- Plugins cannot call `process.env` through the SDK. Cross-plugin secret access is prevented by SQL parameter binding `WHERE plugin_id = :pluginId AND key = :key`.

---

## 4. Conclusion & Trust Tier Reality

Vibress v1.x **does not support hostile, untrusted third-party code execution**. Any claim that `vm.createContext()` isolates hostile code is rejected.

The authoritative architecture for Step F is **Tier 1 (Bundled Plugins) & Tier 2 (Verified Administrator Plugins)** only. Untrusted third-party plugins (Tier 3) will be rejected until a true WebAssembly / microVM isolation runtime is implemented in future architecture.
