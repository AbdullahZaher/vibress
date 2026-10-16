import { ContentApiClient } from "./content-api-client";
import { getPublicSiteUrl } from "./seo-helpers";
import { getLocalePrefix } from "@vibress/i18n";
import { getThemeSiteSettings } from "./theme-host";

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function generateRssFeed() {
  const site = await getThemeSiteSettings();
  if (!site.publicationId) {
    return new Response("Publication information unavailable", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
  const siteUrl = getPublicSiteUrl();
  const locale = site.locale;
  const prefix = getLocalePrefix(
    locale, site.primaryLocale || locale, site.enabledLocales,
  );
  const siteName = site.title;
  const siteDescription = site.description;

  const postsData = await ContentApiClient.getPosts({ page: 1, limit: 30, locale });
  const posts = postsData?.posts || [];

  const firstPost = posts[0];
  const lastBuildDate =
    firstPost && firstPost.publishedAt
      ? new Date(firstPost.publishedAt).toUTCString()
      : new Date().toUTCString();

  const itemsXml = posts
    .map((post) => {
      const link = `${siteUrl}${prefix}/posts/${encodeURIComponent(post.slug)}`;
      const pubDate = new Date(post.publishedAt).toUTCString();
      const description = post.excerpt || post.title;

      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${escapeXml(pubDate)}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(siteDescription)}</description>
    <language>${escapeXml(locale)}</language>
    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
    <atom:link href="${escapeXml(siteUrl)}${escapeXml(prefix)}/rss.xml" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
