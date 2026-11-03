import { describe, it, expect, beforeEach } from "vitest";
import { ThemeService } from "../src/application/theme-service";
import {
  ThemeConfiguration,
  ThemeConfigurationRepository,
  ThemeDefinitionRegistry,
  ThemeNotFoundError,
  ThemeSettingsInvalidError,
} from "../src/domain/theme-configuration";
import {
  InstalledTheme,
  InstalledThemeRepository,
} from "../src/domain/installed-theme";
import { ThemeStorageAdapter } from "../src/domain/theme-storage";
import {
  defaultThemeManifest,
  defaultThemeSettingsSchema,
  minimalThemeManifest,
  minimalThemeSettingsSchema,
} from "@vibress/themes-registry";
import { ThemeError } from "@vibress/theme-core";
import type { TransactionRunner } from "@vibress/database";

const registry: ThemeDefinitionRegistry = {
  has: (id) => [defaultThemeManifest.id, minimalThemeManifest.id].includes(id),
  get: (id) => {
    if (id === defaultThemeManifest.id)
      return {
        manifest: defaultThemeManifest,
        settingsSchema: defaultThemeSettingsSchema,
      };
    if (id === minimalThemeManifest.id)
      return {
        manifest: minimalThemeManifest,
        settingsSchema: minimalThemeSettingsSchema,
      };
    return null;
  },
  list: () => [
    {
      manifest: defaultThemeManifest,
      settingsSchema: defaultThemeSettingsSchema,
    },
    {
      manifest: minimalThemeManifest,
      settingsSchema: minimalThemeSettingsSchema,
    },
  ],
  validate: (manifest: any) => manifest,
  checkCompatibility: (manifest: any) => {
    if (manifest.themeApi !== 1)
      throw new ThemeError("THEME_INCOMPATIBLE", "incompatible");
  },
};

class MemoryThemeRepo implements ThemeConfigurationRepository {
  private active = new Map<string, ThemeConfiguration>();
  writes: number[] = [];

  async getActive(publicationId = "pub_default"): Promise<ThemeConfiguration | null> {
    return this.active.get(publicationId) ?? null;
  }

  async setActive(config: ThemeConfiguration, publicationId = "pub_default"): Promise<ThemeConfiguration> {
    const saved = { ...config };
    this.active.set(publicationId, saved);
    this.writes.push(this.writes.length + 1);
    return saved;
  }

  async updateSettingsIfUnchanged(
    expected: ThemeConfiguration,
    settings: Record<string, unknown>,
    publicationId = "pub_default",
  ): Promise<ThemeConfiguration | null> {
    const current = await this.getActive(publicationId);
    if (!current || current.themeId !== expected.themeId ||
      current.themeVersion !== expected.themeVersion ||
      current.settingsSchemaVersion !== expected.settingsSchemaVersion ||
      JSON.stringify(current.settings) !== JSON.stringify(expected.settings)) return null;
    return this.setActive({ ...current, settings, updatedAt: new Date() }, publicationId);
  }
}

class MemoryInstalledThemeRepository implements InstalledThemeRepository {
  themes = new Map<string, InstalledTheme>();
  private settings = new Map<string, Record<string, unknown>>();
  sharedStorageReferences = false;
  sharedVersions = new Set<string>();

  async hasOtherPublicationStorageReferences(
    _themeId: string,
    version: string,
  ): Promise<boolean> {
    return this.sharedStorageReferences || this.sharedVersions.has(version);
  }

  async listAll(): Promise<InstalledTheme[]> {
    return Array.from(this.themes.values());
  }

  async findById(id: string): Promise<InstalledTheme | null> {
    return this.themes.get(id) || null;
  }

  async findByThemeId(themeId: string): Promise<InstalledTheme | null> {
    for (const t of this.themes.values()) {
      if (t.themeId === themeId) return t;
    }
    return null;
  }

  async findByThemeIdAndVersion(
    themeId: string,
    version: string,
  ): Promise<InstalledTheme | null> {
    for (const t of this.themes.values()) {
      if (t.themeId === themeId && t.version === version) return t;
    }
    return null;
  }

  async listVersions(themeId: string): Promise<InstalledTheme[]> {
    return Array.from(this.themes.values()).filter((t) => t.themeId === themeId);
  }

  async create(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async update(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async delete(themeId: string): Promise<void> {
    for (const [id, t] of Array.from(this.themes.entries())) {
      if (t.themeId === themeId) {
        this.themes.delete(id);
      }
    }
  }

  async deleteVersion(themeId: string, version: string): Promise<void> {
    for (const [id, t] of Array.from(this.themes.entries())) {
      if (t.themeId === themeId && t.version === version) {
        this.themes.delete(id);
      }
    }
  }

  async getThemeSettings(themeId: string, publicationId = "pub_default"): Promise<Record<string, unknown> | null> {
    return this.settings.get(`${publicationId}:${themeId}`) ?? null;
  }

  async saveThemeSettings(
    themeId: string,
    settings: Record<string, unknown>,
    publicationId = "pub_default",
  ): Promise<void> {
    this.settings.set(`${publicationId}:${themeId}`, settings);
  }
}

class MemoryThemeStorageAdapter implements ThemeStorageAdapter {
  deletedThemes: string[] = [];

  getThemeRootPath(themeId: string, version: string): string {
    return `content/themes/${themeId}/${version}`;
  }
  async saveThemeFiles(): Promise<string> {
    return "";
  }
  async getThemeFile(): Promise<Buffer | null> {
    return null;
  }
  async listThemeFiles(): Promise<string[]> {
    return [];
  }
  async getThemeFilesMap(): Promise<Map<string, string>> {
    return new Map();
  }
  async deleteThemeFiles(themeId: string): Promise<void> {
    this.deletedThemes.push(themeId);
  }
  async themeExists(): Promise<boolean> {
    return true;
  }
}

const noOpTransactionRunner: TransactionRunner = { run: (work) => work() };

describe("Theme Domain — Activation & Management", () => {
  let themeRepo: MemoryThemeRepo;
  let installedRepo: MemoryInstalledThemeRepository;
  let storageAdapter: MemoryThemeStorageAdapter;
  let service: ThemeService;

  beforeEach(() => {
    themeRepo = new MemoryThemeRepo();
    installedRepo = new MemoryInstalledThemeRepository();
    storageAdapter = new MemoryThemeStorageAdapter();
    service = new ThemeService(
      themeRepo,
      registry,
      installedRepo,
      storageAdapter,
      undefined,
      noOpTransactionRunner,
    );

    // Seed installed theme
    installedRepo.create({
      id: "installed-1",
      themeId: "custom-nordic",
      name: "Custom Nordic",
      version: "1.0.0",
      themeApiVersion: 1,
      manifest: {
        id: "custom-nordic",
        name: "Custom Nordic",
        version: "1.0.0",
        themeApi: 1,
        capabilities: [],
        settingsSchemaVersion: 1,
      },
      settingsSchema: {
        accentColor: { type: "color", default: "#5e81ac" },
      },
      storagePath: "content/themes/custom-nordic/1.0.0",
      status: "installed",
      isBuiltIn: false,
      installedAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("lists both built-in and installed external themes", async () => {
    const list = await service.listThemes();
    expect(list).toHaveLength(3); // 2 built-in + 1 external
    expect(list.some((t) => t.manifest.id === "custom-nordic")).toBe(true);
    expect(list.some((t) => t.manifest.id === "vibress-default")).toBe(true);
  });

  it("shows the active installed version in the theme catalog", async () => {
    const first = await installedRepo.findByThemeId("custom-nordic");
    if (!first) throw new Error("Missing seeded theme");
    await installedRepo.create({
      ...first,
      id: "installed-2",
      version: "2.0.0",
      manifest: { ...first.manifest, version: "2.0.0" },
      settingsSchema: { accentColor: { type: "color", default: "#222222" } },
      updatedAt: new Date(first.updatedAt.getTime() + 1000),
    });
    await service.activateTheme("custom-nordic", "user-1", "1.0.0");

    const catalog = await service.listThemes();
    const selected = catalog.find((t) => t.manifest.id === "custom-nordic");
    expect(selected?.manifest.version).toBe("1.0.0");
    expect(selected?.settingsSchema.accentColor?.default).toBe("#5e81ac");
  });

  it("activates an external theme and updates its status", async () => {
    const activated = await service.activateTheme("custom-nordic", "user-1");
    expect(activated.themeId).toBe("custom-nordic");
    expect(activated.settings.accentColor).toBe("#5e81ac");

    const installed = await installedRepo.findByThemeId("custom-nordic");
    expect(installed?.status).toBe("active");
  });

  it("persists custom settings per theme across activations", async () => {
    // 1. Activate Theme A and customize settings
    await service.activateTheme("custom-nordic", "user-1");
    await service.updateThemeSettings("custom-nordic", { accentColor: "#bf616a" }, "user-1");

    // 2. Switch to built-in default theme
    await service.activateTheme("vibress-default", "user-1");
    const activeDefault = await service.getActiveTheme();
    expect(activeDefault?.manifest.id).toBe("vibress-default");

    // 3. Switch back to custom-nordic -> accentColor must still be #bf616a!
    await service.activateTheme("custom-nordic", "user-1");
    const activeNordic = await service.getActiveTheme();
    expect(activeNordic?.manifest.id).toBe("custom-nordic");
    expect(activeNordic?.settings.accentColor).toBe("#bf616a");
  });

  it("loads defaults and persists inactive theme settings without switching themes", async () => {
    const definition = await service.getTheme("custom-nordic");
    expect(definition).not.toBeNull();
    if (!definition) throw new Error("Missing test theme");

    expect(await service.getThemeSettingsForEditor("custom-nordic", definition.settingsSchema))
      .toEqual({ accentColor: "#5e81ac" });

    await service.updateThemeSettings("custom-nordic", { accentColor: "#123abc" }, "user-1");
    expect(await service.getThemeSettingsForEditor("custom-nordic", definition.settingsSchema))
      .toEqual({ accentColor: "#123abc" });
    expect((await service.getActiveTheme())?.manifest.id).toBe("vibress-default");

    await service.activateTheme("custom-nordic", "user-1");
    expect((await service.getActiveTheme())?.settings.accentColor).toBe("#123abc");
  });

  it("publishes saved settings for implicit Default without inserting an activation row", async () => {
    const publicationId = "pub_fresh_1";
    expect(await themeRepo.getActive(publicationId)).toBeNull();
    expect((await service.getActiveTheme(publicationId))?.settings.accentColor).toBe("#f05230");

    const saved = await service.updateThemeSettings(
      "vibress-default",
      { accentColor: "#2468ac" },
      "editor-1",
      publicationId,
    );
    expect(saved.settings.accentColor).toBe("#2468ac");
    expect(await themeRepo.getActive(publicationId)).toBeNull();
    expect((await service.getActiveTheme(publicationId))?.settings.accentColor).toBe("#2468ac");
    expect((await service.getActiveTheme("pub_other"))?.settings.accentColor).toBe("#f05230");
    expect(await installedRepo.getThemeSettings("vibress-default", "pub_other")).toBeNull();
    // Multiple saves do not create activation rows or duplicate settings keys.
    await service.updateThemeSettings("vibress-default", { accentColor: "#13579b" }, "editor-1", publicationId);
    expect((await service.getActiveTheme(publicationId))?.settings.accentColor).toBe("#13579b");
    expect(await themeRepo.getActive(publicationId)).toBeNull();
  });

  it("keeps saved Default settings through switching to another theme and back", async () => {
    const pub = "pub_switch";
    await service.updateThemeSettings("vibress-default", { accentColor: "#2468ac" }, "editor", pub);
    await service.updateThemeSettings("vibress-minimal", { accentColor: "#abcdef" }, "editor", pub);
    expect((await service.getActiveTheme(pub))?.manifest.id).toBe("vibress-default");
    await service.activateTheme("vibress-minimal", "editor", undefined, pub);
    expect((await service.getActiveTheme(pub))?.settings.accentColor).toBe("#abcdef");
    await service.activateTheme("vibress-default", "editor", undefined, pub);
    expect((await service.getActiveTheme(pub))?.settings.accentColor).toBe("#2468ac");
  });

  it("rejects a stale active settings write without overwriting a different theme", async () => {
    const pub = "pub_race";
    await service.activateTheme("vibress-default", "editor", undefined, pub);
    const original = themeRepo.updateSettingsIfUnchanged.bind(themeRepo);
    themeRepo.updateSettingsIfUnchanged = async (expected, values, publicationId) => {
      await service.activateTheme("vibress-minimal", "editor", undefined, pub);
      return original(expected, values, publicationId);
    };
    await expect(service.updateThemeSettings("vibress-default", { accentColor: "#2468ac" }, "editor", pub))
      .rejects.toMatchObject({ code: "THEME_SETTINGS_CONFLICT" });
    expect((await service.getActiveTheme(pub))?.manifest.id).toBe("vibress-minimal");
  });

  it("rejects invalid settings inputs and non-existent themes", async () => {
    await expect(
      service.updateThemeSettings("custom-nordic", { accentColor: "not-a-color" }, "user-1"),
    ).rejects.toThrow(ThemeSettingsInvalidError);

    await expect(
      service.updateThemeSettings("non-existent-theme", { accentColor: "#123abc" }, "user-1"),
    ).rejects.toThrow(ThemeNotFoundError);
  });

  it("rejects a stale version precondition without persisting any settings", async () => {
    await expect(service.updateThemeSettings(
      "custom-nordic",
      { accentColor: "#112233" },
      "user-1",
      undefined,
      { themeVersion: "9.0.0", settingsSchemaVersion: 1 },
    )).rejects.toMatchObject({ code: "THEME_SETTINGS_CONFLICT" });
    expect(await installedRepo.getThemeSettings("custom-nordic")).toBeNull();
  });

  it("reports legacy storage only for an active external theme with an inherited path", async () => {
    await service.activateTheme("custom-nordic", "user-1", undefined, "pub_alpha");
    // A normal install is not authorized merely because its path looks legacy.
    expect((await service.getActiveTheme("pub_alpha"))?.legacyStorage).toBe(false);

    const installed = await installedRepo.findByThemeId("custom-nordic");
    if (!installed) throw new Error("Missing installed theme");
    installedRepo.themes.delete(installed.id);
    const migrated = {
      ...installed,
      id: `legacy_theme_${"a".repeat(32)}`,
      publicationId: "pub_alpha",
    };
    await installedRepo.create(migrated);
    expect((await service.getActiveTheme("pub_alpha"))?.legacyStorage).toBe(true);
    await installedRepo.update({
      ...migrated,
      storagePath: "content/themes/publications/pub_alpha/custom-nordic/1.0.0",
    });
    expect((await service.getActiveTheme("pub_alpha"))?.legacyStorage).toBe(false);

    await service.activateTheme("vibress-default", "user-1", undefined, "pub_alpha");
    expect((await service.getActiveTheme("pub_alpha"))?.legacyStorage).toBe(false);
  });

  it("uninstalls an external theme when not active", async () => {
    await service.activateTheme("vibress-default", "user-1");
    const result = await service.uninstallTheme("custom-nordic", "user-1");
    expect(result.success).toBe(true);
    expect(storageAdapter.deletedThemes).toContain("custom-nordic");
  });

  it("rejects removal when a migrated publication still uses legacy storage", async () => {
    await service.activateTheme("vibress-default", "user-1");
    installedRepo.sharedStorageReferences = true;

    await expect(service.uninstallTheme("custom-nordic", "user-1")).rejects.toThrow(
      /still used by other publications/,
    );
    expect(storageAdapter.deletedThemes).toEqual([]);
    expect(await installedRepo.findByThemeId("custom-nordic")).not.toBeNull();
  });

  it("checks every version before deleting an entire theme", async () => {
    await service.activateTheme("vibress-default", "user-1");
    const first = await installedRepo.findByThemeId("custom-nordic");
    if (!first) throw new Error("Missing installed theme fixture");
    await installedRepo.create({
      ...first,
      id: "installed-2",
      version: "2.0.0",
      storagePath: "content/themes/custom-nordic/2.0.0",
    });

    // Version 1 is safe, but version 2 is still shared with an upgraded
    // publication. Deleting without a version must inspect both.
    installedRepo.sharedVersions.add("2.0.0");
    await expect(service.uninstallTheme("custom-nordic", "user-1")).rejects.toThrow(
      /still used by other publications/,
    );

    expect(storageAdapter.deletedThemes).toEqual([]);
    expect(await installedRepo.listVersions("custom-nordic")).toHaveLength(2);
  });

  it("rejects uninstalling active theme", async () => {
    await service.activateTheme("custom-nordic", "user-1");
    await expect(
      service.uninstallTheme("custom-nordic", "user-1"),
    ).rejects.toThrow(/Cannot delete currently active theme/i);
  });

  it("rejects uninstalling built-in theme", async () => {
    await expect(
      service.uninstallTheme("vibress-default", "user-1"),
    ).rejects.toThrow(/Built-in system themes cannot be uninstalled/i);
  });

  it("creates and resolves publication-bound preview tokens", async () => {
    const { previewToken, themeId } = await service.createPreviewToken(
      "custom-nordic",
      "pub_alpha",
    );
    expect(previewToken).toBeDefined();
    expect(themeId).toBe("custom-nordic");

    const target = await service.resolvePreviewTarget(previewToken);
    expect(target).toEqual({
      themeId: "custom-nordic",
      publicationId: "pub_alpha",
    });

    // Preserve the existing domain contract for callers that need only themeId.
    const resolved = await service.resolvePreviewToken(previewToken);
    expect(resolved).toBe("custom-nordic");
  });

  it("resolves preview tokens across multiple instances sharing a Redis store", async () => {
    const sharedRedisState = new Map<string, string>();
    const mockRedis = {
      async set(key: string, value: string) {
        sharedRedisState.set(key, value);
      },
      async get(key: string) {
        return sharedRedisState.get(key) ?? null;
      },
      async del(key: string) {
        sharedRedisState.delete(key);
      },
    };

    const { RedisPreviewTokenStore } = await import("../src/domain/preview-token-store");
    const storeA = new RedisPreviewTokenStore(() => mockRedis);
    const storeB = new RedisPreviewTokenStore(() => mockRedis);

    const instanceA = new ThemeService(
      themeRepo,
      registry,
      installedRepo,
      storageAdapter,
      storeA,
    );
    const instanceB = new ThemeService(
      themeRepo,
      registry,
      installedRepo,
      storageAdapter,
      storeB,
    );

    // Create preview token on instance A
    const { previewToken } = await instanceA.createPreviewToken("custom-nordic");

    // Resolve preview token on instance B
    const resolvedOnB = await instanceB.resolvePreviewToken(previewToken);
    expect(resolvedOnB).toBe("custom-nordic");
  });
});
