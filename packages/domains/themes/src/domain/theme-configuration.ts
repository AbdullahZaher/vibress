import { ThemeManifest, ThemeSettingsSchema, ThemeError, THEME_API_VERSION } from '@vibress/theme-core';

export interface ThemeConfiguration {
  id: string;
  themeId: string;
  themeVersion: string;
  settings: Record<string, unknown>;
  settingsSchemaVersion: number;
  activatedBy: string | null;
  activatedAt: Date;
  updatedAt: Date;
}

export interface ThemeConfigurationRepository {
  getActive(): Promise<ThemeConfiguration | null>;
  setActive(config: ThemeConfiguration): Promise<ThemeConfiguration>;
}

export interface ThemeDefinitionRegistry {
  has(id: string): boolean;
  get(id: string): { manifest: ThemeManifest; settingsSchema: ThemeSettingsSchema } | null;
  list(): Array<{ manifest: ThemeManifest; settingsSchema: ThemeSettingsSchema }>;
  validate(manifest: unknown): ThemeManifest;
  checkCompatibility(manifest: ThemeManifest): void;
}

export interface ThemeSettingsValidator {
  validateSettings(schema: ThemeSettingsSchema, input: Record<string, unknown>): Record<string, unknown>;
  mergeSettings(schema: ThemeSettingsSchema, stored: Record<string, unknown> | null | undefined): Record<string, unknown>;
}

export class ThemeNotFoundError extends ThemeError {
  constructor(themeId: string) {
    super('THEME_NOT_FOUND', `Theme not found: ${themeId}`);
  }
}

export class ThemeInvalidError extends ThemeError {
  constructor(message: string) {
    super('THEME_INVALID', message);
  }
}

export class ThemeIncompatibleError extends ThemeError {
  constructor(themeId: string, actualApi: number) {
    super('THEME_INCOMPATIBLE', `Theme ${themeId} uses API version ${actualApi}, required ${THEME_API_VERSION}`);
  }
}

export class ThemeSettingsInvalidError extends ThemeError {
  constructor(message: string) {
    super('THEME_SETTINGS_INVALID', message);
  }
}

export class ThemeActivationFailedError extends ThemeError {
  constructor(message: string) {
    super('THEME_ACTIVATION_FAILED', message);
  }
}
