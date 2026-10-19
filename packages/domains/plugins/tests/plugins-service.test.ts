import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  PluginsService,
  PluginDomainError,
} from "../src/application/plugins-service";
import {
  PluginRepository,
  PluginSettingRepository,
  Plugin,
  PluginSetting,
} from "../src/domain/plugin";
import { SDK_VERSION } from "@vibress/plugin-sdk";
import { encryptSecret } from "@vibress/security";

beforeAll(() => {
  process.env.VIBRESS_ENCRYPTION_KEY =
    process.env.VIBRESS_ENCRYPTION_KEY || "test-encryption-key-for-batch-12";
});

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "p1",
    manifestId: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    vibressApiVersion: SDK_VERSION,
    description: null,
    entrypoint: "index.ts",
    capabilities: ["events.subscribe"],
    hooks: [],
    settingsSchema: {},
    status: "registered",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const validManifest = {
  id: "test-plugin",
  name: "Test Plugin",
  version: "1.0.0",
  vibressApiVersion: SDK_VERSION,
  entrypoint: "index.ts",
  capabilities: ["events.subscribe", "settings.read-own"],
  hooks: ["onEvent"],
};

describe("PluginsService", () => {
  const pluginRepo: PluginRepository = {
    create: vi.fn(async (d) =>
      makePlugin({
        manifestId: d.manifestId,
        name: d.name,
        capabilities: d.capabilities,
      }),
    ),
    findById: vi.fn(async () => null),
    findByManifestId: vi.fn(async () => null),
    updateStatus: vi.fn(async (id, status) => makePlugin({ id, status })),
    updateMetadata: vi.fn(async (id, d) => makePlugin({ id })),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
  };
  const settingRepo: PluginSettingRepository = {
    set: vi.fn(async () => undefined),
    listForPlugin: vi.fn(async () => []),
    getSecret: vi.fn(async () => null),
  };
  const host = { loadModule: vi.fn(async () => null) };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new PluginsService(
      (overrides.pluginRepo as PluginRepository) || pluginRepo,
      (overrides.settingRepo as PluginSettingRepository) || settingRepo,
      (overrides.host as typeof host) || host,
    );
  }

  it("registers a valid plugin manifest", async () => {
    const service = makeService();
    const plugin = await service.registerPlugin(validManifest, "u1");
    expect(plugin.manifestId).toBe("test-plugin");
    expect(plugin.status).toBe("registered");
  });

  it("rejects an incompatible Vibress API version", async () => {
    const service = makeService();
    await expect(
      service.registerPlugin(
        { ...validManifest, vibressApiVersion: "0.5.0" },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
  });

  it("rejects an unknown capability", async () => {
    const service = makeService();
    await expect(
      service.registerPlugin(
        { ...validManifest, capabilities: ["pwn.all"] },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
  });

  it("rejects a missing entrypoint", async () => {
    const service = makeService();
    await expect(
      service.registerPlugin({ ...validManifest, entrypoint: "" }, null),
    ).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
  });

  it("re-registration updates metadata instead of creating a duplicate", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findByManifestId: vi.fn(async () => makePlugin()),
    };
    const service = makeService({ pluginRepo: repoWith });
    const plugin = await service.registerPlugin(validManifest, "u1");
    expect(plugin.id).toBe("p1");
    expect(repoWith.updateMetadata).toHaveBeenCalled();
  });

  it("activates a plugin via the host and marks it active", async () => {
    const hostWith = {
      loadModule: vi.fn(async () => ({
        activate: vi.fn(async () => undefined),
      })),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin()),
    };
    const service = makeService({ host: hostWith, pluginRepo: repoWith });
    const plugin = await service.activatePlugin("p1", "u1");
    expect(plugin.status).toBe("active");
    expect(hostWith.loadModule).toHaveBeenCalled();
  });

  it("activation failure marks the plugin error and is isolated (throws domain error)", async () => {
    const hostWith = {
      loadModule: vi.fn(async () => ({
        activate: vi.fn(async () => {
          throw new Error("/private/operator/plugins/secret-signing-key");
        }),
      })),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin()),
      updateStatus: vi.fn(async (id, status) => makePlugin({ id, status })),
    };
    const service = makeService({ host: hostWith, pluginRepo: repoWith });
    await expect(service.activatePlugin("p1", "u1")).rejects.toMatchObject({
      code: "PLUGIN_ACTIVATION_FAILED",
      message: "Plugin activation failed",
    });
    expect(repoWith.updateStatus).toHaveBeenCalledWith("p1", "error");
  });

  it("calls cleanup before completing deactivation", async () => {
    const deactivate = vi.fn(async () => undefined);
    const moduleHost = { loadModule: vi.fn(async () => ({ activate: vi.fn(), deactivate })) };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active" })),
    };
    const service = makeService({ pluginRepo: repoWith, host: moduleHost });
    const plugin = await service.deactivatePlugin("p1", "u1");
    expect(plugin.status).toBe("inactive");
    expect(deactivate).toHaveBeenCalledOnce();
  });

  it("fails closed when cleanup throws", async () => {
    const deactivate = vi.fn(async () => { throw new Error("cleanup failed"); });
    const moduleHost = { loadModule: vi.fn(async () => ({ activate: vi.fn(), deactivate })) };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active" })),
      updateStatus: vi.fn(async (id, status) => makePlugin({ id, status })),
    };
    const service = makeService({ pluginRepo: repoWith, host: moduleHost });
    await expect(service.deactivatePlugin("p1", "u1")).rejects.toMatchObject({
      code: "PLUGIN_DEACTIVATION_FAILED",
    });
    expect(repoWith.updateStatus).toHaveBeenCalledWith("p1", "error");
    expect(repoWith.updateStatus).not.toHaveBeenCalledWith("p1", "inactive");
  });

  it("dispatches explicit event names and rejects cross-publication messages", async () => {
    const onEvent = vi.fn(async () => undefined);
    const moduleHost = { loadModule: vi.fn(async () => ({ activate: vi.fn(), onEvent })) };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active", hooks: ["post.published"] })),
    };
    const service = makeService({ pluginRepo: repoWith, host: moduleHost });
    const payload = { publicationId: "pub-a", eventName: "spoofed" };
    await service.dispatchEvent("p1", "post.published", payload, "pub-a");
    expect(onEvent).toHaveBeenCalledWith("post.published", payload);
    await expect(service.dispatchEvent("p1", "post.published", { publicationId: "pub-b" }, "pub-a"))
      .rejects.toMatchObject({ code: "CROSS_PUBLICATION_VIOLATION" });
    await expect(service.dispatchEvent("p1", "post.deleted", {}, "pub-a"))
      .rejects.toMatchObject({ code: "PLUGIN_CAPABILITY_DENIED" });
  });

  it("never reports success for an unimplemented event hook", async () => {
    const moduleHost = { loadModule: vi.fn(async () => ({ activate: vi.fn() })) };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active", hooks: ["onEvent"] })),
    };
    await expect(makeService({ pluginRepo: repoWith, host: moduleHost })
      .executeHook("p1", "onEvent", {}))
      .rejects.toMatchObject({ code: "PLUGIN_HOOK_NOT_FOUND" });
  });

  it("keeps external hooks denied by default until enabled in this publication", async () => {
    const onEvent = vi.fn(async () => undefined);
    const moduleHost = {
      loadModule: vi.fn(async () => ({ activate: vi.fn(), onEvent })),
      requiresPublicationEnablement: vi.fn(() => true),
    };
    const stateStore = new Map<string, boolean>();
    const publicationStates = {
      hasAnyState: vi.fn(async (pluginId: string) =>
        [...stateStore.keys()].some((key) => key.startsWith(pluginId + ":"))),
      isEnabled: vi.fn(async (pluginId: string, pub: string) =>
        stateStore.get(`${pluginId}:${pub}`) === true),
      setEnabled: vi.fn(async (pluginId: string, pub: string, enabled: boolean) => {
        stateStore.set(`${pluginId}:${pub}`, enabled);
      }),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active", hooks: ["onEvent"] })),
    };
    const service = new PluginsService(repoWith, settingRepo, moduleHost, publicationStates);
    await expect(service.dispatchEvent("p1", "post.published", {}, "pub-a"))
      .rejects.toMatchObject({ code: "PLUGIN_PUBLICATION_INACTIVE" });
    expect(moduleHost.loadModule).not.toHaveBeenCalled();

    await service.setPublicationEnabled("p1", "pub-a", true);
    expect(await service.isPublicationEnabled("p1", "pub-a")).toBe(true);
    expect(await service.isPublicationEnabled("p1", "pub-b")).toBe(false);
    await service.dispatchEvent("p1", "post.published", {}, "pub-a");
    expect(onEvent).toHaveBeenCalledOnce();
    await expect(service.dispatchEvent("p1", "post.published", {}, "pub-b"))
      .rejects.toMatchObject({ code: "PLUGIN_PUBLICATION_INACTIVE" });
    await service.setPublicationEnabled("p1", "pub-a", false);
    await expect(service.dispatchEvent("p1", "post.published", {}, "pub-a"))
      .rejects.toMatchObject({ code: "PLUGIN_PUBLICATION_INACTIVE" });
  });

  it("never enables a registered but globally inactive external module", async () => {
    const hostWith = { loadModule: vi.fn(async () => null), requiresPublicationEnablement: () => true };
    const stateRepo = {
      hasAnyState: vi.fn(async () => false),
      isEnabled: vi.fn(async () => false),
      setEnabled: vi.fn(async () => undefined),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "registered" })),
    };
    const service = new PluginsService(repoWith, settingRepo, hostWith, stateRepo);
    await expect(service.setPublicationEnabled("p1", "pub-a", true))
      .rejects.toMatchObject({ code: "PLUGIN_INACTIVE" });
    expect(stateRepo.setEnabled).not.toHaveBeenCalled();
  });

  it("prevents uninstall when per-publication records exist, even if disabled", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "inactive" })),
      delete: vi.fn(async () => undefined),
    };
    const states = {
      hasAnyState: vi.fn(async () => true),
      isEnabled: vi.fn(async () => false),
      setEnabled: vi.fn(async () => undefined),
    };
    const service = new PluginsService(repoWith, settingRepo, host, states);
    await expect(service.unregisterPlugin("p1", "staff"))
      .rejects.toMatchObject({ code: "PLUGIN_HAS_PUBLICATIONS" });
    expect(repoWith.delete).not.toHaveBeenCalled();
  });

  it("rejects global settings and secret reads for external plugins", async () => {
    const externalHost = {
      loadModule: vi.fn(async () => null),
      requiresPublicationEnablement: () => true,
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active" })),
    };
    const settingRepoWith: PluginSettingRepository = {
      ...settingRepo,
      set: vi.fn(async () => undefined),
      listForPlugin: vi.fn(async () => []),
    };
    const service = new PluginsService(repoWith, settingRepoWith, externalHost);
    await expect(service.setSettings("p1", { token: "should-not-store" }))
      .rejects.toMatchObject({ code: "PLUGIN_SETTINGS_NOT_SCOPED" });
    await expect(service.listSettings("p1"))
      .rejects.toMatchObject({ code: "PLUGIN_SETTINGS_NOT_SCOPED" });
    expect(settingRepoWith.set).not.toHaveBeenCalled();
    expect(settingRepoWith.listForPlugin).not.toHaveBeenCalled();
  });

  it("denies legacy global settings and secrets to external plugins", async () => {
    const moduleHost = {
      loadModule: vi.fn(async () => ({ activate: vi.fn(async () => undefined) })),
      requiresPublicationEnablement: () => true,
    };
    const settingRepoWith = {
      ...settingRepo,
      listForPlugin: vi.fn(async () => []),
      getSecret: vi.fn(async () => "secret"),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin()),
    };
    const service = new PluginsService(repoWith, settingRepoWith, moduleHost);
    await expect(service.setSettings("p1", { apiToken: "unsafe" }))
      .rejects.toMatchObject({ code: "PLUGIN_SETTINGS_NOT_SCOPED" });
    await expect(service.listSettings("p1"))
      .rejects.toMatchObject({ code: "PLUGIN_SETTINGS_NOT_SCOPED" });
    await service.activatePlugin("p1", "admin");
    const loaded = await moduleHost.loadModule("unused");
    expect(loaded?.activate).toHaveBeenCalledOnce();
    const context = loaded?.activate.mock.calls[0]?.[0];
    expect(context?.settings).toEqual({});
    expect(await context?.getSecret("apiToken")).toBeNull();
    expect(settingRepoWith.getSecret).not.toHaveBeenCalled();
  });

  it("settings: secrets encrypted at rest and masked on read", async () => {
    const settingsStored: PluginSetting[] = [];
    const settingRepoWith: PluginSettingRepository = {
      set: vi.fn(async (pluginId, key, value, encryptedValue, isSecret) => {
        settingsStored.push({
          id: "s",
          pluginId,
          key,
          value,
          encryptedValue,
          isSecret,
          updatedAt: new Date(),
          createdAt: new Date(),
        });
      }),
      listForPlugin: vi.fn(async () => settingsStored),
      getSecret: vi.fn(
        async () =>
          settingsStored.find((s) => s.isSecret)?.encryptedValue || null,
      ),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () =>
        makePlugin({
          settingsSchema: {
            apiToken: { type: "string", secret: true },
            logLevel: { type: "string", secret: false },
          },
        }),
      ),
    };
    const service = makeService({
      settingRepo: settingRepoWith,
      pluginRepo: repoWith,
    });

    await service.setSettings("p1", {
      apiToken: "secret-token",
      logLevel: "debug",
    });
    const secretSetting = settingsStored.find((s) => s.isSecret);
    expect(secretSetting).toBeTruthy();
    // Encrypted at rest — no plaintext
    expect(secretSetting!.encryptedValue).not.toContain("secret-token");
    expect(secretSetting!.value).toBeNull();
    // Non-secret stored plainly
    const plainSetting = settingsStored.find((s) => s.key === "logLevel");
    expect(plainSetting!.value).toBe("debug");

    // Masked on read
    const listed = await service.listSettings("p1");
    const listedSecret = listed.find((s) => s.key === "apiToken");
    expect(listedSecret!.masked).toBe(true);
    expect(listedSecret!.value).toBe("••••••••");
    expect(JSON.stringify(listed)).not.toContain("secret-token");
  });

  it("settings: replace-only for secrets (existing kept when value empty)", async () => {
    const encrypted = encryptSecret("existing-token");
    const settingRepoWith: PluginSettingRepository = {
      ...settingRepo,
      getSecret: vi.fn(async () => encrypted),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () =>
        makePlugin({
          settingsSchema: { apiToken: { type: "string", secret: true } },
        }),
      ),
    };
    const service = makeService({
      settingRepo: settingRepoWith,
      pluginRepo: repoWith,
    });
    await service.setSettings("p1", { apiToken: "" });
    // set() must NOT be called (empty value → keep existing)
    expect(settingRepoWith.set).not.toHaveBeenCalled();
  });
});
