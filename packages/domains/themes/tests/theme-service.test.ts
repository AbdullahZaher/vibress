import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeService } from "../src/application/theme-service";
import {
  ThemeConfiguration,
  ThemeConfigurationRepository,
  ThemeDefinitionRegistry,
} from "../src/domain/theme-configuration";
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
  validate: (manifest: unknown) => {
    if (typeof manifest === "object" && manifest && (manifest as any).id)
      return manifest as any;
    throw new ThemeError("THEME_INVALID", "invalid");
  },
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

describe("Theme Domain — Activation & Settings", () => {
  let repo: MemoryThemeRepo;
  let service: ThemeService;

  beforeEach(() => {
    repo = new MemoryThemeRepo();
    service = new ThemeService(repo, registry);
  });

  it("activates a registered theme atomically", async () => {
    const config = await service.activateTheme("vibress-minimal", "actor-1");
    expect(config.themeId).toBe("vibress-minimal");
    expect(config.themeVersion).toBe("1.0.0");
    expect(config.activatedBy).toBe("actor-1");
    expect(repo.writes).toHaveLength(1);
  });

  it("rejects unknown theme and retains previous active theme", async () => {
    await service.activateTheme("vibress-default", "actor-1");

    await expect(
      service.activateTheme("does-not-exist", "actor-1"),
    ).rejects.toThrow(ThemeError);

    const stillActive = await service.getActiveThemeConfiguration();
    expect(stillActive?.themeId).toBe("vibress-default");
    expect(repo.writes).toHaveLength(1); // no write for failed activation
  });

  it("rejects incompatible theme API version", async () => {
    const badRegistry: ThemeDefinitionRegistry = {
      ...registry,
      get: () => ({
        manifest: { ...minimalThemeManifest, themeApi: 999 },
        settingsSchema: minimalThemeSettingsSchema,
      }),
      checkCompatibility: (manifest: any) => {
        if (manifest.themeApi !== 1)
          throw new ThemeError("THEME_INCOMPATIBLE", "incompatible");
      },
    };
    const badService = new ThemeService(repo, badRegistry);
    await service.activateTheme("vibress-default", "actor-1");

    await expect(
      badService.activateTheme("vibress-minimal", "actor-1"),
    ).rejects.toThrow(ThemeError);
    const stillActive = await service.getActiveThemeConfiguration();
    expect(stillActive?.themeId).toBe("vibress-default");
  });

  it("updates settings with validation and rejects invalid values", async () => {
    await service.activateTheme("vibress-minimal", "actor-1");

    const updated = await service.updateThemeSettings(
      "vibress-minimal",
      { accentColor: "#123456" },
      "actor-1",
    );
    expect(updated.settings.accentColor).toBe("#123456");

    await expect(
      service.updateThemeSettings(
        "vibress-minimal",
        { accentColor: "javascript:evil" },
        "actor-1",
      ),
    ).rejects.toThrow(ThemeError);

    await expect(
      service.updateThemeSettings(
        "vibress-minimal",
        { notASetting: true },
        "actor-1",
      ),
    ).rejects.toThrow(ThemeError);
  });

  it("returns null active theme when none configured", async () => {
    const active = await service.getActiveTheme();
    expect(active).toBeNull();
  });

  it("returns null active theme when persisted theme id is unknown (fallback path)", async () => {
    const weirdRepo = new MemoryThemeRepo();
    await weirdRepo.setActive({
      id: "active",
      themeId: "does-not-exist",
      themeVersion: "1.0.0",
      settings: {},
      settingsSchemaVersion: 1,
      activatedBy: null,
      activatedAt: new Date(),
      updatedAt: new Date(),
    });
    const weirdService = new ThemeService(weirdRepo, registry);
    const active = await weirdService.getActiveTheme();
    expect(active).toBeNull();
  });

  it("uses defaults when settings schema introduced new keys", async () => {
    await service.activateTheme("vibress-default", "actor-1");
    const active = await service.getActiveTheme();
    expect(active?.settings.showAuthor).toBe(true);
    expect(active?.settings.contentWidth).toBe(800);
  });
});
