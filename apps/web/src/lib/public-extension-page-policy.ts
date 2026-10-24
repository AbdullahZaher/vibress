import type { Metadata } from "next";
import { getLocalePrefix, supportsPublishedExtensionLocale } from "@vibress/i18n";
import type { ThemeSiteSettings } from "./site-settings";
import type { PublicExtensionPage } from "./public-extension-client";
import { isValidPublicHost } from "./public-extension-client";
import { buildPageMetadata } from "./seo-helpers";

/**
 * Pure publication and SEO policy shared by App Router and Vitest. The
 * Next.js page itself is exercised by browser E2E/build, not imported into
 * Vite's client transform (which does not own Next.js server components).
 */
export function matchesPublicExtensionPublication(
  page: PublicExtensionPage,
  site: Pick<ThemeSiteSettings, "publicationId">,
): boolean {
  return Boolean(site.publicationId && site.publicationId === page.publicationId);
}

export function localizedExtensionTitle(
  title: { readonly en: string; readonly ar: string },
  locale: string,
): string {
  return /^ar(?:-|$)/i.test(locale) ? title.ar : title.en;
}

/** Never derive a canonical URL from a forwarded header or a foreign site URL. */
export function trustedExtensionOrigin(
  host: string | null,
  configuredUrl: string,
  production: boolean,
): string | null {
  if (!host || !isValidPublicHost(host)) return null;
  let protocol = production ? "https:" : "http:";
  try {
    const configured = new URL(configuredUrl);
    if ((configured.protocol === "http:" || configured.protocol === "https:") &&
        configured.host.toLowerCase() === host.toLowerCase()) {
      protocol = configured.protocol;
    }
  } catch {
    // Invalid site URL cannot override an authoritative public Host.
  }
  return `${protocol}//${host}`;
}

export function publicExtensionMetadata(
  page: PublicExtensionPage,
  site: Pick<ThemeSiteSettings, "publicationId" | "url" | "locale" |
    "primaryLocale" | "enabledLocales" | "title" | "security">,
  host: string | null,
  production: boolean,
  isPreview = false,
): Metadata {
  if (!matchesPublicExtensionPublication(page, site) ||
      (page.locale && page.locale !== site.locale) ||
      !supportsPublishedExtensionLocale(page.publishedLocales, site.locale)) {
    return { robots: { index: false, follow: false } };
  }
  const origin = trustedExtensionOrigin(host, site.url, production);
  if (!origin) return { robots: { index: false, follow: false } };
  const localePrefix = getLocalePrefix(
    site.locale, site.primaryLocale || site.locale, site.enabledLocales,
  );
  const title = localizedExtensionTitle(page.title, site.locale);
  const canonical = `${origin}${localePrefix}/extensions/${page.pluginId}/${page.viewId}`;
  const published = site.enabledLocales?.filter((locale) =>
    supportsPublishedExtensionLocale(page.publishedLocales, locale)) ?? [];
  const alternates: Record<string, string> = {};
  if (published.length > 1 && published.includes(site.primaryLocale || site.locale)) {
    for (const locale of published) {
      const prefix = getLocalePrefix(
        locale, site.primaryLocale || site.locale, site.enabledLocales,
      );
      alternates[locale] = `${origin}${prefix}/extensions/${page.pluginId}/${page.viewId}`;
    }
    const primary = alternates[site.primaryLocale || site.locale];
    if (primary) alternates["x-default"] = primary;
  }
  return {
    ...buildPageMetadata({
      title,
      description: `${title} | ${site.title}`,
      canonicalOverride: canonical,
      locale: site.locale,
      ogType: "website",
      // Hreflang requires explicit plugin publication AND enabled site locales.
      alternateLocales: alternates,
    }),
    ...(site.security?.isPrivate || isPreview
      ? { robots: { index: false, follow: false } } : {}),
  };
}
