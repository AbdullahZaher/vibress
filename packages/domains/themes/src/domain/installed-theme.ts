import { ThemeManifest, ThemeSettingsSchema } from "@vibress/theme-core";

export type ThemeStatus = "installed" | "active" | "invalid";

export interface InstalledTheme {
  id: string;
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
  listAll(): Promise<InstalledTheme[]>;
  findById(id: string): Promise<InstalledTheme | null>;
  findByThemeId(themeId: string): Promise<InstalledTheme | null>;
  create(theme: InstalledTheme): Promise<InstalledTheme>;
  update(theme: InstalledTheme): Promise<InstalledTheme>;
  delete(themeId: string): Promise<void>;
}
