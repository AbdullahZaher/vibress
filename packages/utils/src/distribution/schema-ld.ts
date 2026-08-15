export interface ArticleSchemaInput {
  title: string;
  url: string;
  description?: string | undefined;
  image?: string | undefined;
  datePublished: string;
  dateModified?: string | undefined;
  authorName: string;
  authorUrl?: string | undefined;
  publisherName: string;
  publisherLogo?: string | undefined;
}

export function generateArticleJsonLd(input: ArticleSchemaInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    url: input.url,
    description: input.description,
    image: input.image ? [input.image] : undefined,
    datePublished: input.datePublished,
    dateModified: input.dateModified || input.datePublished,
    author: {
      "@type": "Person",
      name: input.authorName,
      url: input.authorUrl,
    },
    publisher: {
      "@type": "Organization",
      name: input.publisherName,
      logo: input.publisherLogo ? { "@type": "ImageObject", url: input.publisherLogo } : undefined,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": input.url,
    },
  };
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function generateBreadcrumbsJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
