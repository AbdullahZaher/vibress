import { getPublicSiteUrl } from "../../lib/seo-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const siteUrl = getPublicSiteUrl();
  const isIndexingEnabled =
    process.env.PUBLIC_INDEXING_ENABLED !== "false" &&
    process.env.NODE_ENV !== "test";

  const body = isIndexingEnabled
    ? `User-agent: *
Disallow: /admin
Disallow: /admin/
Disallow: /portal
Disallow: /portal/
Disallow: /api/admin/
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`
    : `User-agent: *
Disallow: /

Sitemap: ${siteUrl}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
