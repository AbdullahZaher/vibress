# ADR 0009: Plugin Runtime Architecture & Trust Boundary

**Status:** Accepted  
**Date:** September 15, 2026  
**Author:** Lead Staff Engineer & Security Architect  
**Deciders:** Core Engineering Team & Release Auditor  
**Supercedes:** Deprecated dynamic `node:vm` execution patterns  

---

## 1. Context and Problem Statement

A CMS platform requires extensibility for custom content transformations, search integrations, analytics trackers, and third-party webhooks. However, allowing external code to execute inside a multi-tenant web application presents extreme security risks:
- Code execution and host shell escape.
- Multi-tenant data leakage across publications.
- Stealing environment secrets, database credentials, or API keys.
- Prototype pollution and denial of service via CPU/memory starvation.

Historical documentation in the project suggested that Node.js `vm.createContext()` was utilized as a sandbox. However, the official Node.js documentation explicitly cautions:
> *"The node:vm module is not a security mechanism. Do not use it to run untrusted code."*

We must establish an authoritative, honest architectural decision for Vibress v1.0 that does not make false security claims.

---

## 2. Considered Alternatives

### Option A: Trusted-Only In-Process Architecture (Selected for v1.0)
- Only core bundled plugins (Tier 1) and administrator-audited verified plugins (Tier 2) are permitted to execute.
- Untrusted third-party code uploads (Tier 3) are completely disabled and fail closed.
- Plugins are restricted to importing `@vibress/plugin-sdk`, receiving explicit capabilities, and operating within authoritative `PublicationContext` boundaries.

### Option B: Separate Node Child Process / Worker Thread
- Executes plugin code in a separate Node.js `worker_threads` or `child_process`.
- **Drawbacks:** While isolating CPU crashes from the main event loop, a Node.js child process still shares the operating system environment, filesystem permissions, and network stack unless wrapped in OS cgroups/namespaces. It does not solve the hostile code execution problem without OS-level sandboxing.

### Option C: Container / MicroVM Runtime (Firecracker / gVisor)
- Spins up a dedicated microVM or lightweight container per plugin execution.
- **Drawbacks:** Excellent security isolation, but excessive cold-start latency (150-500ms) and operational overhead for synchronous content transformation hooks in a lightweight CMS.

### Option D: WebAssembly (WASM / WASI) Capability Runtime (Planned for Phase 2)
- Compiles extensions to WebAssembly and runs them inside an embedded runtime (e.g. Wasmtime or Wasmer via V8 WASM).
- Memory-safe, zero system call access by default, sub-millisecond instantiation.
- **Status:** Selected as the target architecture for future public untrusted marketplace plugins, but out of scope for v1.0 release.

---

## 3. Decision Outcome

**Chosen Alternative:** **Option A — Trusted-Only In-Process Architecture**.

### Key Architectural Tenets:
1. **Explicit Disavowal of Node VM Sandboxing:**
   `vm.createContext()` is formally deprecated for hostile code execution. Any attempt to dynamically execute untrusted code string payloads is rejected.
2. **Authoritative Capability-Based Access Control:**
   Plugins must declare required capabilities in their manifest (`content.read`, `posts.read`, `events.read`, etc.). Hooks verify declared capabilities prior to dispatch.
3. **Multi-Tenant Publication Isolation:**
   All hook executions are contextualized with the active `PublicationContext`. Plugins are strictly prohibited from accessing data outside their tenant boundary.
4. **Secret Isolation:**
   Plugins have zero access to `process.env`. Plugin secrets are stored encrypted with AES-256-GCM and accessed exclusively via `PluginContext.getSecret(key)` bounded by `plugin_id`.
5. **Fail-Closed Default:**
   Unregistered, inactive, or corrupted plugins immediately cease processing hooks.

---

## 4. Consequences

### Positive:
- **Zero False Security Claims:** The system is honest about its trust boundary.
- **Maximum Performance:** Synchronous and lightweight asynchronous hooks run at native speed without IPC overhead.
- **Type Safety:** Full TypeScript compile-time and runtime validation through `@vibress/plugin-sdk`.
- **Maintainable & Stable:** No external daemon or container manager required to run Vibress.

### Negative / Trade-offs:
- Untrusted third-party plugins cannot be uploaded directly through the admin UI in v1.0. All plugins must be installed as vetted code or official modules.
- Administrator discipline is required when vetting and installing custom plugins.

---

## 5. Implementation Roadmap to Phase 2 (WASM Sandbox)
- **v1.0 (Current):** Trusted-only in-process plugin host (`BundledPluginHost` & `BundledPluginRegistry`).
- **v1.1+ (Future):** Introduce `@vibress/wasm-host` using WebAssembly components to isolate community marketplace plugins.
