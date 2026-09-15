import { ThemeManifest, ThemeSettingsSchema } from "@vibress/theme-core";

export type ThemeStatus = "installed" | "active" | "invalid";

export interface InstalledTheme {
  id: string;
  publicationId: string;
  themeId: string;
  name: string;
  version: string;
  themeApiVersion: number;
  description?: string | null | undefined;
  author?: string | null | undefined;
  previewImage?: string | null | undefined;
  manifest: ThemeManifest;
  settingsSchema: ThemeSettingsSchema;
  storagePath: string;
  status: ThemeStatus;
  isBuiltIn: boolean;
  installedAt: Date;
  updatedAt: Date;
}

export interface InstalledThemeRepository {
  listAll(publicationId?: string): Promise<InstalledTheme[]>;
  findById(id: string, publicationId?: string): Promise<InstalledTheme | null>;
  findByThemeId(themeId: string, publicationId?: string): Promise<InstalledTheme | null>;
  findByThemeIdAndVersion(
    themeId: string,
    version: string,
    publicationId?: string,
  ): Promise<InstalledTheme | null>;
  listVersions(themeId: string, publicationId?: string): Promise<InstalledTheme[]>;
  create(theme: InstalledTheme, publicationId?: string): Promise<InstalledTheme>;
  update(theme: InstalledTheme, publicationId?: string): Promise<InstalledTheme>;
  delete(themeId: string, publicationId?: string): Promise<void>;
  deleteVersion(themeId: string, version: string, publicationId?: string): Promise<void>;
  getThemeSettings(themeId: string, publicationId?: string): Promise<Record<string, unknown> | null>;
  saveThemeSettings(
    themeId: string,
    settings: Record<string, unknown>,
    publicationId?: string,
  ): Promise<void>;
}
