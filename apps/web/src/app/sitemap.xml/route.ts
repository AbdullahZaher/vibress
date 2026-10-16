import { ContentApiClient } from "../../lib/content-api-client";
import { getThemeSiteSettings } from "../../lib/site-settings";
import { getLocalePrefix } from "@vibress/i18n";
import { getPublicSiteUrl } from "../../lib/seo-helpers";

export const dynamic = "force-dynamic";

function escapeXml(unsafe: string): string {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

interface SitemapEntry {
  loc: string;
  lastmod?: string | null;
  alternateLocales: Map<string, string>;
}

export async function GET() {
  const site = await getThemeSiteSettings();
  if (!site.publicationId) {
    return new Response("Publication metadata unavailable", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
  const siteUrl = getPublicSiteUrl();
  const primary = site.primaryLocale || site.locale;
  const enabled = site.enabledLocales?.length ? site.enabledLocales : [primary];
  const entries = new Map<string, SitemapEntry>();

  // Use the source list's true page count. Localized list pages can be
  // sparse, so an empty translated page must not terminate pagination.
  const PAGE_LIMIT = 100;
  const MAX_PUBLIC_SOURCE_PAGES = 500;
  const [firstPosts, firstPages] = await Promise.all([
    ContentApiClient.getPosts({ page: 1, limit: PAGE_LIMIT, locale: primary }),
    ContentApiClient.getPages({ page: 1, limit: PAGE_LIMIT, locale: primary }),
  ]);
  if (!firstPosts || !firstPages) {
    return new Response("Sitemap source unavailable", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
  const postPages = Math.max(1, Math.ceil(firstPosts.pagination.total / PAGE_LIMIT));
  const pagePages = Math.max(1, Math.ceil(firstPages.pagination.total / PAGE_LIMIT));
  if (postPages > MAX_PUBLIC_SOURCE_PAGES || pagePages > MAX_PUBLIC_SOURCE_PAGES) {
    return new Response("Partitioned sitemaps required for this publication", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }

  const localeOrder = [primary, ...enabled.filter((locale) => locale !== primary)];
  for (const locale of localeOrder) {
    const prefix = getLocalePrefix(locale, primary, enabled);
    for (let page = 1; page <= Math.max(postPages, pagePages); page++) {
      const [postList, pageList] = await Promise.all([
        page <= postPages
          ? page === 1 && locale === primary
            ? firstPosts : ContentApiClient.getPosts({ page, limit: PAGE_LIMIT, locale })
          : null,
        page <= pagePages
          ? page === 1 && locale === primary
            ? firstPages : ContentApiClient.getPages({ page, limit: PAGE_LIMIT, locale })
          : null,
      ]);
      if ((page <= postPages && !postList) || (page <= pagePages && !pageList)) {
        return new Response("Sitemap enumeration incomplete", {
          status: 503, headers: { "Cache-Control": "no-store" },
        });
      }
      for (const post of postList?.posts ?? []) {
        const key = `post:${post.id}`;
        const url = `${siteUrl}${prefix}/posts/${encodeURIComponent(post.slug)}`;
        let entry = entries.get(key);
        if (!entry) {
          entry = { loc: url, lastmod: post.updatedAt || post.publishedAt,
            alternateLocales: new Map<string, string>() };
          entries.set(key, entry);
        }
        entry.alternateLocales.set(locale, url);
        if (locale === primary) entry.loc = url;
      }
      for (const item of pageList?.pages ?? []) {
        const key = `page:${item.id}`;
        const url = `${siteUrl}${prefix}/pages/${encodeURIComponent(item.slug)}`;
        let entry = entries.get(key);
        if (!entry) {
          entry = { loc: url, lastmod: item.updatedAt || item.publishedAt,
            alternateLocales: new Map<string, string>() };
          entries.set(key, entry);
        }
        entry.alternateLocales.set(locale, url);
        if (locale === primary) entry.loc = url;
      }
    }
  }

  const [tags, authors] = await Promise.all([
    ContentApiClient.getTags(), ContentApiClient.getAuthors(),
  ]);
  const baseUrls = [
    `${siteUrl}/`,
    ...(tags ?? []).map((tag) => `${siteUrl}/tags/${encodeURIComponent(tag.slug)}`),
    ...(authors ?? []).map((author) => `${siteUrl}/authors/${encodeURIComponent(author.slug)}`),
  ];
  const urlEntries: SitemapEntry[] = [
    ...baseUrls.map((loc) => ({ loc, alternateLocales: new Map<string, string>() })),
    ...Array.from(entries.values()).flatMap((entry) =>
      Array.from(entry.alternateLocales.values()).map((loc) => ({ ...entry, loc })),
    ),
  ];
  // Sitemaps may contain at most 50,000 <url> entries; never quietly emit a
  // truncated index. Large sites require separately partitioned sitemap URLs.
  if (urlEntries.length > 50000) {
    return new Response("Partitioned sitemaps required for this publication", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries.map((entry) => {
  const alternates = entry.alternateLocales.size > 1
    ? Array.from(entry.alternateLocales.entries()).map(([locale, url]) =>
      `    <xhtml:link rel="alternate" hreflang="${escapeXml(locale)}" href="${escapeXml(url)}"/>`)
    : [];
  if (alternates.length && entry.alternateLocales.has(primary)) {
    alternates.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(entry.alternateLocales.get(primary)!)}"/>`);
  }
  return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>${entry.lastmod
    ? `\n    <lastmod>${escapeXml(new Date(entry.lastmod).toISOString())}</lastmod>` : ""}
${alternates.join("\n")}
  </url>`;
}).join("\n")}
</urlset>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
