import { ContentApiClient } from "./content-api-client";
import { getPublicSiteUrl } from "./seo-helpers";

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function generateRssFeed() {
  const siteUrl = getPublicSiteUrl();
  const siteName = process.env.SITE_NAME || "Vibress";
  const siteDescription = process.env.SITE_DESCRIPTION || "Publishing Platform";

  const postsData = await ContentApiClient.getPosts({ page: 1, limit: 30 });
  const posts = postsData?.posts || [];

  const firstPost = posts[0];
  const lastBuildDate =
    firstPost && firstPost.publishedAt
      ? new Date(firstPost.publishedAt).toUTCString()
      : new Date().toUTCString();

  const itemsXml = posts
    .map((post) => {
      const link = `${siteUrl}/posts/${post.slug}`;
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
    <language>en</language>
    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
    <atom:link href="${escapeXml(siteUrl)}/rss.xml" rel="self" type="application/rss+xml"/>
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
