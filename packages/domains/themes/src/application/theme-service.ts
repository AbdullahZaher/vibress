import {
  ThemeConfigurationRepository,
  ThemeConfiguration,
  ThemeDefinitionRegistry,
  ThemeNotFoundError,
  ThemeSettingsInvalidError,
} from "../domain/theme-configuration";
import {
  validateThemeManifest,
  validateThemeCompatibility,
  validateThemeSettings,
  mergeThemeSettings,
  ThemeManifest,
} from "@vibress/theme-core";

export class ThemeService {
  constructor(
    private repo: ThemeConfigurationRepository,
    private registry: ThemeDefinitionRegistry,
  ) {}

  async getActiveThemeConfiguration(): Promise<ThemeConfiguration | null> {
    return this.repo.getActive();
  }

  async getActiveTheme(): Promise<{
    manifest: ThemeManifest;
    settings: Record<string, unknown>;
  } | null> {
    const config = await this.repo.getActive();
    if (!config) return null;

    const definition = this.registry.get(config.themeId);
    if (!definition) return null;

    const settings = mergeThemeSettings(
      definition.settingsSchema,
      config.settings,
    );
    return {
      manifest: definition.manifest,
      settings,
    };
  }

  async activateTheme(
    themeId: string,
    actorId: string | null,
  ): Promise<ThemeConfiguration> {
    const definition = this.registry.get(themeId);
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

    return this.repo.setActive(config);
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

    const definition = this.registry.get(themeId);
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
}
