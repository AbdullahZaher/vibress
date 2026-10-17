import { headers } from "next/headers";
import { cache } from "react";
import { getPublicSiteUrl } from "./seo-helpers";

export const DEFAULT_THEME_ID = "vibress-default";

export interface ThemeSiteSettings {
  publicationId?: string | undefined;
  legacyThemeStorage?: boolean | undefined;
  legacyThemeId?: string | undefined;
  legacyThemeVersion?: string | undefined;
  title: string;
  description: string;
  url: string;
  locale: string;
  primaryLocale?: string | undefined;
  enabledLocales?: string[] | undefined;
  tagline?: string | undefined;
  timezone?: string | undefined;
  accentColor?: string | undefined;
  iconUrl?: string | undefined;
  logoUrl?: string | undefined;
  coverUrl?: string | undefined;
  primaryNav?: Array<{ label: string; url: string }> | undefined;
  secondaryNav?: Array<{ label: string; url: string }> | undefined;
  announcementEnabled?: boolean | undefined;
  announcementText?: string | undefined;
  announcementUrl?: string | undefined;
  security?: { isPrivate: boolean } | undefined;
  analytics?:
    | {
        gaId?: string | undefined;
        plausibleDomain?: string | undefined;
        posthogKey?: string | undefined;
        posthogHost?: string | undefined;
      }
    | undefined;
  code?:
    | { headerCode?: string | undefined; footerCode?: string | undefined }
    | undefined;
  comments?:
    | {
        commentAccess?: string | undefined;
        preModeration?: boolean | undefined;
      }
    | undefined;
  commentsEnabled?: boolean | undefined;
  commentAccess?: string | undefined;
}

interface CachedSiteSettingsResponse {
  data: {
    site?: Record<string, unknown>;
    security?: { isPrivate: boolean };
    analytics?: Record<string, unknown>;
    code?: Record<string, unknown>;
    comments?: Record<string, unknown>;
    theme?: { legacyStorage?: unknown; themeId?: unknown; themeVersion?: unknown };
  };
  publicationId?: string | undefined;
  timestamp: number;
}

const serverSiteCache = new Map<string, CachedSiteSettingsResponse>();
const SERVER_CACHE_TTL_MS = 15_000;

/**
 * Public site identity, precedence: DB setting (first-run wizard) →
 * environment → built-in default. SITE_URL stays infrastructure-driven —
 * it is only echoed from the content API, never redefined here.
 */
const serverCache =
  typeof cache === "function"
    ? cache
    : <T extends (...args: any[]) => any>(fn: T): T => fn;

export const getThemeSiteSettings = serverCache(async function getThemeSiteSettings(): Promise<ThemeSiteSettings> {
  const fallback: ThemeSiteSettings = {
    publicationId: process.env.NODE_ENV === "test" ? "test-pub-id" : undefined,
    title: process.env.SITE_NAME || "Vibress",
    description: process.env.SITE_DESCRIPTION || "Publishing Platform",
    url: getPublicSiteUrl(),
    locale: process.env.SITE_LOCALE || "en",
    primaryLocale: process.env.SITE_LOCALE || "en",
    enabledLocales: [process.env.SITE_LOCALE || "en"],
    accentColor: "#6366f1",
    primaryNav: [],
    secondaryNav: [],
    announcementEnabled: false,
    announcementText: "",
    announcementUrl: "",
    security: { isPrivate: false },
    analytics: {},
    code: {},
    comments: { commentAccess: "all", preModeration: false },
    commentsEnabled: true,
    commentAccess: "all",
  };
  try {
    const baseUrl = process.env.API_URL || "http://127.0.0.1:7780";
    let hostHeader: string | undefined;
    try {
      const hs = await headers();
      hostHeader = hs.get("x-forwarded-host") || hs.get("host") || undefined;
    } catch {
      // Headers unavailable in static/fallback context
    }

    const cacheKey = hostHeader || "default";
    const now = Date.now();
    const cached = serverSiteCache.get(cacheKey);

    let data: CachedSiteSettingsResponse["data"] | undefined;
    let publicationId: string | undefined;

    if (cached && now - cached.timestamp < SERVER_CACHE_TTL_MS) {
      data = cached.data;
      publicationId = cached.publicationId;
    } else {
      try {
        const res = await fetch(`${baseUrl}/api/content/v1/site`, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            ...(hostHeader ? { "x-forwarded-host": hostHeader } : {}),
          },
        });
        if (res.ok) {
          publicationId = res.headers.get("x-vibress-publication-id") || undefined;
          data = (await res.json()) as CachedSiteSettingsResponse["data"];
          serverSiteCache.set(cacheKey, { data, publicationId, timestamp: now });
        } else if (cached) {
          data = cached.data;
          publicationId = cached.publicationId;
        } else {
          return fallback;
        }
      } catch {
        if (cached) {
          data = cached.data;
          publicationId = cached.publicationId;
        } else {
          return fallback;
        }
      }
    }

    const site = data?.site;
    if (!site || typeof site.title !== "string") return fallback;
    const requestLocale = await getRequestLocaleFromHeaders();
    const primaryLocale = typeof site.locale === "string"
      ? site.locale : fallback.locale;
    const enabledLocales = Array.isArray(site.enabledLocales)
      ? site.enabledLocales.filter((value): value is string => typeof value === "string")
      : [primaryLocale];
    const activeLocale = requestLocale && enabledLocales.includes(requestLocale)
      ? requestLocale : primaryLocale;
    const commentsData = (data?.comments as ThemeSiteSettings["comments"]) || {};
    const commentAccess = commentsData?.commentAccess || "all";
    const commentsEnabled = commentAccess !== "disabled";

    return {
      publicationId,
      legacyThemeStorage: data?.theme?.legacyStorage === true,
      legacyThemeId: typeof data?.theme?.themeId === "string" ? data.theme.themeId : undefined,
      legacyThemeVersion: typeof data?.theme?.themeVersion === "string" ? data.theme.themeVersion : undefined,
      title: site.title as string,
      description: (site.description as string) || fallback.description,
      url: (site.url as string) || fallback.url,
      locale: activeLocale,
      primaryLocale,
      enabledLocales,
      timezone: (site.timezone as string) || "UTC",
      accentColor: (site.accentColor as string) || fallback.accentColor,
      iconUrl: (site.iconUrl as string) || undefined,
      logoUrl: (site.logoUrl as string) || undefined,
      coverUrl: (site.coverUrl as string) || undefined,
      primaryNav: Array.isArray(site.primaryNav)
        ? (site.primaryNav as Array<{ label: string; url: string }>)
        : [],
      secondaryNav: Array.isArray(site.secondaryNav)
        ? (site.secondaryNav as Array<{ label: string; url: string }>)
        : [],
      announcementEnabled: Boolean(site.announcementEnabled),
      announcementText: (site.announcementText as string) || "",
      announcementUrl: (site.announcementUrl as string) || "",
      tagline:
        typeof site.tagline === "string" && site.tagline
          ? site.tagline
          : undefined,
      security: data?.security || { isPrivate: false },
      analytics: (data?.analytics as ThemeSiteSettings["analytics"]) || {},
      code: (data?.code as ThemeSiteSettings["code"]) || {},
      comments: commentsData,
      commentsEnabled,
      commentAccess,
    };
  } catch {
    return fallback;
  }
});

export async function getRequestLocaleFromHeaders(): Promise<string | null> {
  try {
    const hs = await headers();
    return hs.get("x-vibress-locale") || null;
  } catch {
    return null;
  }
}

export async function getPreviewThemeIdFromHeaders(): Promise<string | null> {
  try {
    const hs = await headers();
    return hs.get("x-vibress-theme") || null;
  } catch {
    return null;
  }
}

export function getActiveThemeIdFallback(): string {
  return DEFAULT_THEME_ID;
}
