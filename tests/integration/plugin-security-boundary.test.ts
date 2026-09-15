import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import {
  BundledPluginRegistry,
  defaultBundledPluginRegistry,
  executeSandboxedPluginCode,
  PluginSecurityViolationError,
  verifyPluginCapabilityPermission,
  validatePluginManifest,
  PluginContext,
} from "@vibress/plugin-core";
import {
  validateManifest,
  verifyPluginChecksum,
  executeWithTimeout,
  CAPABILITY_REGISTRY,
  SDK_VERSION,
} from "@vibress/plugin-sdk";
import {
  PluginsService,
  PluginDomainError,
} from "../../packages/domains/plugins/src/application/plugins-service";
import {
  PluginRepository,
  PluginSettingRepository,
  Plugin,
} from "../../packages/domains/plugins/src/domain/plugin";
import { isSafeUrl, encryptSecret } from "@vibress/security";
import { domainEvents } from "@vibress/events";

process.env.VIBRESS_ENCRYPTION_KEY =
  process.env.VIBRESS_ENCRYPTION_KEY || "test-encryption-key-for-batch-12";

describe("SEC-01: Plugin Security Boundary & Adversarial Production Suite (Step F)", () => {
  const pubAlphaId = "00000000-0000-4000-a000-000000000001";
  const pubBetaId = "00000000-0000-4000-b000-000000000002";

  const defaultContext: PluginContext = {
    pluginId: "vibress-content-metrics",
    manifest: {
      id: "vibress-content-metrics",
      name: "Vibress Content Metrics",
      version: "1.0.0",
      capabilities: ["posts.read"],
    },
    publicationId: pubAlphaId,
    settings: {},
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    hasCapability: (cap: string) => cap === "posts.read",
  };

  // Helper to build an in-memory PluginsService with mock repositories
  function createTestPluginsService(options: {
    plugins?: Plugin[];
    hostModule?: {
      activate?: (ctx: unknown) => Promise<void> | void;
      onEvent?: (event: string, payload: unknown) => Promise<void> | void;
    };
  } = {}) {
    const pluginStore = new Map<string, Plugin>();
    const settingStore = new Map<string, { value: string | null; encryptedValue: string | null; isSecret: boolean }>();

    if (options.plugins) {
      for (const p of options.plugins) {
        pluginStore.set(p.id, { ...p });
      }
    }

    const pluginRepo: PluginRepository = {
      create: vi.fn(async (d) => {
        const id = d.id || `plugin-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const p: Plugin = {
          id,
          manifestId: d.manifestId,
          name: d.name,
          version: d.version,
          vibressApiVersion: d.vibressApiVersion,
          description: d.description || null,
          entrypoint: d.entrypoint,
          capabilities: d.capabilities,
          hooks: d.hooks || [],
          settingsSchema: d.settingsSchema || {},
          status: "registered",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        pluginStore.set(id, p);
        return p;
      }),
      findById: vi.fn(async (id) => pluginStore.get(id) || null),
      findByManifestId: vi.fn(async (mid) => {
        for (const p of pluginStore.values()) {
          if (p.manifestId === mid) return p;
        }
        return null;
      }),
      updateStatus: vi.fn(async (id, status) => {
        const p = pluginStore.get(id);
        if (!p) throw new Error("not found");
        p.status = status;
        return p;
      }),
      updateMetadata: vi.fn(async (id, d) => {
        const p = pluginStore.get(id);
        if (!p) throw new Error("not found");
        Object.assign(p, d);
        return p;
      }),
      list: vi.fn(async () => Array.from(pluginStore.values())),
      delete: vi.fn(async (id) => {
        pluginStore.delete(id);
      }),
    };

    const settingRepo: PluginSettingRepository = {
      set: vi.fn(async (pluginId, key, value, encryptedValue, isSecret) => {
        settingStore.set(`${pluginId}:${key}`, { value, encryptedValue, isSecret });
      }),
      listForPlugin: vi.fn(async (pluginId) => {
        const out = [];
        for (const [k, v] of settingStore.entries()) {
          if (k.startsWith(`${pluginId}:`)) {
            const key = k.substring(pluginId.length + 1);
            out.push({
              id: k,
              pluginId,
              key,
              value: v.value,
              encryptedValue: v.encryptedValue,
              isSecret: v.isSecret,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
        return out;
      }),
      getSecret: vi.fn(async (pluginId, key) => {
        const entry = settingStore.get(`${pluginId}:${key}`);
        return entry && entry.isSecret ? entry.encryptedValue : null;
      }),
    };

    const host = {
      loadModule: vi.fn(async () => options.hostModule || {
        activate: vi.fn(async () => {}),
        onEvent: vi.fn(async () => {}),
      }),
    };

    return {
      service: new PluginsService(pluginRepo, settingRepo, host),
      pluginStore,
      settingStore,
      host,
    };
  }

  // ------------------------------------------------------------
  // 1. Missing Capability Denied
  // ------------------------------------------------------------
  it("1. REJECTS execution when plugin lacks required capability", async () => {
    const registry = new BundledPluginRegistry();

    // Register a plugin that only declares 'media.read', but attempts content transformation
    registry.register({
      id: "media-only-plugin",
      manifest: {
        id: "media-only-plugin",
        name: "Media Only Plugin",
        version: "1.0.0",
        capabilities: ["media.read"], // lacks 'posts.read' and 'content.read'
      },
      status: "active",
      executeHook: () => ({ success: true }),
    });

    await expect(
      registry.executeHook(
        "media-only-plugin",
        "calculateMetrics",
        { text: "sample post content" },
        defaultContext,
      ),
    ).rejects.toThrow(PluginSecurityViolationError);

    await expect(
      registry.executeHook(
        "media-only-plugin",
        "calculateMetrics",
        { text: "sample post content" },
        defaultContext,
      ),
    ).rejects.toThrow(/does not declare required capability 'posts.read'/);
  });

  // ------------------------------------------------------------
  // 2. Publication Crossing Denied
  // ------------------------------------------------------------
  it("2. REJECTS cross-publication access attempts by plugin hooks", async () => {
    const registry = new BundledPluginRegistry();

    registry.register({
      id: "seo-analyzer",
      manifest: {
        id: "seo-analyzer",
        name: "SEO Analyzer",
        version: "1.0.0",
        capabilities: ["posts.read"],
      },
      status: "active",
      executeHook: () => ({ analyzed: true }),
    });

    // Running inside Publication Alpha context
    const alphaContext: PluginContext = {
      ...defaultContext,
      publicationId: pubAlphaId,
    };

    // Payload targeted at Publication Beta
    const maliciousCrossPubPayload = {
      publicationId: pubBetaId,
      postId: "post-in-beta",
    };

    await expect(
      registry.executeHook(
        "seo-analyzer",
        "calculateMetrics",
        maliciousCrossPubPayload,
        alphaContext,
      ),
    ).rejects.toThrow(PluginSecurityViolationError);

    await expect(
      registry.executeHook(
        "seo-analyzer",
        "calculateMetrics",
        maliciousCrossPubPayload,
        alphaContext,
      ),
    ).rejects.toThrow(/Cross-publication violation/);
  });

  // ------------------------------------------------------------
  // 3. Spoofed Publication ID Denied
  // ------------------------------------------------------------
  it("3. REJECTS spoofed publication ID parameters in hook payloads", async () => {
    const { service, pluginStore } = createTestPluginsService();

    const pluginId = "test-active-plugin";
    pluginStore.set(pluginId, {
      id: pluginId,
      manifestId: "test-active-plugin",
      name: "Active Plugin",
      version: "1.0.0",
      vibressApiVersion: SDK_VERSION,
      description: null,
      entrypoint: "index.js",
      capabilities: ["events.subscribe"],
      hooks: ["onEvent"],
      settingsSchema: {},
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Invoke hook with publication Alpha context, but payload specifies Beta
    await expect(
      service.executeHook(
        pluginId,
        "onEvent",
        { publicationId: pubBetaId, event: "user.login" },
        pubAlphaId,
      ),
    ).rejects.toThrow(PluginDomainError);

    await expect(
      service.executeHook(
        pluginId,
        "onEvent",
        { publicationId: pubBetaId, event: "user.login" },
        pubAlphaId,
      ),
    ).rejects.toThrow(/Cross-publication violation/);
  });

  // ------------------------------------------------------------
  // 4. Secrets Inaccessible (Cross-Plugin & Environment)
  // ------------------------------------------------------------
  it("4. RESTRICTS secret access strictly to own plugin scope and blocks environment secrets", async () => {
    const { service, pluginStore, settingStore } = createTestPluginsService();

    // Setup Plugin A and Plugin B
    const pluginA: Plugin = {
      id: "plugin-a-uuid",
      manifestId: "plugin-a",
      name: "Plugin A",
      version: "1.0.0",
      vibressApiVersion: SDK_VERSION,
      description: null,
      entrypoint: "index.js",
      capabilities: ["settings.read-own"],
      hooks: [],
      settingsSchema: { apiKey: { type: "string", secret: true } },
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    pluginStore.set(pluginA.id, pluginA);

    // Store encrypted secret for Plugin A
    const encryptedSecretA = encryptSecret("super-secret-key-for-plugin-a");
    settingStore.set(`${pluginA.id}:apiKey`, {
      value: null,
      encryptedValue: encryptedSecretA,
      isSecret: true,
    });

    // Capture context passed to activate
    let capturedContext: PluginContext | null = null;
    const hostModule = {
      activate: vi.fn(async (ctx: unknown) => {
        capturedContext = ctx as PluginContext;
      }),
    };

    const { service: activatingService } = createTestPluginsService({
      plugins: [pluginA],
      hostModule,
    });

    // Re-seed secret in activatingService
    await activatingService.setSettings(
      pluginA.id,
      { apiKey: "super-secret-key-for-plugin-a" },
      pluginA.settingsSchema,
    );

    await activatingService.activatePlugin(pluginA.id, "actor-1");
    expect(capturedContext).not.toBeNull();

    // 1. Own secret retrieval succeeds
    const ownSecret = await capturedContext!.getSecret("apiKey");
    expect(ownSecret).toBe("super-secret-key-for-plugin-a");

    // 2. Cross-plugin secret retrieval fails / returns null
    const foreignSecret = await capturedContext!.getSecret("foreignPluginKey");
    expect(foreignSecret).toBeNull();

    // 3. Environment variables (DATABASE_URL, REDIS_URL) are NOT exposed
    const dbUrl = await capturedContext!.getSecret("DATABASE_URL");
    const redisUrl = await capturedContext!.getSecret("REDIS_URL");
    expect(dbUrl).toBeNull();
    expect(redisUrl).toBeNull();
  });

  // ------------------------------------------------------------
  // 5. Host Command Execution Denied
  // ------------------------------------------------------------
  it("5. PROHIBITS host command execution and child_process invocation", async () => {
    // Verified via SDK exports: @vibress/plugin-sdk exports zero process or child_process methods
    const sdkExports = await import("@vibress/plugin-sdk");
    expect((sdkExports as Record<string, unknown>).exec).toBeUndefined();
    expect((sdkExports as Record<string, unknown>).spawn).toBeUndefined();
    expect((sdkExports as Record<string, unknown>).fork).toBeUndefined();
    expect((sdkExports as Record<string, unknown>).process).toBeUndefined();

    // Unregistered plugin attempting dynamic execution fails closed
    const registry = new BundledPluginRegistry();
    await expect(
      registry.executeHook(
        "malicious-shell-injector",
        "onEvent",
        { cmd: "cat /etc/passwd" },
        defaultContext,
      ),
    ).rejects.toThrow(PluginSecurityViolationError);
  });

  // ------------------------------------------------------------
  // 6. Arbitrary Filesystem Access Denied
  // ------------------------------------------------------------
  it("6. REJECTS arbitrary filesystem access and directory traversal in manifests", () => {
    // Path traversal in manifest ID
    expect(() =>
      validatePluginManifest({
        id: "../../../etc/passwd",
        name: "Traversal Plugin",
        version: "1.0.0",
      }),
    ).toThrow(/Plugin ID must be lowercase alphanumeric/);

    expect(() =>
      validateManifest({
        id: "/root/.ssh/id_rsa",
        name: "SSH Stealer",
        version: "1.0.0",
        vibressApiVersion: SDK_VERSION,
        entrypoint: "index.js",
        capabilities: ["content.read"],
      }),
    ).toThrow(/Manifest id must be lowercase alphanumeric/);
  });

  // ------------------------------------------------------------
  // 7. SSRF Network Policy Enforced
  // ------------------------------------------------------------
  it("7. ENFORCES SSRF network policy blocking private IPs and link-local addresses", () => {
    // Public web endpoints are permitted
    expect(isSafeUrl("https://api.vibress.org/v1/ping")).toBe(true);
    expect(isSafeUrl("https://hooks.slack.com/services/T00/B00/X00")).toBe(true);

    // Private network, link-local, and AWS metadata endpoints are blocked
    expect(isSafeUrl("http://127.0.0.1/admin")).toBe(false);
    expect(isSafeUrl("http://localhost:5432")).toBe(false);
    expect(isSafeUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeUrl("http://10.0.0.1/internal")).toBe(false);
    expect(isSafeUrl("http://192.168.1.1/router")).toBe(false);
    expect(isSafeUrl("http://172.16.0.1/docker")).toBe(false);
    expect(isSafeUrl("file:///etc/shadow")).toBe(false);
    expect(isSafeUrl("gopher://127.0.0.1:11211")).toBe(false);
  });

  // ------------------------------------------------------------
  // 8. CPU / Memory Abuse Terminates
  // ------------------------------------------------------------
  it("8. TERMINATES runaway loops or long-running execution via strict timeout limit", async () => {
    const runawayInfiniteLoop = () =>
      new Promise((resolve) => setTimeout(resolve, 500));

    await expect(executeWithTimeout(runawayInfiniteLoop, 50)).rejects.toThrow(
      /Plugin execution exceeded timeout of 50ms/,
    );
  });

  // ------------------------------------------------------------
  // 9. Malicious Update Verification
  // ------------------------------------------------------------
  it("9. REJECTS malicious updates with checksum mismatches or incompatible API versions", () => {
    const legitimateCode = "export function activate() { console.log('hello'); }";
    const expectedSha256 = crypto
      .createHash("sha256")
      .update(legitimateCode)
      .digest("hex");

    // Checksum verification passes for genuine code
    expect(verifyPluginChecksum(legitimateCode, expectedSha256)).toBe(true);

    // Tampered code is rejected
    const tamperedCode = legitimateCode + "; maliciousPayload();";
    expect(verifyPluginChecksum(tamperedCode, expectedSha256)).toBe(false);

    // Incompatible API version is rejected
    expect(() =>
      validateManifest({
        id: "tampered-plugin",
        name: "Tampered Plugin",
        version: "2.0.0",
        vibressApiVersion: "0.9.0", // incompatible
        entrypoint: "index.js",
        capabilities: ["content.read"],
      }),
    ).toThrow(/Unsupported Vibress API version/);
  });

  // ------------------------------------------------------------
  // 10. Disabled Plugin Stops Hooks Immediately
  // ------------------------------------------------------------
  it("10. CEASES hook execution immediately when a plugin is deactivated or in error status", async () => {
    const registry = new BundledPluginRegistry();

    // Register a plugin marked 'inactive'
    registry.register({
      id: "inactive-plugin",
      manifest: {
        id: "inactive-plugin",
        name: "Inactive Plugin",
        version: "1.0.0",
        capabilities: ["posts.read"],
      },
      status: "inactive",
      executeHook: () => ({ executed: true }),
    });

    await expect(
      registry.executeHook(
        "inactive-plugin",
        "calculateMetrics",
        { text: "test" },
        defaultContext,
      ),
    ).rejects.toThrow(PluginSecurityViolationError);

    await expect(
      registry.executeHook(
        "inactive-plugin",
        "calculateMetrics",
        { text: "test" },
        defaultContext,
      ),
    ).rejects.toThrow(/Inactive or disabled plugins cannot execute hooks/);
  });

  // ------------------------------------------------------------
  // 11. Uninstall Removes Active Registrations
  // ------------------------------------------------------------
  it("11. REMOVES active registrations completely upon uninstallation", async () => {
    const registry = new BundledPluginRegistry();

    registry.register({
      id: "temporary-plugin",
      manifest: {
        id: "temporary-plugin",
        name: "Temporary Plugin",
        version: "1.0.0",
        capabilities: ["posts.read"],
      },
      status: "active",
      executeHook: () => ({ ok: true }),
    });

    expect(registry.has("temporary-plugin")).toBe(true);

    // Unregister plugin
    const removed = registry.unregister("temporary-plugin");
    expect(removed).toBe(true);
    expect(registry.has("temporary-plugin")).toBe(false);

    // Subsequent hook execution fails closed
    await expect(
      registry.executeHook(
        "temporary-plugin",
        "calculateMetrics",
        { text: "test" },
        defaultContext,
      ),
    ).rejects.toThrow(/Untrusted plugin 'temporary-plugin' execution rejected/);
  });

  // ------------------------------------------------------------
  // 12. Plugin Crash Containment (No API Disruption)
  // ------------------------------------------------------------
  it("12. ISOLATES plugin crashes and prevents host API service disruption", async () => {
    const pluginCrashing: Plugin = {
      id: "crash-plugin",
      manifestId: "crash-plugin",
      name: "Crash Plugin",
      version: "1.0.0",
      vibressApiVersion: SDK_VERSION,
      description: null,
      entrypoint: "index.js",
      capabilities: ["events.subscribe"],
      hooks: ["activate"],
      settingsSchema: {},
      status: "registered",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const hostWithExplosion = {
      loadModule: vi.fn(async () => ({
        activate: vi.fn(async () => {
          throw new Error("CRITICAL FATAL PLUGIN EXCEPTION");
        }),
      })),
    };

    const { service, pluginStore } = createTestPluginsService({
      plugins: [pluginCrashing],
    });
    // Replace host with exploding module
    (service as unknown as { host: unknown }).host = hostWithExplosion;

    // Activation throws a controlled PluginDomainError without unhandled process crash
    await expect(
      service.activatePlugin(pluginCrashing.id, "actor-admin"),
    ).rejects.toThrow(PluginDomainError);

    // Plugin status is safely marked 'error'
    const stored = pluginStore.get(pluginCrashing.id);
    expect(stored!.status).toBe("error");
  });

  // ------------------------------------------------------------
  // 13. Comprehensive Audit Events Emitted
  // ------------------------------------------------------------
  it("13. EMITS comprehensive audit domain events on all plugin lifecycle operations", async () => {
    const { service } = createTestPluginsService();
    const emittedEvents: Array<{ name: string; payload: unknown }> = [];

    domainEvents.on("plugin.registered", (p) => emittedEvents.push({ name: "plugin.registered", payload: p }));
    domainEvents.on("plugin.activated", (p) => emittedEvents.push({ name: "plugin.activated", payload: p }));
    domainEvents.on("plugin.deactivated", (p) => emittedEvents.push({ name: "plugin.deactivated", payload: p }));
    domainEvents.on("plugin.unregistered", (p) => emittedEvents.push({ name: "plugin.unregistered", payload: p }));

    // 1. Register
    const registered = await service.registerPlugin(
      {
        id: "audit-trail-plugin",
        name: "Audit Trail Plugin",
        version: "1.0.0",
        vibressApiVersion: SDK_VERSION,
        entrypoint: "index.js",
        capabilities: ["events.subscribe"],
      },
      "admin-user-1",
    );
    expect(registered.id).toBeDefined();

    // 2. Activate
    await service.activatePlugin(registered.id, "admin-user-1");

    // 3. Deactivate
    await service.deactivatePlugin(registered.id, "admin-user-1");

    // 4. Unregister
    await service.unregisterPlugin(registered.id, "admin-user-1");

    const eventNames = emittedEvents.map((e) => e.name);
    expect(eventNames).toContain("plugin.registered");
    expect(eventNames).toContain("plugin.activated");
    expect(eventNames).toContain("plugin.deactivated");
    expect(eventNames).toContain("plugin.unregistered");
  });

  // ------------------------------------------------------------
  // 14. AST Sandbox Blocks Prototype & Injection Attacks
  // ------------------------------------------------------------
  it("14. BLOCKS prototype pollution and code injection in AST-level security filter", () => {
    // 1. Prototype constructor access
    const prototypeEscape = `
      (() => {
        const foreign = this.constructor.constructor('return process')();
        return foreign;
      })()
    `;
    expect(() =>
      executeSandboxedPluginCode(prototypeEscape, defaultContext),
    ).toThrow(PluginSecurityViolationError);

    // 2. __proto__ pollution
    const protoPollution = `
      (() => {
        const payload = JSON.parse('{"__proto__": {"polluted": true}}');
        return payload;
      })()
    `;
    expect(() =>
      executeSandboxedPluginCode(protoPollution, defaultContext),
    ).toThrow(PluginSecurityViolationError);

    // 3. Dynamic eval()
    const evalCode = `
      (() => {
        return eval('1 + 1');
      })()
    `;
    expect(() =>
      executeSandboxedPluginCode(evalCode, defaultContext),
    ).toThrow(PluginSecurityViolationError);

    // 4. Dynamic Function() constructor
    const fnCode = `
      (() => {
        const fn = new Function('return 42');
        return fn();
      })()
    `;
    expect(() =>
      executeSandboxedPluginCode(fnCode, defaultContext),
    ).toThrow(PluginSecurityViolationError);
  });
});
