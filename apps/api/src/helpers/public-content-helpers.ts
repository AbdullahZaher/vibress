import { MediaService } from '@vibress/media';
import { Post } from '@vibress/posts';
import { Page } from '@vibress/pages';
import { Tag } from '@vibress/tags';
import { Author } from '@vibress/authors';
import {
  renderStudioDocumentToHtml,
  renderStudioDocumentToPlainText,
} from '@vibress/studio-renderer';
import { slugify } from '@vibress/utils';
import {
  PublicAuthorDto,
  PublicTagDto,
  PublicMediaDto,
  PublicPostSummaryDto,
  PublicPostDetailDto,
  PublicPageDetailDto,
} from '@vibress/api-contracts';

export function getSiteUrl(): string {
  const envUrl = process.env.SITE_URL || 'http://localhost:7777';
  try {
    const parsed = new URL(envUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'http://localhost:7777';
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'http://localhost:7777';
  }
}

export async function resolveDocumentMedia(
  docInput: unknown,
  mediaService: MediaService
): Promise<Record<string, any>> {
  if (!docInput || typeof docInput !== 'object') {
    return { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [] } };
  }

  const doc = JSON.parse(JSON.stringify(docInput));
  if (!doc.root || !Array.isArray(doc.root.children)) {
    return doc;
  }

  async function processNode(node: any): Promise<void> {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'studio-card' && node.cardData) {
      const data = node.cardData;

      // Handle singular assetId (image, video, audio, file)
      if (typeof data.assetId === 'string' && data.assetId.trim()) {
        try {
          const asset = await mediaService.getMediaById(data.assetId.trim());
          if (asset) {
            data.src = await mediaService.getMediaUrl(asset);
            if (data.cardType === 'image' || node.cardType === 'image') {
              if (asset.width) data.width = asset.width;
              if (asset.height) data.height = asset.height;
              if (asset.displayName && !data.alt) data.alt = asset.displayName;
            }
          }
        } catch {
          // Keep existing src or fallback silently
        }
      }

      // Handle gallery assetIds / images array
      if (Array.isArray(data.images)) {
        for (const imgItem of data.images) {
          if (imgItem && typeof imgItem === 'object' && typeof imgItem.assetId === 'string') {
            try {
              const asset = await mediaService.getMediaById(imgItem.assetId.trim());
              if (asset) {
                imgItem.src = await mediaService.getMediaUrl(asset);
                if (asset.displayName && !imgItem.alt) imgItem.alt = asset.displayName;
              }
            } catch {
              // Fallback
            }
          }
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        await processNode(child);
      }
    }
  }

  for (const child of doc.root.children) {
    await processNode(child);
  }

  return doc;
}

export function extractFeatureImage(
  resolvedDoc: Record<string, any>
): PublicMediaDto | null {
  if (!resolvedDoc || !resolvedDoc.root || !Array.isArray(resolvedDoc.root.children)) {
    return null;
  }

  let found: PublicMediaDto | null = null;

  function findImage(node: any) {
    if (found || !node || typeof node !== 'object') return;

    if (node.type === 'studio-card' && node.cardType === 'image' && node.cardData) {
      const src = node.cardData.src;
      if (src && typeof src === 'string') {
        found = {
          id: node.cardData.assetId || 'embedded-img',
          url: src,
          alt: node.cardData.alt || null,
          assetType: 'image',
          width: typeof node.cardData.width === 'number' ? node.cardData.width : null,
          height: typeof node.cardData.height === 'number' ? node.cardData.height : null,
        };
        return;
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        findImage(child);
        if (found) return;
      }
    }
  }

  for (const child of resolvedDoc.root.children) {
    findImage(child);
    if (found) break;
  }

  return found;
}

export function deriveExcerpt(excerpt: string | null | undefined, docInput: unknown): string {
  if (excerpt && excerpt.trim()) {
    return excerpt.trim();
  }

  try {
    const plainText = renderStudioDocumentToPlainText(docInput);
    const cleaned = plainText.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 250) {
      return cleaned;
    }
    const truncated = cleaned.slice(0, 250);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 150 ? truncated.slice(0, lastSpace) : truncated) + '...';
  } catch {
    return '';
  }
}

export function formatPublicAuthor(author: Author): PublicAuthorDto {
  return {
    id: author.id,
    name: author.name,
    slug: author.slug || slugify(author.name) || author.id,
    bio: author.bio || null,
  };
}

export function formatPublicTag(tag: Tag): PublicTagDto {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    description: tag.description || null,
  };
}

export async function buildPublicPostSummaryDto(
  post: Post,
  authors: Author[],
  tags: Tag[],
  mediaService: MediaService
): Promise<PublicPostSummaryDto> {
  const resolvedDoc = await resolveDocumentMedia(post.content, mediaService);
  const featureImage = extractFeatureImage(resolvedDoc);
  const siteUrl = getSiteUrl();

  const formattedAuthors = authors.map(formatPublicAuthor);
  const primaryAuthor = formattedAuthors.find((a) => a.id === post.primaryAuthorId) || formattedAuthors[0] || {
    id: post.primaryAuthorId,
    name: 'Author',
    slug: post.primaryAuthorId,
    bio: null,
  };

  const formattedTags = tags.map(formatPublicTag);

  const excerpt = deriveExcerpt(post.excerpt, post.content);
  const canonicalUrl = post.canonicalUrl || `${siteUrl}/posts/${post.slug}`;
  const seoTitle = post.metaTitle || post.title;
  const seoDescription = post.metaDescription || excerpt;

  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt,
    publishedAt: (post.publishedAt || post.createdAt).toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    primaryAuthor,
    authors: formattedAuthors,
    tags: formattedTags,
    featureImage,
    seo: {
      title: seoTitle,
      description: seoDescription,
      canonicalUrl,
      ogImage: featureImage?.url || undefined,
      ogType: 'article',
    },
  };
}

export async function buildPublicPostDetailDto(
  post: Post,
  authors: Author[],
  tags: Tag[],
  mediaService: MediaService
): Promise<PublicPostDetailDto> {
  const summary = await buildPublicPostSummaryDto(post, authors, tags, mediaService);
  const resolvedDoc = await resolveDocumentMedia(post.content, mediaService);

  let html: string;
  try {
    html = renderStudioDocumentToHtml(resolvedDoc);
  } catch {
    html = '<p>Content rendering unavailable.</p>';
  }

  return {
    ...summary,
    content: resolvedDoc,
    html,
  };
}

export async function buildPublicPageDetailDto(
  page: Page,
  mediaService: MediaService
): Promise<PublicPageDetailDto> {
  const resolvedDoc = await resolveDocumentMedia(page.content, mediaService);
  const featureImage = extractFeatureImage(resolvedDoc);
  const siteUrl = getSiteUrl();

  const excerpt = deriveExcerpt(page.excerpt, page.content);
  const canonicalUrl = page.canonicalUrl || `${siteUrl}/pages/${page.slug}`;
  const seoTitle = page.metaTitle || page.title;
  const seoDescription = page.metaDescription || excerpt;

  let html: string;
  try {
    html = renderStudioDocumentToHtml(resolvedDoc);
  } catch {
    html = '<p>Content rendering unavailable.</p>';
  }

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    excerpt,
    content: resolvedDoc,
    html,
    featureImage,
    publishedAt: (page.publishedAt || page.createdAt).toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    seo: {
      title: seoTitle,
      description: seoDescription,
      canonicalUrl,
      ogImage: featureImage?.url || undefined,
      ogType: 'website',
    },
  };
}
