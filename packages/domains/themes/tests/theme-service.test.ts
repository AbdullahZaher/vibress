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

  async create(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async update(theme: InstalledTheme): Promise<InstalledTheme> {
    this.themes.set(theme.id, theme);
    return theme;
  }

  async delete(themeId: string): Promise<void> {
    for (const [id, t] of this.themes.entries()) {
      if (t.themeId === themeId) {
        this.themes.delete(id);
      }
    }
  }
}

class MemoryThemeStorageAdapter implements ThemeStorageAdapter {
  deleted: string[] = [];

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
    this.deleted.push(themeId);
  }
  async themeExists(): Promise<boolean> {
    return false;
  }
}

describe("Theme Domain — Activation & Management", () => {
  let repo: MemoryThemeRepo;
  let installedRepo: MemoryInstalledThemeRepository;
  let storageAdapter: MemoryThemeStorageAdapter;
  let service: ThemeService;

  beforeEach(() => {
    repo = new MemoryThemeRepo();
    installedRepo = new MemoryInstalledThemeRepository();
    storageAdapter = new MemoryThemeStorageAdapter();
    service = new ThemeService(repo, registry, installedRepo, storageAdapter);
  });

  it("lists both built-in and installed external themes", async () => {
    await installedRepo.create({
      id: "inst-1",
      themeId: "vibress-custom",
      name: "Custom Theme",
      version: "1.0.0",
      themeApiVersion: 1,
      manifest: {
        id: "vibress-custom",
        name: "Custom Theme",
        version: "1.0.0",
        themeApi: 1,
        capabilities: ["post", "page"],
        settingsSchemaVersion: 1,
      },
      settingsSchema: {
        accentColor: { type: "color", default: "#abcdef" },
      },
      storagePath: "content/themes/vibress-custom/1.0.0",
      status: "installed",
      isBuiltIn: false,
      installedAt: new Date(),
      updatedAt: new Date(),
    });

    const themes = await service.listThemes();
    expect(themes).toHaveLength(3); // 2 built-in + 1 external
    const custom = themes.find((t) => t.manifest.id === "vibress-custom");
    expect(custom).toBeDefined();
    expect(custom?.isBuiltIn).toBe(false);

    const builtInDefault = themes.find((t) => t.manifest.id === "vibress-default");
    expect(builtInDefault).toBeDefined();
    expect(builtInDefault?.isBuiltIn).toBe(true);
  });

  it("activates an external theme and updates its status", async () => {
    await installedRepo.create({
      id: "inst-1",
      themeId: "vibress-custom",
      name: "Custom Theme",
      version: "1.0.0",
      themeApiVersion: 1,
      manifest: {
        id: "vibress-custom",
        name: "Custom Theme",
        version: "1.0.0",
        themeApi: 1,
        capabilities: ["post", "page"],
        settingsSchemaVersion: 1,
      },
      settingsSchema: {
        accentColor: { type: "color", default: "#abcdef" },
      },
      storagePath: "content/themes/vibress-custom/1.0.0",
      status: "installed",
      isBuiltIn: false,
      installedAt: new Date(),
      updatedAt: new Date(),
    });

    const config = await service.activateTheme("vibress-custom", "actor-1");
    expect(config.themeId).toBe("vibress-custom");

    const updatedInstalled = await installedRepo.findByThemeId("vibress-custom");
    expect(updatedInstalled?.status).toBe("active");
  });

  it("uninstalls an external theme when not active", async () => {
    await installedRepo.create({
      id: "inst-1",
      themeId: "vibress-custom",
      name: "Custom Theme",
      version: "1.0.0",
      themeApiVersion: 1,
      manifest: {
        id: "vibress-custom",
        name: "Custom Theme",
        version: "1.0.0",
        themeApi: 1,
        capabilities: ["post", "page"],
        settingsSchemaVersion: 1,
      },
      settingsSchema: {},
      storagePath: "content/themes/vibress-custom/1.0.0",
      status: "installed",
      isBuiltIn: false,
      installedAt: new Date(),
      updatedAt: new Date(),
    });

    await service.activateTheme("vibress-default", "actor-1");

    const res = await service.uninstallTheme("vibress-custom", "actor-1");
    expect(res.success).toBe(true);

    const found = await installedRepo.findByThemeId("vibress-custom");
    expect(found).toBeNull();
    expect(storageAdapter.deleted).toContain("vibress-custom");
  });

  it("rejects uninstalling active theme", async () => {
    await service.activateTheme("vibress-minimal", "actor-1");
    await expect(service.uninstallTheme("vibress-minimal", "actor-1")).rejects.toThrow(
      /Cannot delete currently active theme/i,
    );
  });

  it("rejects uninstalling built-in theme", async () => {
    await service.activateTheme("vibress-default", "actor-1");
    await expect(service.uninstallTheme("vibress-minimal", "actor-1")).rejects.toThrow(
      /Built-in system themes cannot be uninstalled/i,
    );
  });

  it("creates and resolves preview tokens", () => {
    const { previewToken, themeId } = service.createPreviewToken("vibress-minimal");
    expect(previewToken).toBeDefined();
    expect(themeId).toBe("vibress-minimal");

    const resolved = service.resolvePreviewToken(previewToken);
    expect(resolved).toBe("vibress-minimal");

    const invalid = service.resolvePreviewToken("non-existent-token");
    expect(invalid).toBeNull();
  });
});
