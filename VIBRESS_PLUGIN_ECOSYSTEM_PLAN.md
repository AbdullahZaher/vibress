# VIBRESS — PLUGIN ARCHITECTURE & ECOSYSTEM EVOLUTION PLAN
## Staged Sandboxing, Verification Boundaries & Extensibility Roadmap

---

## 1. Forensic Audit: What Vibress Plugins Are Today

### Subsystem Reality
1. **Plugin Manifest & SDK**:
   - `packages/plugin-sdk/src/manifest.ts` defines a strict Zod manifest validator verifying `id`, `name`, `version`, `vibressApiVersion`, `capabilities` (`posts.read`, `events.read`, `settings.manage`), and `hooks`.
   - Manifest validation is solid, rejecting illegal versions or unapproved capabilities.
2. **Bundled Host (`BundledPluginHost`)**:
   - `apps/api/src/plugins/plugin-host.ts` implements `BundledPluginHost`.
   - It maintains a hardcoded dictionary containing exactly **one bundled plugin**: `"vibress-content-metrics"`.
   - It loads this module in-process directly via compiled TypeScript imports.
3. **Execution Sandbox (`packages/plugin-core/src/sandbox.ts`)**:
   - Contains `executeSandboxedPluginCode()` using Node.js built-in `node:vm`.
   - **Crucial Reality**: As proven in the Security Audit, `node:vm` is **NOT a security boundary**. Prototype escape allows full host RCE.
   - Fortunately, `BundledPluginHost` does not invoke `sandbox.ts`; it runs bundled code directly.
4. **Extension Host (`packages/plugin-core/src/extension-host.ts`)**:
   - Contains a prototype `ExtensionHost.executeHook()` that returns a static mock object `{ executed: true, hook: hookName, payload, timestamp }`.
   - It does not spawn an external worker, child process, or isolated container.
5. **Runtime Package Installation**:
   - There is **zero support** for downloading plugins from npm, extracting tarballs, or loading third-party `.js` files dynamically at runtime.

### Can Third-Party Plugins Currently Execute Code?
**NO.** Untrusted code execution does not exist in Vibress today. All active plugin logic is compiled into the core application binary.

---

## 2. Taxonomy of Plugin Types

To avoid architectural confusion, Vibress formally distinguishes six plugin categories:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       VIBRESS PLUGIN CLASSIFICATION                     │
├──────────────────────────┬──────────────────────────────────────────────┤
│ 1. Plugin SDK            │ Type contracts, schemas, helper libraries.  │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 2. Plugin Metadata       │ Static JSON/manifest data without executable│
│                          │ code (e.g., UI layout descriptors).          │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 3. Bundled Plugins       │ Pre-compiled, first-party plugins tested and │
│                          │ shipped inside the official Vibress image.   │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 4. Verified Packages     │ Cryptographically signed packages from the   │
│                          │ official Vibress registry, run in-process.   │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 5. Isolated Out-of-Proc  │ Plugins executing in separate worker threads │
│                          │ or microVMs with strict resource quotas.     │
├──────────────────────────┼──────────────────────────────────────────────┤
│ 6. Untrusted Arbitrary   │ Uploaded third-party JavaScript running on   │
│                          │ the host. (STRICTLY PROHIBITED).             │
└──────────────────────────┴──────────────────────────────────────────────┘
```

---

## 3. Staged Plugin Architecture Roadmap

### Stage 1: v1.0 — Trusted & Bundled Plugins (Current Production Standard)
- **Execution Model**: In-process TypeScript modules compiled and bundled with the Vibress monorepo.
- **Security Boundary**: Code review and repository merge. Bundled plugins are trusted first-party code.
- **Capability Enforcement**:
  - Manifest capabilities (`posts.read`, `webhooks.write`) are validated at startup.
  - Plugins receive an injected `PluginContext` providing scoped logging, settings storage, and domain event subscriptions.
- **Isolation**: In-process. Prohibits dynamic evaluation (`eval`, `node:vm`, `Function`).

---

### Stage 2: v1.x — Cryptographically Signed Registry Packages
- **Goal**: Allow self-hosters and administrators to install verified community plugins without recompiling Vibress.
- **Distribution & Verification**:
  1. Community authors submit plugins to the Vibress Registry.
  2. The build system verifies, lints, and cryptographically signs the archive using an ECDSA keypair (Sigstore/Cosign standard).
  3. The Vibress Admin downloads the signed `.vbp` (Vibress Plugin package).
  4. The installer verifies the cryptographic signature against the Vibress root public key and computes a SHA-256 digest before extraction.
- **Execution Model**: Loaded in isolated Node.js `worker_threads` with restricted IPC channels.
- **Capabilities**:
  - No direct access to `process`, `child_process`, or raw PostgreSQL database connections.
  - All database mutations must route through structured JSON-RPC messages over standard IPC to the host API.

---

### Stage 3: v2.0 — High-Security WebAssembly (WASM) & MicroVM Isolation
- **Goal**: Safe execution of completely untrusted third-party plugins.
- **Evaluated Sandboxing Technologies**:

| Technology | Security Guarantee | Overhead | Verdict |
| :--- | :--- | :--- | :--- |
| **Node.js `vm` / `vm2`** | None (Trivially escapable via prototype chain). | Low | **REJECTED (Dangerous)** |
| **`worker_threads` alone** | Process isolation within same Node instance; can still exhaust memory/CPU. | Low | Good for signed code only. |
| **WebAssembly (WASI / Wasmtime)** | Memory-safe, sandboxed linear memory; zero OS syscall access without capability grant; sub-millisecond cold start. | Very Low | **RECOMMENDED FOR COMPUTATION & FILTERS** |
| **Isolated Docker Containers** | Full Linux namespace/cgroup isolation; network and disk isolation. | Moderate | **RECOMMENDED FOR COMPLEX EXTENSIONS** |

- **Target Model**:
  - UI extensions: Pure React Studio cards sandboxed inside an `iframe` with `sandbox="allow-scripts"` and `postMessage` protocol.
  - Backend hooks: WebAssembly modules compiled from Rust/AssemblyScript running in a WASI runtime with explicit capability imports (HTTP fetch allowed only if declared in manifest).

---

## 4. Capability & Permissions Model

```json
{
  "id": "vibress-plugin-seo-optimizer",
  "name": "SEO Optimizer",
  "version": "1.2.0",
  "vibressApiVersion": "^1.0.0",
  "capabilities": [
    "posts.read",
    "posts.edit.metadata",
    "ai.generate"
  ],
  "network": {
    "allowedOutboundHosts": [
      "api.google.com"
    ]
  },
  "hooks": [
    "onPostBeforePublish",
    "onPostUpdate"
  ]
}
```

### Runtime Checks
When a plugin calls `context.api.posts.get(postId)`:
1. Host checks if `posts.read` is declared in plugin manifest.
2. Host validates that `req.tenant.publicationId` matches the post's publication.
3. If unauthorized, throws `PluginSecurityViolationError` and logs an audit trail event.
