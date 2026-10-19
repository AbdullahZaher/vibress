import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
  PluginsService,
  PluginDomainError,
} from "../src/application/plugins-service";
import {
  PluginRepository,
  PluginSettingRepository,
  Plugin,
  PluginSetting,
  PluginPublicationSettingRepository,
} from "../src/domain/plugin";
import { SDK_VERSION, type PluginContext } from "@vibress/plugin-sdk";
import { encryptSecret } from "@vibress/security";

afterEach(() => { vi.unstubAllEnvs(); });

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
    tryTransitionStatus: vi.fn(async (id, _expected, status) => makePlugin({ id, status })),
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

  it("rejects unapproved manifests before persisting plugin metadata", async () => {
    const hostWith = {
      loadModule: vi.fn(async () => null),
      authorizeRegistration: vi.fn(async () => { throw new Error("/private/operator/package"); }),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findByManifestId: vi.fn(async () => null),
      create: vi.fn(async (input) => makePlugin({ manifestId: input.manifestId })),
    };
    const service = new PluginsService(repoWith, settingRepo, hostWith);
    await expect(service.registerPlugin(validManifest, "staff")).rejects.toMatchObject({
      code: "PLUGIN_NOT_TRUSTED",
      message: "Plugin manifest is not approved by the operator",
    });
    expect(repoWith.create).not.toHaveBeenCalled();
  });

  it("refuses active external release changes until lifecycle deactivation", async () => {
    const hostWith = {
      loadModule: vi.fn(async () => null),
      requiresPublicationEnablement: () => true,
      authorizeRegistration: vi.fn(async () => undefined),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findByManifestId: vi.fn(async () => makePlugin({
        status: "active", version: "0.9.0", entrypoint: "index.ts",
      })),
      updateMetadata: vi.fn(async () => makePlugin()),
    };
    const service = new PluginsService(repoWith, settingRepo, hostWith);
    await expect(service.registerPlugin(validManifest, "staff")).rejects.toMatchObject({
      code: "PLUGIN_UPDATE_REQUIRES_DEACTIVATION",
    });
    expect(repoWith.updateMetadata).not.toHaveBeenCalled();
  });

  it("returns an already active plugin without running activate twice", async () => {
    const runActivate = vi.fn(async () => undefined);
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active" })),
      tryTransitionStatus: vi.fn(async () => null),
    };
    const hostWith = { loadModule: vi.fn(async () => ({ activate: runActivate })) };
    const result = await makeService({ pluginRepo: repoWith, host: hostWith })
      .activatePlugin("p1", "owner");
    expect(result.status).toBe("active");
    expect(runActivate).not.toHaveBeenCalled();
    expect(repoWith.tryTransitionStatus).not.toHaveBeenCalled();
  });

  it("does not execute plugin code when a competing activation owns the CAS claim", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "registered" })),
      tryTransitionStatus: vi.fn(async () => null),
    };
    const hostWith = { loadModule: vi.fn(async () => null) };
    await expect(makeService({ pluginRepo: repoWith, host: hostWith })
      .activatePlugin("p1", "owner")).rejects.toMatchObject({
        code: "PLUGIN_TRANSITION_IN_PROGRESS",
      });
    expect(hostWith.loadModule).not.toHaveBeenCalled();
  });

  it("rejects competing deactivation before calling any cleanup", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({ status: "active" })),
      tryTransitionStatus: vi.fn(async () => null),
    };
    const hostWith = { loadModule: vi.fn(async () => null) };
    await expect(makeService({ pluginRepo: repoWith, host: hostWith })
      .deactivatePlugin("p1", "owner")).rejects.toMatchObject({
        code: "PLUGIN_TRANSITION_IN_PROGRESS",
      });
    expect(hostWith.loadModule).not.toHaveBeenCalled();
  });

  it("blocks changing active external display metadata rejected by runtime pinning", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findByManifestId: vi.fn(async () => makePlugin({
        status: "active",
        name: "Old display name",
        capabilities: [...validManifest.capabilities],
        hooks: [...validManifest.hooks],
      })),
      updateMetadata: vi.fn(async () => makePlugin()),
    };
    const hostWith = {
      loadModule: vi.fn(async () => null),
      requiresPublicationEnablement: () => true,
      authorizeRegistration: vi.fn(async () => undefined),
    };
    await expect(new PluginsService(repoWith, settingRepo, hostWith)
      .registerPlugin(validManifest, "staff")).rejects.toMatchObject({
        code: "PLUGIN_UPDATE_REQUIRES_DEACTIVATION",
      });
    expect(repoWith.updateMetadata).not.toHaveBeenCalled();
  });

  it("rejects secret reclassification on inactive external plugins without migration", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findByManifestId: vi.fn(async () => makePlugin({
        status: "inactive",
        settingsSchema: { token: { type: "string", secret: false } },
      })),
      updateMetadata: vi.fn(async () => makePlugin()),
    };
    const hostWith = {
      loadModule: vi.fn(async () => null),
      requiresPublicationEnablement: () => true,
      authorizeRegistration: vi.fn(async () => undefined),
    };
    await expect(new PluginsService(repoWith, settingRepo, hostWith)
      .registerPlugin({
        ...validManifest,
        settingsSchema: { token: { type: "string", secret: true } },
      }, "staff")).rejects.toMatchObject({
        code: "PLUGIN_SETTINGS_SCHEMA_MIGRATION_REQUIRED",
      });
    expect(repoWith.updateMetadata).not.toHaveBeenCalled();
  });

  it("masks historic plaintext if the declared setting became secret", async () => {
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({
        status: "active",
        settingsSchema: { token: { type: "string", secret: true } },
      })),
    };
    const scopedRepository: PluginPublicationSettingRepository = {
      setMany: vi.fn(async () => undefined),
      listForPlugin: vi.fn(async () => [{
        id: "s", pluginId: "p1", key: "token", value: "old-plaintext",
        encryptedValue: null, isSecret: false,
        createdAt: new Date(), updatedAt: new Date(),
      }]),
      getSecret: vi.fn(async () => null),
    };
    const hostWith = {
      loadModule: vi.fn(async () => null),
      requiresPublicationEnablement: () => true,
    };
    const service = new PluginsService(repoWith, settingRepo, hostWith, undefined, scopedRepository);
    const list = await service.listPublicationSettings("p1", "pub-a");
    expect(list).toEqual([{ key: "token", value: "••••••••", isSecret: true, masked: true }]);
    expect(JSON.stringify(list)).not.toContain("old-plaintext");
  });

  it("initializes an already active plugin once per fresh API replica before events", async () => {
    const activate = vi.fn(async () => undefined);
    const onEvent = vi.fn(async () => undefined);
    const hostWith = {
      loadModule: vi.fn(async () => ({ activate, onEvent })),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({
        status: "active", hooks: ["onEvent"],
      })),
    };
    const firstReplica = new PluginsService(repoWith, settingRepo, hostWith);
    await Promise.all([
      firstReplica.dispatchEvent("p1", "post.published", {}, "pub-a"),
      firstReplica.dispatchEvent("p1", "post.published", {}, "pub-a"),
    ]);
    expect(activate).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledTimes(2);

    const restartedReplica = new PluginsService(repoWith, settingRepo, hostWith);
    await restartedReplica.dispatchEvent("p1", "post.published", {}, "pub-a");
    expect(activate).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(3);
  });

  it("does not run events if the plugin becomes inactive during local initialization", async () => {
    const onEvent = vi.fn(async () => undefined);
    const activate = vi.fn(async () => undefined);
    let reads = 0;
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => {
        reads += 1;
        return makePlugin({ status: reads === 1 ? "active" : "inactive", hooks: ["onEvent"] });
      }),
    };
    const hostWith = { loadModule: vi.fn(async () => ({ activate, onEvent })) };
    await expect(new PluginsService(repoWith, settingRepo, hostWith)
      .dispatchEvent("p1", "post.published", {}, "pub-a")).rejects.toMatchObject({
      code: "PLUGIN_INACTIVE",
    });
    expect(onEvent).not.toHaveBeenCalled();
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
    expect(onEvent).toHaveBeenCalledWith("post.published", payload, undefined);
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
    const activate = vi.fn(async (_context: PluginContext) => undefined);
    const moduleHost = {
      loadModule: vi.fn(async () => ({ activate })),
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
    expect(activate).toHaveBeenCalledOnce();
    const context = activate.mock.calls[0]?.[0];
    expect(context?.settings).toEqual({});
    expect(await context?.getSecret("apiToken")).toBeNull();
    expect(settingRepoWith.getSecret).not.toHaveBeenCalled();
  });

  it("stores scoped settings atomically, encrypts secrets and passes only owning publication context", async () => {
    const encryptedByScope = new Map<string, {
      key: string;
      value: string | null;
      encryptedValue: string | null;
      isSecret: boolean;
    }[]>();
    const scopeRepository: PluginPublicationSettingRepository = {
      setMany: vi.fn(async (pluginId, publicationId, entries) => {
        encryptedByScope.set(`${pluginId}:${publicationId}`, entries.map((entry) => ({ ...entry })));
      }),
      listForPlugin: vi.fn(async (pluginId, publicationId) =>
        (encryptedByScope.get(`${pluginId}:${publicationId}`) ?? []).map((entry) => ({
          ...entry,
          id: "setting-id",
          pluginId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))),
      getSecret: vi.fn(async (pluginId, publicationId, key) =>
        (encryptedByScope.get(`${pluginId}:${publicationId}`) ?? [])
          .find((entry) => entry.key === key)?.encryptedValue ?? null),
    };
    const states = {
      hasAnyState: vi.fn(async () => true),
      isEnabled: vi.fn(async (_id: string, pub: string) => pub === "pub-a"),
      setEnabled: vi.fn(async () => undefined),
    };
    const onEvent = vi.fn(async (_event: string, _payload: unknown, _context?: PluginContext) => undefined);
    const externalHost = {
      requiresPublicationEnablement: () => true,
      loadModule: vi.fn(async () => ({ activate: vi.fn(), onEvent })),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({
        status: "active",
        capabilities: ["events.subscribe", "settings.read-own"],
        hooks: ["onEvent"],
        settingsSchema: {
          apiToken: { type: "string", secret: true },
          displayName: { type: "string" },
        },
      })),
    };
    const service = new PluginsService(repoWith, settingRepo, externalHost, states, scopeRepository);
    await service.setPublicationSettings("p1", "pub-a", {
      apiToken: "secret-in-publication-a",
      displayName: "Course A",
    });
    const recorded = encryptedByScope.get("p1:pub-a");
    expect(recorded?.find((entry) => entry.key === "apiToken")?.value).toBeNull();
    expect(recorded?.find((entry) => entry.key === "apiToken")?.encryptedValue)
      .not.toContain("secret-in-publication-a");
    const masked = await service.listPublicationSettings("p1", "pub-a");
    expect(JSON.stringify(masked)).not.toContain("secret-in-publication-a");
    expect(masked.find((entry) => entry.key === "apiToken")?.masked).toBe(true);
    await service.dispatchEvent("p1", "post.published", { publicationId: "pub-a" }, "pub-a");
    const context = onEvent.mock.calls[0]?.[2];
    expect(context?.publicationId).toBe("pub-a");
    expect(context?.settings.displayName).toBe("Course A");
    expect(await context?.getSecret("apiToken")).toBe("secret-in-publication-a");
    await expect(service.dispatchEvent("p1", "post.published", {}, "pub-b"))
      .rejects.toMatchObject({ code: "PLUGIN_PUBLICATION_INACTIVE" });
    expect(await service.listPublicationSettings("p1", "pub-b")).toEqual([]);
  });

  it("rejects unknown settings before any scoped write and never replaces an empty secret", async () => {
    const scoped: PluginPublicationSettingRepository = {
      setMany: vi.fn(async () => undefined),
      listForPlugin: vi.fn(async () => []),
      getSecret: vi.fn(async () => null),
    };
    const states = {
      hasAnyState: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      setEnabled: vi.fn(async () => undefined),
    };
    const repoWith: PluginRepository = {
      ...pluginRepo,
      findById: vi.fn(async () => makePlugin({
        status: "active",
        settingsSchema: { token: { type: "string", secret: true } },
      })),
    };
    const hostWith = { loadModule: vi.fn(async () => null), requiresPublicationEnablement: () => true };
    const service = new PluginsService(repoWith, settingRepo, hostWith, states, scoped);
    await expect(service.setPublicationSettings("p1", "pub-a", {
      token: "valid", unsupported: "invalid",
    })).rejects.toMatchObject({ code: "PLUGIN_SETTING_UNKNOWN" });
    expect(scoped.setMany).not.toHaveBeenCalled();
    await service.setPublicationSettings("p1", "pub-a", { token: "" });
    expect(scoped.setMany).not.toHaveBeenCalled();
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

  describe("Lifecycle recovery and safe shutdown", () => {
    it("recovers a plugin stuck in activating to error", async () => {
      vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
      const stuckPlugin = makePlugin({
        id: "p-stuck", status: "activating",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async (id) => (id === "p-stuck" ? stuckPlugin : null)),
        tryTransitionStatus: vi.fn(async (id, expected, status) => {
          if (expected.includes(stuckPlugin.status)) {
            return makePlugin({ id, status });
          }
          return null;
        }),
      };
      const service = makeService({ pluginRepo: repoWith });
      const recovered = await service.recoverPluginLifecycle("p-stuck", "admin-1", true);
      expect(recovered.status).toBe("error");
      expect(repoWith.tryTransitionStatus).toHaveBeenCalledWith(
        "p-stuck",
        ["activating"],
        "error",
      );
    });

    it("recovers a plugin stuck in deactivating to inactive", async () => {
      vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
      const stuckPlugin = makePlugin({
        id: "p-deact", status: "deactivating",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async (id) => (id === "p-deact" ? stuckPlugin : null)),
        tryTransitionStatus: vi.fn(async (id, expected, status) => {
          if (expected.includes(stuckPlugin.status)) {
            return makePlugin({ id, status });
          }
          return null;
        }),
      };
      const service = makeService({ pluginRepo: repoWith });
      const recovered = await service.recoverPluginLifecycle("p-deact", "admin-1", true);
      expect(recovered.status).toBe("inactive");
      expect(repoWith.tryTransitionStatus).toHaveBeenCalledWith(
        "p-deact",
        ["deactivating"],
        "inactive",
      );
    });

    it("rejects recovery when plugin is not in a transitional state", async () => {
      vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
      const activePlugin = makePlugin({ id: "p-active", status: "active" });
      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async () => activePlugin),
      };
      const service = makeService({ pluginRepo: repoWith });
      await expect(
        service.recoverPluginLifecycle("p-active", "admin-1", true),
      ).rejects.toMatchObject({
        code: "PLUGIN_NOT_IN_TRANSITION",
      });
    });

    it("rejects online recovery even for a stale status with explicit confirmation", async () => {
      vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "");
      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async () => makePlugin({
          status: "activating", updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        })),
        tryTransitionStatus: vi.fn(async () => makePlugin({ status: "error" })),
      };
      const service = makeService({ pluginRepo: repoWith });
      await expect(service.recoverPluginLifecycle("p1", "operator", true))
        .rejects.toMatchObject({ code: "PLUGIN_RECOVERY_NOT_QUIESCENT" });
      expect(repoWith.tryTransitionStatus).not.toHaveBeenCalled();
    });

    it("requires explicit operator confirmation even in maintenance", async () => {
      vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async () => makePlugin({
          status: "activating", updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        })),
        tryTransitionStatus: vi.fn(async () => makePlugin({ status: "error" })),
      };
      await expect(makeService({ pluginRepo: repoWith })
        .recoverPluginLifecycle("p1", "operator"))
        .rejects.toMatchObject({ code: "PLUGIN_RECOVERY_NOT_QUIESCENT" });
      expect(repoWith.tryTransitionStatus).not.toHaveBeenCalled();
    });

    it("refuses recovery of a recent transition without touching database state", async () => {
      vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async () => makePlugin({ status: "deactivating" })),
        tryTransitionStatus: vi.fn(async () => makePlugin({ status: "inactive" })),
      };
      await expect(makeService({ pluginRepo: repoWith })
        .recoverPluginLifecycle("p1", "operator", true))
        .rejects.toMatchObject({ code: "PLUGIN_RECOVERY_TOO_RECENT" });
      expect(repoWith.tryTransitionStatus).not.toHaveBeenCalled();
    });

    it("does not execute plugin code on a dedicated recovery maintenance instance", async () => {
      vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async () => makePlugin({ status: "active" })),
      };
      const hostWith = { loadModule: vi.fn(async () => ({ activate: vi.fn() })) };
      const service = makeService({ pluginRepo: repoWith, host: hostWith });
      await expect(service.activatePlugin("p1", "operator"))
        .rejects.toMatchObject({ code: "PLUGIN_RECOVERY_MAINTENANCE" });
      await expect(service.dispatchEvent("p1", "post.published", {}, "pub-a"))
        .rejects.toMatchObject({ code: "PLUGIN_RECOVERY_MAINTENANCE" });
      expect(hostWith.loadModule).not.toHaveBeenCalled();
    });

    it("shutdown deactivates all active module instances gracefully", async () => {
      const deactivateFn1 = vi.fn(async () => undefined);
      const deactivateFn2 = vi.fn(async () => {
        throw new Error("Deactivate failed");
      });

      const p1 = makePlugin({ id: "p1", entrypoint: "index1.ts", status: "registered" });
      const p2 = makePlugin({ id: "p2", entrypoint: "index2.ts", status: "registered" });

      const repoWith: PluginRepository = {
        ...pluginRepo,
        findById: vi.fn(async (id) => (id === "p1" ? p1 : id === "p2" ? p2 : null)),
        tryTransitionStatus: vi.fn(async (id, _expected, status) => makePlugin({ id, status })),
        updateStatus: vi.fn(async (id, status) => makePlugin({ id, status })),
      };

      const hostWith = {
        loadModule: vi.fn(async (p: Plugin) => {
          if (p.id === "p1") {
            return {
              activate: vi.fn(async () => undefined),
              deactivate: deactivateFn1,
            };
          }
          return {
            activate: vi.fn(async () => undefined),
            deactivate: deactivateFn2,
          };
        }),
      };

      const service = makeService({ pluginRepo: repoWith, host: hostWith });
      await service.activatePlugin("p1", "admin-1");
      await service.activatePlugin("p2", "admin-1");

      // Now shut down service: both should be invoked even if one throws
      await expect(service.shutdown()).resolves.toBeUndefined();
      expect(deactivateFn1).toHaveBeenCalledTimes(1);
      expect(deactivateFn2).toHaveBeenCalledTimes(1);
    });
  });
});
