import { headers } from "next/headers";
import {
  getTheme,
  getFallbackTheme,
} from "../themes/registry";
import type { VibressThemeDefinition } from "../themes/types";

export interface ThemeHostState {
  themeId: string;
  themeVersion: string;
  isBuiltIn: boolean;
  theme: VibressThemeDefinition;
  settings: Record<string, unknown>;
  isPreview: boolean;
}

export interface ActiveThemeInfo {
  themeId: string;
  themeVersion?: string;
  isBuiltIn?: boolean;
  settings: Record<string, unknown>;
  manifest?: Record<string, unknown>;
}

export async function fetchActiveThemeInfo(): Promise<ActiveThemeInfo | null> {
  const baseUrl = process.env.API_URL || "http://127.0.0.1:7780";
  let hostHeader: string | undefined;
  try {
    const hs = await headers();
    hostHeader = hs.get("x-forwarded-host") || hs.get("host") || undefined;
  } catch {
    // Headers unavailable in static/fallback context
  }

  try {
    const res = await fetch(`${baseUrl}/api/content/v1/site`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(hostHeader ? { "x-forwarded-host": hostHeader } : {}),
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.theme || null;
  } catch {
    return null;
  }
}

export async function resolveThemeHostState(
  isPreview = false,
  previewThemeId?: string | null,
): Promise<ThemeHostState> {
  let activeThemeId = "vibress-default";
  let activeThemeVersion = "1.0.0";
  let isBuiltIn = true;
  let settings: Record<string, unknown> = {};

  const info = await fetchActiveThemeInfo();
  if (info && typeof info.themeId === "string") {
    activeThemeId = info.themeId;
    activeThemeVersion = info.themeVersion || "1.0.0";
    isBuiltIn = info.isBuiltIn ?? (getTheme(info.themeId) !== null);
    settings = info.settings || {};
  }

  if (isPreview && previewThemeId) {
    activeThemeId = previewThemeId;
    isBuiltIn = getTheme(previewThemeId) !== null;
  }

  const builtinTheme = getTheme(activeThemeId) || getFallbackTheme();

  // Merge theme defaults over persisted settings
  const merged: Record<string, unknown> = {};
  if (builtinTheme) {
    for (const [key, def] of Object.entries(builtinTheme.settingsSchema)) {
      merged[key] = def.default;
    }
  }
  for (const [key, value] of Object.entries(settings)) {
    merged[key] = value;
  }

  return {
    themeId: activeThemeId,
    themeVersion: activeThemeVersion,
    isBuiltIn,
    theme: builtinTheme,
    settings: merged,
    isPreview,
  };
}

export * from "./site-settings";

