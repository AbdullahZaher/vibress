import { ContentApiClient } from "../../lib/content-api-client";
import { getThemeSiteSettings } from "../../lib/theme-host";
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

  // Enumerate published variants only. The public API omits draft, disabled
  // and missing translations. Never infer alternates from locale registry.
  for (const locale of enabled) {
    const [posts, pages] = await Promise.all([
      ContentApiClient.getPosts({ page: 1, limit: 100, locale }),
      ContentApiClient.getPages({ page: 1, limit: 100, locale }),
    ]);
    const prefix = getLocalePrefix(locale, primary, enabled);
    for (const post of posts?.posts ?? []) {
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
    for (const page of pages?.pages ?? []) {
      const key = `page:${page.id}`;
      const url = `${siteUrl}${prefix}/pages/${encodeURIComponent(page.slug)}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { loc: url, lastmod: page.updatedAt || page.publishedAt,
          alternateLocales: new Map<string, string>() };
        entries.set(key, entry);
      }
      entry.alternateLocales.set(locale, url);
      if (locale === primary) entry.loc = url;
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
    ...entries.values(),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries.map((entry) => {
  const alternates = entry.alternateLocales.size > 1
    ? [...entry.alternateLocales.entries()].map(([locale, url]) =>
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
