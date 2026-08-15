import { ContentApiClient } from "../../lib/content-api-client";
import { getPublicSiteUrl } from "../../lib/seo-helpers";

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5-minute cache for sitemap

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const siteUrl = getPublicSiteUrl();

  const [postsData, pagesData, tags, authors] = await Promise.all([
    ContentApiClient.getPosts({ page: 1, limit: 100 }),
    ContentApiClient.getPages({ page: 1, limit: 100 }),
    ContentApiClient.getTags(),
    ContentApiClient.getAuthors(),
  ]);

  const posts = postsData?.posts || [];
  const pagesList = pagesData?.pages || [];

  const urls: Array<{ loc: string; lastmod?: string }> = [
    { loc: `${siteUrl}/` },
  ];

  for (const post of posts) {
    urls.push({
      loc: `${siteUrl}/posts/${post.slug}`,
      lastmod: post.updatedAt || post.publishedAt,
    });
  }

  for (const pageObj of pagesList) {
    urls.push({
      loc: `${siteUrl}/pages/${pageObj.slug}`,
      lastmod: pageObj.updatedAt || pageObj.publishedAt,
    });
  }

  for (const tag of tags) {
    urls.push({
      loc: `${siteUrl}/tags/${tag.slug}`,
    });
  }

  for (const author of authors) {
    urls.push({
      loc: `${siteUrl}/authors/${author.slug}`,
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (item) => `  <url>
    <loc>${escapeXml(item.loc)}</loc>${
      item.lastmod
        ? `\n    <lastmod>${escapeXml(new Date(item.lastmod).toISOString())}</lastmod>`
        : ""
    }
  </url>`,
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
