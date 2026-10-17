import { Metadata } from "next";
import {
  PublicPostDetailDto,
  PublicPageDetailDto,
} from "@vibress/api-contracts";
import { canonicalizeLocale, getLocalePrefix } from "@vibress/i18n";
import { ContentApiClient } from "./content-api-client";

export function getPublicSiteUrl(): string {
  const envUrl =
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:7777";
  try {
    const parsed = new URL(envUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "http://localhost:7777";
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "http://localhost:7777";
  }
}

/**
 * Enumerate only published and explicitly enabled translations. Calling
 * routes never guess hreflang entries from language registry defaults.
 */
export async function publishedAlternateLanguageUrls(
  kind: "post" | "page",
  slug: string,
  locale: string,
): Promise<Record<string, string>> {
  const data = await ContentApiClient.getPublishedLocaleAlternates(kind, slug, locale);
  if (!data) return {};
  const url = getPublicSiteUrl();
  const alternates: Record<string, string> = {};
  for (const [target, path] of Object.entries(data.alternates)) {
    if (!data.enabledLocales.includes(target) || !path.startsWith("/")) continue;
    const prefix = getLocalePrefix(target, data.primaryLocale, data.enabledLocales);
    alternates[target] = `${url}${prefix}${path}`;
  }
  const primaryUrl = alternates[data.primaryLocale];
  if (Object.keys(alternates).length > 1 && primaryUrl) {
    alternates["x-default"] = primaryUrl;
  }
  return alternates;
}

export interface AlternateLanguageMap {
  [locale: string]: string;
}

export function buildPageMetadata(options: {
  title: string;
  description: string;
  canonicalPath?: string | undefined;
  canonicalOverride?: string | null | undefined;
  ogImage?: string | null | undefined;
  ogType?: "website" | "article" | undefined;
  locale?: string | undefined;
  alternateLocales?: AlternateLanguageMap | undefined;
}): Metadata {
  const siteUrl = getPublicSiteUrl();
  const siteName = process.env.SITE_NAME || "Vibress";

  let canonicalUrl = `${siteUrl}${options.canonicalPath || ""}`;
  if (options.canonicalOverride && options.canonicalOverride.trim()) {
    const override = options.canonicalOverride.trim();
    if (override.startsWith("http://") || override.startsWith("https://")) {
      canonicalUrl = override;
    }
  }

  const locale = options.locale ? canonicalizeLocale(options.locale) : "en";
  const ogLocale = locale.replace(/-/g, "_");
  // Never advertise translations that are disabled, unpublished or absent.
  // The caller supplies an explicit published-only map when available.
  const alternateLanguages = options.alternateLocales || {};

  const meta: Metadata = {
    title: options.title,
    description: options.description,
    alternates: {
      canonical: canonicalUrl,
      languages: alternateLanguages,
    },
    openGraph: {
      title: options.title,
      description: options.description,
      url: canonicalUrl,
      type: options.ogType || "website",
      siteName,
      locale: ogLocale,
      ...(options.ogImage ? { images: [{ url: options.ogImage }] } : {}),
    },
    twitter: {
      card: options.ogImage ? "summary_large_image" : "summary",
      title: options.title,
      description: options.description,
      ...(options.ogImage ? { images: [options.ogImage] } : {}),
    },
  };

  return meta;
}

export function buildPostJsonLd(
  post: PublicPostDetailDto,
  locale = "en",
  localeContext?: { primaryLocale?: string | undefined; enabledLocales?: string[] | undefined },
): Record<string, unknown> {
  const siteUrl = getPublicSiteUrl();
  let canonicalUrl = post.seo?.canonicalUrl?.trim();
  if (!canonicalUrl) {
    const prefix = localeContext
      ? getLocalePrefix(locale, localeContext.primaryLocale || locale, localeContext.enabledLocales)
      : "";
    canonicalUrl = `${siteUrl}${prefix}/posts/${post.slug}`;
  }

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt || post.seo?.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    inLanguage: canonicalizeLocale(locale),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    url: canonicalUrl,
    author: post.authors?.map((a) => ({
      "@type": "Person",
      name: a.name,
    })),
    image: post.featureImage?.url ? [post.featureImage.url] : undefined,
  };
}

export function buildPageJsonLd(
  page: PublicPageDetailDto,
  locale = "en",
  localeContext?: { primaryLocale?: string | undefined; enabledLocales?: string[] | undefined },
): Record<string, unknown> {
  const siteUrl = getPublicSiteUrl();
  let canonicalUrl = page.seo?.canonicalUrl?.trim();
  if (!canonicalUrl) {
    const prefix = localeContext
      ? getLocalePrefix(locale, localeContext.primaryLocale || locale, localeContext.enabledLocales)
      : "";
    canonicalUrl = `${siteUrl}${prefix}/pages/${page.slug}`;
  }

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.title,
    description: page.excerpt || page.seo?.description,
    url: canonicalUrl,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    inLanguage: canonicalizeLocale(locale),
    datePublished: page.publishedAt,
    dateModified: page.updatedAt,
  };
}

export function safeJsonLdScript(data: Record<string, unknown>): string {
  const json = JSON.stringify(data);
  // Prevent </script> tag breakout security injection
  return json.replace(/</g, "\\u003c");
}
