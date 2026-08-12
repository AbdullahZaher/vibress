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

export interface ThemeSiteSettings {
  title: string;
  description: string;
  url: string;
  locale: string;
  tagline?: string;
}

/**
 * Public site identity, precedence: DB setting (first-run wizard) →
 * environment → built-in default. SITE_URL stays infrastructure-driven —
 * it is only echoed from the content API, never redefined here.
 */
export async function getThemeSiteSettings(): Promise<ThemeSiteSettings> {
  const fallback: ThemeSiteSettings = {
    title: process.env.SITE_NAME || 'Vibress',
    description: process.env.SITE_DESCRIPTION || 'Publishing Platform',
    url: getPublicSiteUrl(),
    locale: process.env.SITE_LOCALE || 'en',
  };
  try {
    const baseUrl = process.env.API_URL || 'http://127.0.0.1:7780';
    const res = await fetch(`${baseUrl}/api/content/v1/site`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { site?: ThemeSiteSettings };
    const site = data?.site;
    if (!site || typeof site.title !== 'string') return fallback;
    return {
      title: site.title,
      description: site.description || fallback.description,
      url: site.url || fallback.url,
      locale: site.locale || fallback.locale,
      ...(typeof site.tagline === 'string' && site.tagline ? { tagline: site.tagline } : {}),
    };
  } catch {
    return fallback;
  }
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
