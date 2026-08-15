export interface FeedItem {
  id: string;
  title: string;
  url: string;
  contentHtml?: string | undefined;
  summary?: string | undefined;
  image?: string | undefined;
  datePublished: Date;
  dateModified?: Date | undefined;
  authorName?: string | undefined;
}

export interface FeedOptions {
  title: string;
  description: string;
  homePageUrl: string;
  feedUrl: string;
  items: FeedItem[];
  language?: string | undefined;
}

/**
 * Generates valid RSS 2.0 XML
 */
export function generateRssFeed(options: FeedOptions): string {
  const itemsXml = options.items
    .map(
      (item) => `    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.url}</link>
      <guid isPermaLink="true">${item.url}</guid>
      <pubDate>${item.datePublished.toUTCString()}</pubDate>
      ${item.authorName ? `<dc:creator><![CDATA[${item.authorName}]]></dc:creator>` : ""}
      <description><![CDATA[${item.summary || item.contentHtml || ""}]]></description>
      ${item.contentHtml ? `<content:encoded><![CDATA[${item.contentHtml}]]></content:encoded>` : ""}
    </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[${options.title}]]></title>
    <link>${options.homePageUrl}</link>
    <description><![CDATA[${options.description}]]></description>
    <language>${options.language || "en"}</language>
    <atom:link href="${options.feedUrl}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>`;
}

/**
 * Generates valid JSON Feed v1.1
 */
export function generateJsonFeed(options: FeedOptions): Record<string, unknown> {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: options.title,
    home_page_url: options.homePageUrl,
    feed_url: options.feedUrl,
    description: options.description,
    language: options.language || "en",
    items: options.items.map((item) => ({
      id: item.id || item.url,
      url: item.url,
      title: item.title,
      content_html: item.contentHtml,
      summary: item.summary,
      image: item.image,
      date_published: item.datePublished.toISOString(),
      date_modified: item.dateModified?.toISOString(),
      authors: item.authorName ? [{ name: item.authorName }] : undefined,
    })),
  };
}
