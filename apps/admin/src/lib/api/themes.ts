import { apiRequest } from "./client";

export interface ApiThemeManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  themeApi: number;
  capabilities: string[];
  settingsSchemaVersion: number;
}

export interface ApiThemeSummary {
  manifest: ApiThemeManifest;
  settingsSchema: Record<string, ApiThemeSettingDefinition>;
  isActive: boolean;
}

export interface ApiThemeSettingDefinition {
  type: "string" | "boolean" | "number" | "color" | "select";
  default?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: string[];
}

export interface ApiActiveTheme {
  themeId: string;
  themeVersion: string;
  settings: Record<string, unknown>;
  settingsSchemaVersion: number;
}

export async function listThemesApi(): Promise<{ themes: ApiThemeSummary[] }> {
  return apiRequest("/themes");
}

export async function getActiveThemeApi(): Promise<{
  themeId: string;
  themeVersion: string;
  settings: Record<string, unknown>;
  settingsSchemaVersion: number;
}> {
  return apiRequest("/themes/active");
}

export async function activateThemeApi(
  id: string,
): Promise<{ theme: ApiActiveTheme }> {
  return apiRequest(`/themes/${id}/activate`, { method: "POST" });
}

export async function updateThemeSettingsApi(
  id: string,
  settings: Record<string, unknown>,
): Promise<{ theme: ApiActiveTheme }> {
  return apiRequest(`/themes/${id}/settings`, {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export async function createThemePreviewApi(
  id: string,
): Promise<{ previewToken: string; expiresAt: string; themeId: string }> {
  return apiRequest(`/themes/${id}/preview`, { method: "POST" });
}
