import { describe, it, expect, beforeEach } from "vitest";
import { ThemeService } from "../src/application/theme-service";
import {
  ThemeConfiguration,
  ThemeConfigurationRepository,
  ThemeDefinitionRegistry,
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
  private active: ThemeConfiguration | null = null;
  writes: number[] = [];

  async getActive(): Promise<ThemeConfiguration | null> {
    return this.active;
  }

  async setActive(config: ThemeConfiguration): Promise<ThemeConfiguration> {
    this.active = { ...config };
    this.writes.push(this.writes.length + 1);
    return this.active;
  }
}

class MemoryInstalledThemeRepository implements InstalledThemeRepository {
  themes = new Map<string, InstalledTheme>();
  private settings = new Map<string, Record<string, unknown>>();

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

  async getThemeSettings(themeId: string): Promise<Record<string, unknown> | null> {
    return this.settings.get(themeId) || null;
  }

  async saveThemeSettings(
    themeId: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    this.settings.set(themeId, settings);
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

  it("uninstalls an external theme when not active", async () => {
    await service.activateTheme("vibress-default", "user-1");
    const result = await service.uninstallTheme("custom-nordic", "user-1");
    expect(result.success).toBe(true);
    expect(storageAdapter.deletedThemes).toContain("custom-nordic");
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

  it("creates and resolves preview tokens", async () => {
    const { previewToken, themeId } = await service.createPreviewToken("custom-nordic");
    expect(previewToken).toBeDefined();
    expect(themeId).toBe("custom-nordic");

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
