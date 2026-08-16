import {
  ThemeConfigurationRepository,
  ThemeConfiguration,
  ThemeDefinitionRegistry,
  ThemeNotFoundError,
  ThemeSettingsInvalidError,
} from "../domain/theme-configuration";
import {
  InstalledThemeRepository,
  InstalledTheme,
} from "../domain/installed-theme";
import { ThemeStorageAdapter } from "../domain/theme-storage";
import {
  validateThemeManifest,
  validateThemeCompatibility,
  validateThemeSettings,
  mergeThemeSettings,
  ThemeManifest,
  ThemeSettingsSchema,
  ThemeError,
} from "@vibress/theme-core";
import crypto from "node:crypto";

export interface UnifiedThemeSummary {
  manifest: ThemeManifest;
  settingsSchema: ThemeSettingsSchema;
  isActive: boolean;
  isBuiltIn: boolean;
  previewImage?: string | null | undefined;
}

export interface ActiveThemeResult {
  manifest: ThemeManifest;
  settings: Record<string, unknown>;
  isBuiltIn: boolean;
  previewImage?: string | null | undefined;
}

const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class ThemeService {
  private previewTokens = new Map<
    string,
    { themeId: string; expiresAt: number }
  >();

  constructor(
    private repo: ThemeConfigurationRepository,
    private registry: ThemeDefinitionRegistry,
    private installedRepo?: InstalledThemeRepository | undefined,
    private storageAdapter?: ThemeStorageAdapter | undefined,
  ) {}

  async listThemes(): Promise<UnifiedThemeSummary[]> {
    const active = await this.repo.getActive();
    const activeThemeId = active?.themeId || "vibress-default";

    const results: UnifiedThemeSummary[] = [];
    const seenIds = new Set<string>();

    // 1. Installed external themes
    if (this.installedRepo) {
      const installed = await this.installedRepo.listAll();
      for (const t of installed) {
        seenIds.add(t.themeId);
        results.push({
          manifest: t.manifest,
          settingsSchema: t.settingsSchema,
          isActive: t.themeId === activeThemeId,
          isBuiltIn: false,
          previewImage: t.previewImage,
        });
      }
    }

    // 2. Built-in registry themes
    const builtIn = this.registry.list();
    for (const t of builtIn) {
      if (!seenIds.has(t.manifest.id)) {
        seenIds.add(t.manifest.id);
        results.push({
          manifest: t.manifest,
          settingsSchema: t.settingsSchema,
          isActive: t.manifest.id === activeThemeId,
          isBuiltIn: true,
          previewImage: t.manifest.previewImage || undefined,
        });
      }
    }

    return results;
  }

  async getTheme(themeId: string): Promise<{
    manifest: ThemeManifest;
    settingsSchema: ThemeSettingsSchema;
    isBuiltIn: boolean;
    previewImage?: string | null | undefined;
  } | null> {
    if (this.installedRepo) {
      const installed = await this.installedRepo.findByThemeId(themeId);
      if (installed) {
        return {
          manifest: installed.manifest,
          settingsSchema: installed.settingsSchema,
          isBuiltIn: false,
          previewImage: installed.previewImage,
        };
      }
    }

    const builtIn = this.registry.get(themeId);
    if (builtIn) {
      return {
        manifest: builtIn.manifest,
        settingsSchema: builtIn.settingsSchema,
        isBuiltIn: true,
        previewImage: builtIn.manifest.previewImage || undefined,
      };
    }

    return null;
  }

  async getActiveThemeConfiguration(): Promise<ThemeConfiguration | null> {
    return this.repo.getActive();
  }

  async getActiveTheme(): Promise<ActiveThemeResult | null> {
    const config = await this.repo.getActive();
    const activeThemeId = config?.themeId || "vibress-default";

    const definition = await this.getTheme(activeThemeId);
    if (!definition) return null;

    const settings = mergeThemeSettings(
      definition.settingsSchema,
      config?.settings,
    );

    return {
      manifest: definition.manifest,
      settings,
      isBuiltIn: definition.isBuiltIn,
      previewImage: definition.previewImage,
    };
  }

  async activateTheme(
    themeId: string,
    actorId: string | null,
  ): Promise<ThemeConfiguration> {
    const definition = await this.getTheme(themeId);
    if (!definition) {
      throw new ThemeNotFoundError(themeId);
    }

    const manifest = validateThemeManifest(definition.manifest);
    validateThemeCompatibility(manifest);

    let settings: Record<string, unknown>;
    try {
      settings = validateThemeSettings(definition.settingsSchema, {});
    } catch (err) {
      throw new ThemeSettingsInvalidError((err as Error).message);
    }

    const config: ThemeConfiguration = {
      id: "active",
      themeId: manifest.id,
      themeVersion: manifest.version,
      settings,
      settingsSchemaVersion: manifest.settingsSchemaVersion || 1,
      activatedBy: actorId,
      activatedAt: new Date(),
      updatedAt: new Date(),
    };

    const saved = await this.repo.setActive(config);

    // If external theme, update status in installed repo
    if (this.installedRepo && !definition.isBuiltIn) {
      const installed = await this.installedRepo.findByThemeId(themeId);
      if (installed) {
        await this.installedRepo.update({
          ...installed,
          status: "active",
        });
      }
    }

    return saved;
  }

  async updateThemeSettings(
    themeId: string,
    input: Record<string, unknown>,
    _actorId: string | null,
  ): Promise<ThemeConfiguration> {
    const config = await this.repo.getActive();
    if (!config || config.themeId !== themeId) {
      throw new ThemeNotFoundError(themeId);
    }

    const definition = await this.getTheme(themeId);
    if (!definition) {
      throw new ThemeNotFoundError(themeId);
    }

    let settings: Record<string, unknown>;
    try {
      settings = validateThemeSettings(definition.settingsSchema, input);
    } catch (err) {
      throw new ThemeSettingsInvalidError((err as Error).message);
    }

    return this.repo.setActive({
      ...config,
      settings,
      updatedAt: new Date(),
    });
  }

  async uninstallTheme(
    themeId: string,
    _actorId: string | null,
  ): Promise<{ success: boolean; themeId: string }> {
    const active = await this.repo.getActive();
    if (active?.themeId === themeId) {
      throw new ThemeError(
        "THEME_ACTIVE_CANNOT_BE_DELETED",
        "Cannot delete currently active theme. Please activate another theme first.",
      );
    }

    // Check if built-in
    if (this.registry.has(themeId)) {
      throw new ThemeError(
        "THEME_BUILTIN_CANNOT_BE_UNINSTALLED",
        "Built-in system themes cannot be uninstalled.",
      );
    }

    if (!this.installedRepo) {
      throw new ThemeNotFoundError(themeId);
    }

    const installed = await this.installedRepo.findByThemeId(themeId);
    if (!installed) {
      throw new ThemeNotFoundError(themeId);
    }

    // Delete files from storage
    if (this.storageAdapter) {
      await this.storageAdapter.deleteThemeFiles(installed.themeId, installed.version);
    }

    // Delete from DB
    await this.installedRepo.delete(themeId);

    return { success: true, themeId };
  }

  createPreviewToken(themeId: string): {
    previewToken: string;
    expiresAt: string;
    themeId: string;
  } {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS;
    this.previewTokens.set(token, { themeId, expiresAt });
    return {
      previewToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      themeId,
    };
  }

  resolvePreviewToken(token: string): string | null {
    const entry = this.previewTokens.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.previewTokens.delete(token);
      return null;
    }
    return entry.themeId;
  }
}
