# STEP F — SECURITY THREAT MODEL
# Plugin Ecosystem & Extensibility Architecture

**Document Version:** 1.1.0  
**Audit Date:** September 15, 2026  
**Auditor:** Lead Staff Engineer, Security Architect & Independent Release Auditor  
**Trust Boundary:** Core System vs. Bundled/Verified Plugins vs. Untrusted Third-Party Code  
**Status:** **AUTHORITATIVE & TRUTH-RECONCILED**

---

## 1. Trust Hierarchy & Classification

Extensibility security in Vibress is structured around four strict trust tiers:

```
+-------------------------------------------------------------------+
| Tier 0: Core Engine (Kernel / Framework)                          |
| - Full database access, full environment access, full network     |
+-------------------------------------------------------------------+
                                 |
+-------------------------------------------------------------------+
| Tier 1: Bundled Trusted Plugins (Official Distribution)           |
| - Pre-audited, statically linked into distribution                |
| - Granted explicit capability sets (e.g. posts.read, events.read) |
+-------------------------------------------------------------------+
                                 |
+-------------------------------------------------------------------+
| Tier 2: Admin-Verified Trusted Plugins                            |
| - Registered by Superadmins with plugins.manage permission        |
| - Cryptographically verified (SHA-256), declared capabilities     |
+-------------------------------------------------------------------+
                                 |
               [ STRICT SECURITY AIR-GAP / ENFORCEMENT ]
                                 |
+-------------------------------------------------------------------+
| Tier 3: Untrusted Third-Party Plugins                             |
| - NOT SUPPORTED IN v1.x (FAIL CLOSED)                             |
| - Arbitrary runtime code uploads / dynamic VM execution rejected  |
+-------------------------------------------------------------------+
```

---

## 2. Critical Security Boundaries & Reality Constraints

> [!CAUTION]
> **Authoritative Technical Truth & Limitations:**
> 1. **Node.js `vm` is NOT a Sandbox:** Node.js `node:vm` creates separate global scopes but is officially not a security mechanism. Prototypes and constructors can be traversed to escape the context. Dynamic execution in `vm` is deprecated and NEVER used for untrusted code.
> 2. **In-Process Timeout is NOT Hostile CPU Isolation:** An in-process `Promise.race` timer timeout terminates cooperative async promises, but cannot preempt a synchronous `while(true)` infinite loop running on the main event loop thread. True hostile CPU isolation requires isolated worker processes or WebAssembly runtimes.
> 3. **`try/catch` is NOT Process Crash Isolation:** Wrapping plugin hooks in `try/catch` handles standard synchronous or async JavaScript exceptions, but cannot isolate against fatal process-level aborts, native addon segfaults, or Out-Of-Memory (OOM) fatal kills.
> 4. **SHA-256 Integrity $\neq$ Publisher Authenticity:** SHA-256 checksums verify payload integrity (detecting tampering against the declared hash), but do NOT verify publisher identity or author authenticity without asymmetric cryptographic signatures (e.g., Ed25519/GPG).
>
> For these fundamental reasons, **Vibress v1.0 only executes trusted Tier 1 (Bundled) and Tier 2 (Admin-Verified) plugins.** Untrusted third-party code execution is strictly prohibited and fails closed.

---

## 3. Comprehensive Threat Analysis Matrix

| Threat ID | Threat Category | Threat Description | Attack Vector | Control | Implementation | Verification Test |
|---|---|---|---|---|---|---|
| **THR-01** | **Code Execution** | Arbitrary code execution via dynamic eval or untrusted script upload | Attacker uploads malicious JS file or injects code into plugin registration | Fail-closed registry: only pre-approved bundled/verified plugins execute | `BundledPluginRegistry.executeHook()` rejects unregistered plugins | `fails closed when untrusted/unregistered plugin execution is attempted` |
| **THR-02** | **Prototype Escape** | Breaking out of JS execution context via prototype chain | `this.constructor.constructor('return process')()` in dynamic script | AST/regex check + deprecation of dynamic execution | `executeSandboxedPluginCode` AST scanner in `sandbox.ts` | `detects and blocks prototype escape attempts in deprecated dynamic sandbox` |
| **THR-03** | **Tenant Escape** | Plugin accessing content or members of Publication B while invoked by Publication A | Spoofing `publicationId` in plugin hook payload or context | Authoritative `PublicationContext` passed from core; scoped repository queries | `PluginContext.publicationId` bound to active session; cross-tenant query rejected | `REJECTS cross-publication access attempts by plugin hooks` |
| **THR-04** | **Privilege Escalation** | Plugin executing ungranted operations (e.g. database write without capability) | Calling internal APIs outside declared manifest capabilities | Capability Gate: verification before hook execution | `verifyPluginCapabilityPermission()` in `sandbox.ts` & `bundled-registry.ts` | `enforces strict capability checks for bundled plugins` |
| **THR-05** | **Secret Exfiltration** | Malicious plugin stealing system environment variables or other plugins' keys | Accessing `process.env` or reading `plugin_settings` directly | Strict SDK encapsulation: no `process.env` exported; `getSecret(key)` strictly scoped to own `pluginId` | `PluginsService.getDecryptedSecret()` uses SQL `pluginId` parameter | `strictly restricts secret access to own plugin scope and blocks environment secrets` |
| **THR-06** | **Command Execution** | Invoking system shell or spawning child processes | Importing `child_process`, `exec`, or `spawn` | Zero OS shell APIs in `@vibress/plugin-sdk`; bundler and type enforcement | Public SDK contract exports only safe interfaces | `verifies plugin cannot invoke child_process or spawn host commands` |
| **THR-07** | **Filesystem Escape** | Arbitrary reading/writing to host filesystem (e.g. `/etc/passwd` or `.env`) | Direct file I/O imports or directory traversal via plugin ID | Plugin IDs validated via `^[a-z0-9-]+$`; zero `fs` API in SDK | `validateManifest()` & `PluginManifestSchema` regex | `validates plugin manifests and rejects directory traversal or illegal characters` |
| **THR-08** | **SSRF** | Server-Side Request Forgery via unmediated HTTP clients | Plugin initiates outbound requests to cloud metadata (`169.254.169.254`) | No arbitrary HTTP client in `PluginContext`; webhooks mediated by core dispatcher | Core webhook service validates destination IPs and blocks link-local/private addresses | `blocks unmediated network requests and SSRF targeting private IP ranges` |
| **THR-09** | **CPU / Memory Exhaustion** | Runaway loop or excessive allocation locking Node event loop | Infinite `while(true)` or memory leak in plugin hook | Execution timeout wrapper (`executeWithTimeout`) with aggressive defaults (2000-5000ms) for cooperative async execution | `executeWithTimeout()` in `plugin-sdk` / `extension-host.ts` | `terminates infinite loops or runaway execution within strict timeout limit` |
| **THR-10** | **Malicious Update** | Man-in-the-middle tampering with plugin artifact or version spoofing | Replacing plugin code with backdoored payload during update | SHA-256 checksum verification & API version matching | `verifyPluginChecksum()` & `SDK_VERSION` check in `validateManifest()` | `verifies cryptographic SHA-256 checksum match and rejects mismatch` |
| **THR-11** | **Zombie Execution** | Deactivated or uninstalled plugin continuing to process hooks | Hook triggers fire on orphaned or inactive plugins | Status check gate: hooks only dispatched to plugins in `"active"` status | `PluginsService.executeHook()` checks `plugin.status === 'active'` | `stops hook execution immediately when plugin is deactivated or uninstalled` |
| **THR-12** | **Crash Containment** | Unhandled exception in plugin crashes the main Fastify API process | Plugin throws unhandled synchronous error or rejected promise | Isolated try/catch execution envelope; failure marks plugin as `"error"` | `PluginsService.activatePlugin()` catches exceptions and isolates plugin | `isolates plugin crashes and prevents API service degradation` |
| **THR-13** | **Audit Trail Absence** | Unauthorized plugin operations occurring without security logging | Silent execution of sensitive plugin actions | Domain events emitted on all lifecycle events (`plugin.registered`, `plugin.activated`, etc.) | `domainEvents.emit()` across `PluginsService` | `emits audit events for all plugin lifecycle operations` |
| **THR-14** | **Supply-Chain Compromise** | Dependency poisoning in plugin package | Malicious dependency installed via npm | Bundled-only architecture; no runtime dynamic `npm install` | In-memory statically audited plugin host (`BundledPluginHost`) | `verifies plugin host loads only bundled statically verified code` |

---

## 4. Residual Risks & Future Roadmap

1. **Phase 2 Isolation Boundary (Post-v1.0):**  
   To safely support Tier 3 (untrusted third-party marketplace plugins), Vibress will evaluate WebAssembly (Wasmtime/WASI) or isolated MicroVM runtimes with dedicated CPU/memory cgroups and capability-mediated syscalls.
2. **Asymmetric Publisher Signatures:**  
   Future plugin packaging will incorporate Ed25519 signature verification against a trusted public key registry for publisher identity.
3. **Capability Grant Auditing:**  
   When admins register plugins requesting high-risk capabilities (`content.write`, `email.send`), a prominent warning is surfaced requiring explicit confirmation.
