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
          throw new Error("boom");
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
    });
    expect(repoWith.updateStatus).toHaveBeenCalledWith("p1", "error");
  });

  it("deactivates a plugin", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active" })),
    };
    const service = makeService({ pluginRepo: repoWith });
    const plugin = await service.deactivatePlugin("p1", "u1");
    expect(plugin.status).toBe("inactive");
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
