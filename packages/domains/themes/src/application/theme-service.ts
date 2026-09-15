import {
  ThemeConfigurationRepository,
  ThemeConfiguration,
  ThemeDefinitionRegistry,
  ThemeNotFoundError,
  ThemeSettingsInvalidError,
} from "../domain/theme-configuration";
import { InstalledThemeRepository } from "../domain/installed-theme";
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

import {
  PreviewTokenStore,
  MemoryPreviewTokenStore,
} from "../domain/preview-token-store";

export class ThemeService {
  private previewStore: PreviewTokenStore;

  constructor(
    private repo: ThemeConfigurationRepository,
    private registry: ThemeDefinitionRegistry,
    private installedRepo?: InstalledThemeRepository | undefined,
    private storageAdapter?: ThemeStorageAdapter | undefined,
    previewStore?: PreviewTokenStore | undefined,
  ) {
    this.previewStore = previewStore || new MemoryPreviewTokenStore();
  }

  async listThemes(publicationId?: string): Promise<UnifiedThemeSummary[]> {
    const active = await this.repo.getActive();
    const activeThemeId = active?.themeId || "vibress-default";

    const results: UnifiedThemeSummary[] = [];
    const seenIds = new Set<string>();

    // 1. Installed external themes (scoped to publication)
    if (this.installedRepo) {
      const installed = await this.installedRepo.listAll(publicationId);
      for (const t of installed) {
        if (!seenIds.has(t.themeId)) {
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
    }

    // 2. Built-in registry themes (system-wide)
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

  async getTheme(
    themeId: string,
    version?: string,
    publicationId?: string,
  ): Promise<{
    manifest: ThemeManifest;
    settingsSchema: ThemeSettingsSchema;
    isBuiltIn: boolean;
    previewImage?: string | null | undefined;
  } | null> {
    if (this.installedRepo) {
      const installed = version
        ? await this.installedRepo.findByThemeIdAndVersion(themeId, version, publicationId)
        : await this.installedRepo.findByThemeId(themeId, publicationId);
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

  async getActiveTheme(publicationId?: string): Promise<ActiveThemeResult | null> {
    const config = await this.repo.getActive();
    const activeThemeId = config?.themeId || "vibress-default";

    const definition = await this.getTheme(activeThemeId, config?.themeVersion, publicationId);
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
    version?: string,
    publicationId?: string,
  ): Promise<ThemeConfiguration> {
    const definition = await this.getTheme(themeId, version, publicationId);
    if (!definition) {
      throw new ThemeNotFoundError(themeId);
    }

    const manifest = validateThemeManifest(definition.manifest);
    validateThemeCompatibility(manifest);

    // Retrieve any previously saved settings for this theme identity
    let savedSettings: Record<string, unknown> | null = null;
    if (this.installedRepo) {
      savedSettings = await this.installedRepo.getThemeSettings(themeId, publicationId);
    }

    let settings: Record<string, unknown>;
    try {
      settings = mergeThemeSettings(definition.settingsSchema, savedSettings);
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

    // Update statuses in installed repo
    if (this.installedRepo) {
      const allInstalled = await this.installedRepo.listAll(publicationId);
      for (const inst of allInstalled) {
        const shouldBeActive =
          inst.themeId === themeId && inst.version === manifest.version;
        if (shouldBeActive && inst.status !== "active") {
          await this.installedRepo.update({ ...inst, status: "active" }, publicationId);
        } else if (!shouldBeActive && inst.status === "active") {
          await this.installedRepo.update({ ...inst, status: "installed" }, publicationId);
        }
      }
    }

    return saved;
  }

  async updateThemeSettings(
    themeId: string,
    input: Record<string, unknown>,
    _actorId: string | null,
    publicationId?: string,
  ): Promise<ThemeConfiguration> {
    const definition = await this.getTheme(themeId, undefined, publicationId);
    if (!definition) {
      throw new ThemeNotFoundError(themeId);
    }

    let settings: Record<string, unknown>;
    try {
      settings = validateThemeSettings(definition.settingsSchema, input);
    } catch (err) {
      throw new ThemeSettingsInvalidError((err as Error).message);
    }

    // Persist settings per theme identity
    if (this.installedRepo) {
      await this.installedRepo.saveThemeSettings(themeId, settings, publicationId);
    }

    const config = await this.repo.getActive();
    if (config && config.themeId === themeId) {
      return this.repo.setActive({
        ...config,
        settings,
        updatedAt: new Date(),
      });
    }

    return {
      id: "active",
      themeId,
      themeVersion: definition.manifest.version,
      settings,
      settingsSchemaVersion: definition.manifest.settingsSchemaVersion || 1,
      activatedBy: _actorId,
      activatedAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async uninstallTheme(
    themeId: string,
    _actorId: string | null,
    version?: string,
    publicationId?: string,
  ): Promise<{ success: boolean; themeId: string; version?: string }> {
    const active = await this.repo.getActive();
    if (active?.themeId === themeId && (!version || active.themeVersion === version)) {
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

    const installed = version
      ? await this.installedRepo.findByThemeIdAndVersion(themeId, version, publicationId)
      : await this.installedRepo.findByThemeId(themeId, publicationId);

    if (!installed) {
      throw new ThemeNotFoundError(themeId);
    }

    // Delete files from storage
    if (this.storageAdapter) {
      await this.storageAdapter.deleteThemeFiles(
        installed.themeId,
        installed.version,
      );
    }

    // Delete from DB
    if (version) {
      await this.installedRepo.deleteVersion(themeId, version, publicationId);
    } else {
      await this.installedRepo.delete(themeId, publicationId);
    }

    return {
      success: true,
      themeId,
      ...(version !== undefined ? { version } : {}),
    };
  }

  async createPreviewToken(themeId: string): Promise<{
    previewToken: string;
    expiresAt: string;
    themeId: string;
  }> {
    const token = crypto.randomBytes(32).toString("hex");
    const ttlSeconds = Math.floor(PREVIEW_TOKEN_TTL_MS / 1000);
    const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS;
    await this.previewStore.set(token, themeId, ttlSeconds);
    return {
      previewToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      themeId,
    };
  }

  async resolvePreviewToken(token: string): Promise<string | null> {
    return (await this.previewStore.get(token)) ?? null;
  }
}
