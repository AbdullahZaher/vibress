import { apiRequest } from "./client";

export interface ApiThemeManifest {
  id: string;
  name: string;
  version: string;
  description?: string | undefined;
  author?: (string | { name: string; email?: string | undefined; url?: string | undefined }) | undefined;
  homepage?: string | undefined;
  license?: string | undefined;
  previewImage?: string | undefined;
  themeApi: number;
  capabilities: string[];
  settingsSchemaVersion: number;
}

export interface ApiThemeSettingDefinition {
  type: "string" | "boolean" | "number" | "color" | "select";
  label?: string | undefined;
  description?: string | undefined;
  default?: unknown;
  min?: number | undefined;
  max?: number | undefined;
  maxLength?: number | undefined;
  options?: (Array<{ label: string; value: string }> | string[]) | undefined;
}

export interface ApiThemeSummary {
  manifest: ApiThemeManifest;
  settingsSchema: Record<string, ApiThemeSettingDefinition>;
  isActive: boolean;
  isBuiltIn?: boolean | undefined;
  previewImage?: string | null | undefined;
}

export interface ApiActiveTheme {
  themeId: string;
  themeVersion: string;
  settings: Record<string, unknown>;
  settingsSchemaVersion: number;
  isBuiltIn?: boolean | undefined;
  previewImage?: string | null | undefined;
}

export async function listThemesApi(): Promise<{ themes: ApiThemeSummary[] }> {
  return apiRequest("/themes");
}

export async function getActiveThemeApi(): Promise<{
  themeId: string;
  themeVersion: string;
  settings: Record<string, unknown>;
  settingsSchemaVersion: number;
  isBuiltIn?: boolean | undefined;
  previewImage?: string | null | undefined;
}> {
  return apiRequest("/themes/active");
}

export async function uploadThemeApi(
  file: File,
): Promise<{ theme: ApiThemeSummary }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/admin/v1/themes/upload", {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
    },
    body: formData,
    credentials: "same-origin",
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const message =
      errorData.errors?.[0]?.message || `Upload failed with status ${res.status}`;
    throw new Error(message);
  }

  return res.json();
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

export async function deleteThemeApi(
  id: string,
): Promise<{ success: boolean; themeId: string }> {
  return apiRequest(`/themes/${id}`, { method: "DELETE" });
}

export async function createThemePreviewApi(
  id: string,
): Promise<{ previewToken: string; expiresAt: string; themeId: string }> {
  return apiRequest(`/themes/${id}/preview`, { method: "POST" });
}
