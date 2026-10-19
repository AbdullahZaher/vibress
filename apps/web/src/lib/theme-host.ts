import { headers } from "next/headers";
import { ThemePreviewResolvedDtoSchema } from "@vibress/api-contracts";
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

  let verifiedPreview = false;
  if (isPreview && previewThemeId) {
    // The preview token is forwarded only by middleware after host-scoped
    // validation. Re-resolve server-side instead of trusting a theme ID or
    // copying the active theme's version and settings.
    try {
      const hs = await headers();
      const token = hs.get("x-vibress-preview-token");
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        const host = hs.get("x-forwarded-host") || hs.get("host");
        const baseUrl = process.env.API_URL || "http://127.0.0.1:7780";
        const response = await fetch(
          `${baseUrl}/api/admin/v1/themes/preview/${token}`,
          {
            cache: "no-store",
            headers: {
              Accept: "application/json",
              ...(host ? { "x-forwarded-host": host } : {}),
            },
          },
        );
        if (response.ok) {
          const parsed = ThemePreviewResolvedDtoSchema.safeParse(await response.json());
          if (parsed.success && parsed.data.themeId === previewThemeId) {
            activeThemeId = parsed.data.themeId;
            activeThemeVersion = parsed.data.themeVersion;
            isBuiltIn = parsed.data.isBuiltIn;
            settings = parsed.data.settings;
            verifiedPreview = true;
          }
        }
      }
    } catch {
      // Failed or expired previews never adopt untrusted theme selections.
    }
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
    isPreview: verifiedPreview,
  };
}

export * from "./site-settings";

