import { MediaService, isSafeMediaAssetUrl } from "@vibress/media";
import { Post } from "@vibress/posts";
import { Page } from "@vibress/pages";
import { Tag } from "@vibress/tags";
import { Author } from "@vibress/authors";
import {
  renderStudioDocumentToHtml,
  renderStudioDocumentToPlainText,
  extractTableOfContentsFromDocument,
} from "@vibress/studio-renderer";
import { normalizeStudioDocument } from "@vibress/studio-core";
import { toRenderablePublicDocument } from "./legacy-public-document";
import { slugify } from "@vibress/utils";
import {
  PublicAuthorDto,
  PublicTagDto,
  PublicMediaDto,
  PublicPostSummaryDto,
  PublicPostDetailDto,
  PublicPageDetailDto,
} from "@vibress/api-contracts";
import { getConfig } from "@vibress/config";
import { getDirection, getLocalePrefix } from "@vibress/i18n";

export function getSiteUrl(): string {
  const envUrl = getConfig().site.url;
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
 * Build an authorized, read-only public projection. Never change persisted
 * card data: a denied/deleted media reference must not expose stale fields
 * previously stored in a document (including foreign src/alt/dimensions).
 */
export async function resolveDocumentMedia(
  docInput: unknown,
  mediaService: MediaService,
  publicationId: string,
): Promise<Record<string, unknown>> {
  // The media repository accepts an optional scope for administrative callers.
  // This public helper must never call it without a real publication context.
  if (!publicationId || !publicationId.trim()) {
    throw new Error("Public media resolution requires a publication ID");
  }

  if (!docInput || typeof docInput !== "object") {
    return {
      schema: "vibress-studio",
      version: 1,
      root: { type: "root", children: [] },
    };
  }

  // Clone before canonicalizing: this projection never changes stored content.
  const doc = JSON.parse(JSON.stringify(docInput)) as Record<string, unknown>;
  const canonical = normalizeStudioDocument(toRenderablePublicDocument(doc)) as Record<string, unknown>;
  const root = canonical.root as
    { type?: string; children?: unknown[] } | undefined;
  if (!root || !Array.isArray(root.children)) {
    return canonical;
  }

  // A missing assetId means an intentionally embedded external-media reference.
  // Any nonempty assetId (including a malformed one) MUST be authorized.
  function hasAssetReference(data: Record<string, unknown>): boolean {
    return data.assetId !== undefined && data.assetId !== null && data.assetId !== "";
  }

  // Bare local URLs must be checked against the same publication ownership
  // gate as the actual /content/media/* stream route. They have no assetId to
  // authorize, and otherwise retain stale captions/alt text in public JSON.
  function getLocalMediaStorageKey(url: string): string | null {
    // An absolute URL pointing to a Vibress media stream must not turn a
    // publication-scoped catalog URL into an unverified external reference.
    // Without assetId we cannot know ownership of a different site's host.
    if (/^https?:\/\//i.test(url)) {
      try {
        return new URL(url).pathname.startsWith("/content/media/") ? "" : null;
      } catch {
        return "";
      }
    }
    const pathOnly = url.split(/[?#]/, 1)[0] || "";
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathOnly);
    } catch {
      return ""; // Malformed escape sequences must not bypass a local path.
    }
    if (!decoded.startsWith("/content/media/")) return null;
    const key = decoded.slice("/content/media/".length);
    if (decoded !== pathOnly || url !== pathOnly || !key ||
        key.includes("\\") || key.includes("\0") ||
        key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      return "";
    }
    return key;
  }

  async function isAuthorizedEmbeddedMediaUrl(value: unknown): Promise<boolean> {
    if (!isSafeMediaAssetUrl(value)) return false;
    const localStorageKey = getLocalMediaStorageKey(value);
    if (localStorageKey === null) return true; // e.g. legitimate HTTPS embeds
    if (!localStorageKey) return false;
    try {
      return await mediaService.canStreamLocalMedia(localStorageKey, publicationId);
    } catch {
      return false;
    }
  }

  async function scrubOptionalMediaUrls(data: Record<string, unknown>): Promise<void> {
    for (const field of ["poster", "thumbnail"]) {
      if (data[field] !== undefined && data[field] !== "" &&
          !await isAuthorizedEmbeddedMediaUrl(data[field])) {
        delete data[field];
      }
    }
    // An image link can legitimately be mailto:/tel: or an ordinary page
    // route. Only media-stream links need the media ownership gate; the HTML
    // renderer separately validates ordinary hyperlink protocols.
    if (typeof data.href === "string" &&
        data.href.includes("/content/media/") &&
        !await isAuthorizedEmbeddedMediaUrl(data.href)) {
      delete data.href;
    }
  }

  async function resolveScopedAsset(
    data: Record<string, unknown>,
    populateImageDimensions: boolean,
  ): Promise<boolean> {
    if (typeof data.assetId !== "string" || !data.assetId.trim()) {
      return false;
    }
    try {
      const asset = await mediaService.getMediaById(data.assetId.trim(), publicationId);
      // Defense in depth even if an alternative media repository ignores scope.
      if (!asset || asset.publicationId !== publicationId) return false;
      const url = await mediaService.getMediaUrl(asset);
      if (!isSafeMediaAssetUrl(url)) return false;
      data.src = url;
      if (populateImageDimensions) {
        if (asset.width) data.width = asset.width;
        if (asset.height) data.height = asset.height;
      }
      if (asset.displayName && !data.alt) data.alt = asset.displayName;
      return true;
    } catch {
      // A missing, deleted, foreign or unavailable asset always fails closed.
      return false;
    }
  }

  async function processNode(node: unknown): Promise<void> {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    if (n.type === "studio-card" && n.cardData &&
        typeof n.cardData === "object" && !Array.isArray(n.cardData)) {
      const data = n.cardData as Record<string, unknown>;

      if (hasAssetReference(data)) {
        const allowed = await resolveScopedAsset(data, n.cardType === "image");
        if (!allowed) {
          // The rejected payload may contain previously published foreign metadata.
          n.cardData = {};
        }
      } else if (["image", "video", "audio", "file"].includes(String(n.cardType)) &&
          (typeof data.src !== "string" || !data.src ||
            !await isAuthorizedEmbeddedMediaUrl(data.src))) {
        // A media card without an authorized source is not renderable, and
        // its captions/titles must not survive in public JSON or excerpts.
        n.cardData = {};
      }
      if (n.cardData === data) await scrubOptionalMediaUrls(data);

      // A gallery may contain both authorized and foreign items. Keep only
      // authorized asset-backed items, plus supported external items without
      // asset IDs; do not erase legitimate neighbors or the gallery caption.
      if (Array.isArray(data.images) && n.cardData === data) {
        const authorizedImages: unknown[] = [];
        for (const item of data.images) {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue; // Malformed entries are not publication media.
          }
          const image = item as Record<string, unknown>;
          const allowed = hasAssetReference(image)
            ? await resolveScopedAsset(image, true)
            : typeof image.src === "string" && Boolean(image.src) &&
              await isAuthorizedEmbeddedMediaUrl(image.src);
          if (allowed) {
            await scrubOptionalMediaUrls(image);
            authorizedImages.push(image);
          }
        }
        if (authorizedImages.length === 0) {
          n.cardData = {}; // Do not publish a removed gallery's stale caption.
        } else {
          data.images = authorizedImages;
        }
      }
    }

    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        await processNode(child);
      }
    }
  }

  for (const child of root.children) {
    await processNode(child);
  }

  return canonical;
}

export function extractFeatureImage(
  resolvedDoc: Record<string, unknown>,
): PublicMediaDto | null {
  const root = resolvedDoc.root as
    { type?: string; children?: unknown[] } | undefined;
  if (!resolvedDoc || !root || !Array.isArray(root.children)) {
    return null;
  }

  let found: PublicMediaDto | null = null;

  function findImage(node: unknown) {
    if (found || !node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    if (n.type === "studio-card" && n.cardType === "image" && n.cardData) {
      const cardData = n.cardData as Record<string, unknown>;
      const src = cardData.src;
      if (isSafeMediaAssetUrl(src)) {
        found = {
          id: (cardData.assetId as string) || "embedded-img",
          url: src,
          alt: (cardData.alt as string | null) || null,
          assetType: "image",
          width: typeof cardData.width === "number" ? cardData.width : null,
          height: typeof cardData.height === "number" ? cardData.height : null,
        };
        return;
      }
    }

    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        findImage(child);
        if (found) return;
      }
    }
  }

  for (const child of root.children) {
    findImage(child);
    if (found) break;
  }

  return found;
}

export function deriveExcerpt(
  excerpt: string | null | undefined,
  docInput: unknown,
): string {
  if (excerpt && excerpt.trim()) {
    return excerpt.trim();
  }

  try {
    const plainText = renderStudioDocumentToPlainText(toRenderablePublicDocument(docInput));
    const cleaned = plainText.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 250) {
      return cleaned;
    }
    const truncated = cleaned.slice(0, 250);
    const lastSpace = truncated.lastIndexOf(" ");
    return (
      (lastSpace > 150 ? truncated.slice(0, lastSpace) : truncated) + "..."
    );
  } catch {
    return "";
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
    description: tag.description,
  };
}

export interface PublicContentLocaleContext {
  locale: string;
  primaryLocale: string;
  enabledLocales: readonly string[];
}

export async function buildPublicPostSummaryDto(
  post: Post,
  authors: Author[],
  tags: Tag[],
  mediaService: MediaService,
  commentCount?: number,
  localeContext?: PublicContentLocaleContext,
): Promise<PublicPostSummaryDto> {
  const resolvedDoc = await resolveDocumentMedia(
    post.content,
    mediaService,
    post.publicationId,
  );
  let featureImage: PublicMediaDto | null = null;
  if (post.featureImageId) {
    try {
      const asset = await mediaService.getMediaById(post.featureImageId, post.publicationId);
      if (asset && asset.publicationId === post.publicationId) {
        const metadata = asset.metadata as Record<string, unknown> | null;
        const unsplash = metadata?.unsplash;
        const unsplashMeta = unsplash && typeof unsplash === "object"
          ? unsplash as Record<string, unknown> : null;
        const urls = unsplashMeta?.urls;
        const unsplashUrls = urls && typeof urls === "object"
          ? urls as Record<string, unknown> : null;
        const candidate = unsplashUrls?.regular;
        const url = isSafeMediaAssetUrl(candidate)
          ? candidate : await mediaService.getMediaUrl(asset);
        if (isSafeMediaAssetUrl(url)) {
          const photographerName = unsplashMeta?.photographerName;
          const photographerUrl = unsplashMeta?.photographerUrl;
          const photoUrl = unsplashMeta?.photoUrl;
          const defaultCaption = typeof photographerName === "string" &&
            isSafeMediaAssetUrl(photographerUrl) && isSafeMediaAssetUrl(photoUrl)
            ? `Photo by [${photographerName}](${photographerUrl}) on [Unsplash](${photoUrl})`
            : null;
          featureImage = {
            id: asset.id,
            url,
            alt: post.featureImageAlt || asset.displayName || post.title,
            caption: post.featureImageCaption || defaultCaption,
            assetType: "image",
            width: asset.width ?? null,
            height: asset.height ?? null,
          };
        }
      }
    } catch {
      // Fallback to legacy extraction if asset not found
    }
  }

  if (!featureImage) {
    featureImage = extractFeatureImage(resolvedDoc);
  }
  const siteUrl = getSiteUrl();

  const formattedAuthors = (authors || []).map(formatPublicAuthor);
  const primaryAuthor = formattedAuthors.find(
    (a) => a.id === post.primaryAuthorId,
  ) ||
    formattedAuthors[0] || {
      id: post.primaryAuthorId,
      name: "Author",
      slug: post.primaryAuthorId,
      bio: null,
    };

  const formattedTags = (tags || []).map(formatPublicTag);

  const excerpt = deriveExcerpt(post.excerpt, resolvedDoc);
  const postWithLocale = post as Post & { locale?: string };
  const postLocale = localeContext?.locale ?? localeContext?.primaryLocale ?? postWithLocale.locale ?? "en";
  const postDirection = getDirection(postLocale);
  const localePrefix = getLocalePrefix(
    postLocale, localeContext?.primaryLocale ?? "en",
    localeContext?.enabledLocales ?? [],
  );
  const canonicalUrl = post.canonicalUrl || `${siteUrl}${localePrefix}/posts/${post.slug}`;
  const seoTitle = post.metaTitle || post.title;
  const seoDescription = post.metaDescription || excerpt;

  const resolvedCommentCount =
    typeof commentCount === "number"
      ? commentCount
      : typeof (post as any).commentCount === "number"
      ? (post as any).commentCount
      : 0;

  return {
    id: post.id,
    featured: post.featured,
    title: post.title,
    slug: post.slug,
    excerpt,
    locale: postLocale,
    direction: postDirection,
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
      ogType: "article",
    },
    commentCount: resolvedCommentCount,
    comment_count: resolvedCommentCount,
  };
}

export function calculateReadingTime(docInput: unknown): number {
  try {
    const text = renderStudioDocumentToPlainText(toRenderablePublicDocument(docInput));
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  } catch {
    return 1;
  }
}

export async function buildPublicPostDetailDto(
  post: Post,
  authors: Author[],
  tags: Tag[],
  mediaService: MediaService,
  commentCount?: number,
  localeContext?: PublicContentLocaleContext,
): Promise<PublicPostDetailDto> {
  const summary = await buildPublicPostSummaryDto(
    post,
    authors,
    tags,
    mediaService,
    commentCount,
    localeContext,
  );
  const resolvedDoc = await resolveDocumentMedia(
    post.content,
    mediaService,
    post.publicationId,
  );
  // Read-only publication compatibility: never rewrite the persisted DTO.
  // Older TipTap JSON may be rendered through a strictly allowlisted projection.
  let renderable: unknown = resolvedDoc;
  try { renderable = toRenderablePublicDocument(resolvedDoc); } catch {
    // Unsupported historical blocks remain available in raw content for recovery.
  }

  let html: string;
  try {
    html = renderStudioDocumentToHtml(renderable);
  } catch {
    html = "<p>Content rendering unavailable.</p>";
  }

  // TOC extraction must not turn a published historical document into HTTP 500.
  let toc: ReturnType<typeof extractTableOfContentsFromDocument>;
  try { toc = extractTableOfContentsFromDocument(renderable); } catch { toc = []; }
  const readingTimeMins = calculateReadingTime(renderable);

  return {
    ...summary,
    content: resolvedDoc,
    html,
    toc,
    readingTimeMins,
  };
}

export async function buildPublicPageDetailDto(
  page: Page,
  mediaService: MediaService,
  localeContext?: PublicContentLocaleContext,
): Promise<PublicPageDetailDto> {
  const resolvedDoc = await resolveDocumentMedia(
    page.content,
    mediaService,
    page.publicationId,
  );
  const featureImage = extractFeatureImage(resolvedDoc);
  let renderable: unknown = resolvedDoc;
  try { renderable = toRenderablePublicDocument(resolvedDoc); } catch {
    // Keep the original content for recovery; never change stored bytes.
  }
  const siteUrl = getSiteUrl();

  const excerpt = deriveExcerpt(page.excerpt, resolvedDoc);
  const pageWithLocale = page as Page & { locale?: string };
  const pageLocale = localeContext?.locale ?? localeContext?.primaryLocale ?? pageWithLocale.locale ?? "en";
  const pageDirection = getDirection(pageLocale);
  const localePrefix = getLocalePrefix(
    pageLocale, localeContext?.primaryLocale ?? "en",
    localeContext?.enabledLocales ?? [],
  );
  const canonicalUrl = page.canonicalUrl || `${siteUrl}${localePrefix}/pages/${page.slug}`;
  const seoTitle = page.metaTitle || page.title;
  const seoDescription = page.metaDescription || excerpt;

  let html: string;
  try {
    html = renderStudioDocumentToHtml(renderable);
  } catch {
    html = "<p>Content rendering unavailable.</p>";
  }

  let toc: ReturnType<typeof extractTableOfContentsFromDocument>;
  try { toc = extractTableOfContentsFromDocument(renderable); } catch { toc = []; }

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    excerpt,
    locale: pageLocale,
    direction: pageDirection,
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
      ogType: "website",
    },
    toc,
  };
}
