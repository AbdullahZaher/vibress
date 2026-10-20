import { describe, it, expect, vi } from "vitest";
import { PluginsService } from "../src/application/plugins-service";
import type {
  Plugin, PluginRepository, PluginSettingRepository,
  PluginPublicationStateRepository,
} from "../src/domain/plugin";
import type { PluginModule } from "@vibress/plugin-sdk";
import { SDK_VERSION } from "@vibress/plugin-sdk";

const activePlugin: Plugin = {
  id: "p1",
  manifestId: "independent-courses",
  name: "Courses",
  description: null,
  version: "1.0.0",
  vibressApiVersion: SDK_VERSION,
  entrypoint: "index.mjs",
  capabilities: ["extension.routes.member"],
  hooks: [],
  settingsSchema: {},
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(
  overrides: Partial<Plugin> = {},
  enabled = true,
) {
  const plugin = { ...activePlugin, ...overrides };
  const handler = vi.fn(async () => undefined);
  const module: PluginModule = { activate: handler };
  const repo: PluginRepository = {
    create: vi.fn(async () => plugin),
    findById: vi.fn(async () => plugin),
    findByManifestId: vi.fn(async () => plugin),
    updateStatus: vi.fn(async () => plugin),
    tryTransitionStatus: vi.fn(async () => plugin),
    updateMetadata: vi.fn(async () => plugin),
    list: vi.fn(async () => [plugin]),
    delete: vi.fn(async () => undefined),
  };
  const settings: PluginSettingRepository = {
    set: vi.fn(async () => undefined),
    listForPlugin: vi.fn(async () => []),
    getSecret: vi.fn(async () => null),
  };
  const state: PluginPublicationStateRepository = {
    hasAnyState: vi.fn(async () => enabled),
    isEnabled: vi.fn(async (_id, publicationId) => enabled && publicationId === "pub-a"),
    setEnabled: vi.fn(async () => undefined),
  };
  const host = {
    loadModule: vi.fn(async () => module),
    requiresPublicationEnablement: vi.fn(() => true),
  };
  return {
    service: new PluginsService(repo, settings, host, state),
    host, state, repo, handler,
  };
}

describe("EXT-202 route admission and publication state", () => {
  it("admits only an active enabled external plugin in its own publication", async () => {
    const { service, host, handler } = setup();
    expect(await service.resolveExtensionApiModule(
      "independent-courses", "pub-a", "extension.routes.member",
    )).toBeTruthy();
    expect(host.loadModule).toHaveBeenCalledTimes(1);
    // Merely reading the descriptor never executes a plugin.
    expect(handler).not.toHaveBeenCalled();
    const module = await service.resolveExtensionApiModule(
      "independent-courses", "pub-a", "extension.routes.member",
    );
    expect(module).not.toBeNull();
    if (!module) throw new Error("Expected admitted module");
    expect(await service.prepareExtensionApiExecution(
      "independent-courses", "pub-a", "extension.routes.member", module,
    )).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(service.resolveExtensionApiModule(
      "independent-courses", "pub-b", "extension.routes.member",
    )).rejects.toMatchObject({ code: "PLUGIN_PUBLICATION_INACTIVE" });
    await service.shutdown();
  });

  it("never loads a missing capability or globally active legacy bundle", async () => {
    const { service, host } = setup();
    expect(await service.resolveExtensionApiModule(
      "independent-courses", "pub-a", "extension.routes.admin",
    )).toBeNull();
    expect(host.loadModule).not.toHaveBeenCalled();
    const legacy = setup();
    legacy.host.requiresPublicationEnablement.mockReturnValue(false);
    expect(await legacy.service.resolveExtensionApiModule(
      "independent-courses", "pub-a", "extension.routes.member",
    )).toBeNull();
    expect(legacy.host.loadModule).not.toHaveBeenCalled();
  });

  it("rejects an inactive or disabled plugin before any code executes", async () => {
    const inactive = setup({ status: "inactive" });
    expect(await inactive.service.resolveExtensionApiModule(
      "independent-courses", "pub-a", "extension.routes.member",
    )).toBeNull();
    expect(inactive.host.loadModule).not.toHaveBeenCalled();
    const disabled = setup({}, false);
    await expect(disabled.service.resolveExtensionApiModule(
      "independent-courses", "pub-a", "extension.routes.member",
    )).rejects.toMatchObject({ code: "PLUGIN_PUBLICATION_INACTIVE" });
    expect(disabled.host.loadModule).not.toHaveBeenCalled();
  });

  it("rejects deactivation after route resolution but before initialization", async () => {
    const current = setup();
    const module = await current.service.resolveExtensionApiModule(
      "independent-courses", "pub-a", "extension.routes.member",
    );
    expect(module).not.toBeNull();
    if (!module) throw new Error("Expected admitted module");
    vi.mocked(current.repo.findByManifestId).mockResolvedValue({
      ...activePlugin, status: "inactive",
    });
    expect(await current.service.prepareExtensionApiExecution(
      "independent-courses", "pub-a", "extension.routes.member", module,
    )).toBe(false);
    expect(current.handler).not.toHaveBeenCalled();
    await current.service.shutdown();
  });
});
