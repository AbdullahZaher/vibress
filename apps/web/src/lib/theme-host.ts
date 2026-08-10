import { headers } from 'next/headers';
import { getTheme, getFallbackTheme, DEFAULT_THEME_ID } from '../themes/registry';
import type { VibressThemeDefinition } from '../themes/types';
import { getPublicSiteUrl } from './seo-helpers';

export interface ThemeHostState {
  theme: VibressThemeDefinition;
  settings: Record<string, unknown>;
  isPreview: boolean;
}

export interface ActiveThemeInfo {
  themeId: string;
  settings: Record<string, unknown>;
}

export async function fetchActiveThemeInfo(): Promise<ActiveThemeInfo | null> {
  const baseUrl = process.env.API_URL || 'http://127.0.0.1:7780';
  try {
    const res = await fetch(`${baseUrl}/api/content/v1/site`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
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
  previewThemeId?: string | null
): Promise<ThemeHostState> {
  let activeThemeId: string | null = null;
  let settings: Record<string, unknown> = {};

  const info = await fetchActiveThemeInfo();
  if (info && typeof info.themeId === 'string') {
    activeThemeId = info.themeId;
    settings = info.settings || {};
  }

  if (isPreview && previewThemeId && getTheme(previewThemeId)) {
    activeThemeId = previewThemeId;
  }

  const theme = activeThemeId && getTheme(activeThemeId) ? getTheme(activeThemeId)! : getFallbackTheme();

  // Merge theme defaults over persisted settings (persisted values win)
  const merged: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(theme.settingsSchema)) {
    merged[key] = def.default;
  }
  for (const [key, value] of Object.entries(settings)) {
    if (key in theme.settingsSchema) {
      merged[key] = value;
    }
  }

  return {
    theme,
    settings: merged,
    isPreview,
  };
}

export function getThemeSiteSettings(): {
  title: string;
  description: string;
  url: string;
  locale: string;
} {
  return {
    title: process.env.SITE_NAME || 'Vibress',
    description: process.env.SITE_DESCRIPTION || 'Publishing Platform',
    url: getPublicSiteUrl(),
    locale: process.env.SITE_LOCALE || 'en',
  };
}

export async function getPreviewThemeIdFromHeaders(): Promise<string | null> {
  try {
    const hs = await headers();
    return hs.get('x-vibress-theme') || null;
  } catch {
    return null;
  }
}

export function getActiveThemeIdFallback(): string {
  return DEFAULT_THEME_ID;
}
